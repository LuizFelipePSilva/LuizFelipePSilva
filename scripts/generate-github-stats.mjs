import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const USERNAME = process.env.GITHUB_USERNAME;
const TOKEN = process.env.GITHUB_TOKEN;

if (!USERNAME || !TOKEN) {
  throw new Error("GITHUB_USERNAME and GITHUB_TOKEN are required.");
}

const GRAPHQL_URL = "https://api.github.com/graphql";

const QUERY = `
  query ($login: String!, $after: String) {
    user(login: $login) {
      repositories(
        first: 100
        after: $after
        ownerAffiliations: OWNER
        privacy: PUBLIC
        orderBy: { field: UPDATED_AT, direction: DESC }
      ) {
        totalCount
        nodes {
          name
          isFork
          stargazerCount
          forkCount
          languages(
            first: 20
            orderBy: { field: SIZE, direction: DESC }
          ) {
            edges {
              size
              node {
                name
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

async function fetchRepositories() {
  const repositories = [];
  let cursor = null;

  do {
    const response = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: QUERY,
        variables: {
          login: USERNAME,
          after: cursor,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const result = await response.json();

    if (result.errors?.length) {
      throw new Error(result.errors.map((error) => error.message).join("\n"));
    }

    const connection = result.data?.user?.repositories;

    if (!connection) {
      throw new Error(`GitHub user not found: ${USERNAME}`);
    }

    repositories.push(...connection.nodes);

    cursor = connection.pageInfo.hasNextPage
      ? connection.pageInfo.endCursor
      : null;
  } while (cursor);

  return repositories;
}

function escapeXml(value) {
  return String(value).replace(
    /[<>&"']/g,
    (char) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[char],
  );
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function createStatsSvg(stats) {
  const items = [
    ["PUBLIC REPOSITORIES", stats.repositories],
    ["TOTAL STARS", stats.stars],
    ["TOTAL FORKS", stats.forks],
  ];

  const cards = items
    .map(([label, value], index) => {
      const x = 25 + index * 165;

      return `
      <text x="${x}" y="85" class="value">
        ${formatNumber(value)}
      </text>
      <text x="${x}" y="110" class="label">
        ${label}
      </text>
    `;
    })
    .join("");

  return `
    <svg xmlns="http://www.w3.org/2000/svg"
         width="520" height="165" viewBox="0 0 520 165"
         role="img">
      <title>GitHub statistics for ${escapeXml(USERNAME)}</title>

      <style>
        .title {
          fill: #70a5fd;
          font: 600 16px sans-serif;
        }
        .value {
          fill: #ffffff;
          font: 700 27px sans-serif;
        }
        .label {
          fill: #8b949e;
          font: 11px sans-serif;
        }
      </style>

      <rect width="520" height="165" rx="12"
            fill="#161b22" stroke="#30363d"/>

      <text x="25" y="35" class="title">
        GitHub Statistics
      </text>

      ${cards}

      <text x="25" y="145"
            fill="#8b949e" font-size="10">
        github.com/${escapeXml(USERNAME)}
      </text>
    </svg>
  `;
}

function createLanguagesSvg(languages) {
  const sorted = Object.entries(languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const total = sorted.reduce((sum, [, size]) => sum + size, 0);

  const colors = [
    "#3178c6",
    "#f1e05a",
    "#e34c26",
    "#563d7c",
    "#3572A5",
    "#89e051",
  ];

  let offset = 25;

  const bars = sorted
    .map(([name, size], index) => {
      const width = total ? (470 * size) / total : 0;
      const color = colors[index];

      const bar = `
      <rect x="${offset}" y="55"
            width="${width}" height="9"
            fill="${color}" />
    `;

      offset += width;
      return bar;
    })
    .join("");

  const labels = sorted
    .map(([name, size], index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);

      const x = 25 + column * 245;
      const y = 95 + row * 23;
      const percentage = total ? ((size / total) * 100).toFixed(1) : "0.0";

      return `
      <circle cx="${x}" cy="${y - 4}"
              r="4" fill="${colors[index]}" />

      <text x="${x + 12}" y="${y}"
            fill="#c9d1d9" font-size="12">
        ${escapeXml(name)}
      </text>

      <text x="${x + 220}" y="${y}"
            text-anchor="end"
            fill="#8b949e" font-size="11">
        ${percentage}%
      </text>
    `;
    })
    .join("");

  return `
    <svg xmlns="http://www.w3.org/2000/svg"
         width="520" height="165" viewBox="0 0 520 165"
         role="img">
      <title>Top programming languages for ${escapeXml(USERNAME)}</title>

      <rect width="520" height="165" rx="12"
            fill="#161b22" stroke="#30363d"/>

      <text x="25" y="35"
            fill="#70a5fd"
            font-size="16"
            font-weight="600">
        Top Languages
      </text>

      <rect x="25" y="55" width="470" height="9"
            rx="4" fill="#30363d"/>

      ${bars}
      ${labels}
    </svg>
  `;
}

async function main() {
  const repositories = await fetchRepositories();

  // Exclude forks to avoid counting duplicated code.
  const originalRepositories = repositories.filter(
    (repository) => !repository.isFork,
  );

  const stats = {
    repositories: originalRepositories.length,
    stars: originalRepositories.reduce(
      (sum, repository) => sum + repository.stargazerCount,
      0,
    ),
    forks: originalRepositories.reduce(
      (sum, repository) => sum + repository.forkCount,
      0,
    ),
  };

  const languages = {};

  for (const repository of originalRepositories) {
    for (const { size, node } of repository.languages.edges) {
      languages[node.name] = (languages[node.name] ?? 0) + size;
    }
  }

  const outputDirectory = path.join(process.cwd(), "assets");

  await mkdir(outputDirectory, { recursive: true });

  await Promise.all([
    writeFile(
      path.join(outputDirectory, "github-stats.svg"),
      createStatsSvg(stats),
      "utf8",
    ),
    writeFile(
      path.join(outputDirectory, "top-languages.svg"),
      createLanguagesSvg(languages),
      "utf8",
    ),
  ]);

  console.log("GitHub statistics generated successfully.");
  console.log(stats);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
