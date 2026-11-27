// Generates the "Signals" SVGs (stats, languages, activity) from the GitHub API.
// Runs in .github/workflows/stats.yml. Set STATS_MOCK=<file.json> to render from a saved API response.
import { mkdir, readFile, writeFile } from "node:fs/promises";

const LOGIN = process.env.STATS_USER || process.env.GITHUB_REPOSITORY_OWNER || "DamiansLab";
const OUT = "generated";

// Palette follows the dark theme of damianslab.gr.
const C = { bg: "#181D20", line: "#2F3437", strong: "#636869", accent: "#2FA3D4", accent2: "#59B0DA", text: "#E5E9EA", muted: "#9FA3A5", dim: "#8B9092" };
const FONTS = `
    .mono { font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; }
    .sans { font-family: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }`;
const GRID = `    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
      <path d="M32 0 H0 V32" stroke="${C.accent}" stroke-opacity=".05"/>
    </pattern>`;

// Sharp panel with blueprint grid and accent corner brackets, shared by all three SVGs.
function frame(w, h) {
  const l = 16, a = 0.75, c = w - 0.75, d = h - 0.75;
  return `  <rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="2" fill="${C.bg}"/>
  <rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="2" fill="url(#grid)"/>
  <rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="2" stroke="${C.line}"/>
  <path d="M${a} ${a + l} V${a} H${a + l} M${c - l} ${a} H${c} V${a + l} M${c} ${d - l} V${d} H${c - l} M${a + l} ${d} H${a} V${d - l}" stroke="${C.accent}" stroke-width="1.5"/>`;
}

const QUERY = `query($login: String!) {
  user(login: $login) {
    followers { totalCount }
    repositories(ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC, first: 100) {
      totalCount
      nodes {
        stargazerCount
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
    contributionsCollection {
      totalCommitContributions
      restrictedContributionsCount
      totalPullRequestContributions
      totalIssueContributions
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`;

async function fetchUser() {
  if (process.env.STATS_MOCK) return JSON.parse(await readFile(process.env.STATS_MOCK, "utf8")).data.user;
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "damianslab-stats" },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors || !json.data?.user) {
    throw new Error(`GitHub API error (${res.status}): ${JSON.stringify(json.errors || json)}`);
  }
  return json.data.user;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => (n >= 10000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : n.toLocaleString("en-US"));

function card(width, height, label, id, title, body) {
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(title)}">
  <style>${FONTS}
  </style>
  <defs>
${GRID}
  </defs>
${frame(width, height)}
  <text x="28" y="40" class="mono" font-size="12" fill="${C.accent}" letter-spacing="2">${esc(label)}</text>
  <text x="${width - 28}" y="40" class="mono" font-size="11" fill="${C.strong}" letter-spacing="1" text-anchor="end">${esc(id)}</text>
  <path d="M28 52.5 H${width - 28}" stroke="${C.line}"/>
  <path d="M28 52.5 H68" stroke="${C.accent}" stroke-width="2"/>
  <text x="28" y="80" class="sans" font-size="20" font-weight="700" fill="${C.text}">${esc(title)}</text>
${body}
</svg>
`;
}

function statsSvg(u) {
  const cc = u.contributionsCollection;
  const repos = u.repositories.nodes;
  const items = [
    ["Commits · 12 mo", cc.totalCommitContributions + cc.restrictedContributionsCount],
    ["Contributions", cc.contributionCalendar.totalContributions],
    ["Pull requests", cc.totalPullRequestContributions],
    ["Public repos", u.repositories.totalCount],
    ["Stars earned", repos.reduce((s, r) => s + r.stargazerCount, 0)],
    ["Followers", u.followers.totalCount],
  ];
  const body = items
    .map(([label, value], i) => {
      const x = 28 + (i % 3) * 180;
      const y = 116 + Math.floor(i / 3) * 44;
      return `  <text x="${x}" y="${y}" class="sans" font-size="22" font-weight="700" fill="${C.accent2}">${fmt(value)}</text>
  <text x="${x}" y="${y + 16}" class="mono" font-size="11" fill="${C.muted}">${esc(label)}</text>`;
    })
    .join("\n");
  return card(580, 190, "SYS // STATS", "SIG-01", "Lab output", body);
}

function languagesSvg(u) {
  const totals = new Map();
  for (const repo of u.repositories.nodes) {
    for (const { size, node } of repo.languages.edges) {
      const cur = totals.get(node.name) || { size: 0, color: node.color || C.dim };
      cur.size += size;
      totals.set(node.name, cur);
    }
  }
  const sorted = [...totals].sort((a, b) => b[1].size - a[1].size);
  const top = sorted.slice(0, 6);
  const sum = top.reduce((s, [, v]) => s + v.size, 0);

  if (!sum) {
    return card(580, 190, "SYS // LANGUAGES", "SIG-02", "Top languages", `  <text x="28" y="120" class="sans" font-size="15" fill="${C.muted}">No public code yet.</text>`);
  }

  const barX = 28, barW = 524, barY = 98;
  let x = barX;
  const segs = top
    .map(([, v], i) => {
      const w = i === top.length - 1 ? barX + barW - x : (v.size / sum) * barW;
      const s = `    <rect x="${x.toFixed(1)}" y="${barY}" width="${Math.max(w, 0).toFixed(1)}" height="10" fill="${v.color}"/>`;
      x += w;
      return s;
    })
    .join("\n");
  const legend = top
    .map(([name, v], i) => {
      const lx = 28 + (i % 3) * 180;
      const ly = 138 + Math.floor(i / 3) * 26;
      const pct = ((v.size / sum) * 100).toFixed(1);
      return `  <rect x="${lx}" y="${ly - 10}" width="10" height="10" rx="1" fill="${v.color}"/>
  <text x="${lx + 18}" y="${ly}" class="sans" font-size="14" fill="${C.text}">${esc(name)} <tspan class="mono" font-size="12" fill="${C.muted}">${pct}%</tspan></text>`;
    })
    .join("\n");
  const body = `  <clipPath id="bar"><rect x="${barX}" y="${barY}" width="${barW}" height="10" rx="1"/></clipPath>
  <g clip-path="url(#bar)">
${segs}
  </g>
${legend}`;
  return card(580, 190, "SYS // LANGUAGES", "SIG-02", "Top languages", body);
}

function activitySvg(u) {
  const cal = u.contributionsCollection.contributionCalendar;
  const weeks = cal.weeks.map((w) => ({
    date: w.contributionDays[0]?.date,
    count: w.contributionDays.reduce((s, d) => s + d.contributionCount, 0),
  }));
  const W = 1200, H = 260;
  const x0 = 60, x1 = 1140, y0 = 90, y1 = 210;
  const max = Math.max(1, ...weeks.map((w) => w.count));
  const step = weeks.length > 1 ? (x1 - x0) / (weeks.length - 1) : 0;
  const pts = weeks.map((w, i) => [x0 + i * step, y1 - (w.count / max) * (y1 - y0)]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${x1} ${y1} L${x0} ${y1} Z`;
  const best = weeks.reduce((b, w) => Math.max(b, w.count), 0);

  const months = [];
  let lastMonth = null;
  weeks.forEach((w, i) => {
    if (!w.date) return;
    const d = new Date(`${w.date}T00:00:00Z`);
    const m = d.getUTCMonth();
    if (m !== lastMonth && i > 0 && i < weeks.length - 2) {
      months.push(`  <text x="${pts[i][0].toFixed(1)}" y="${y1 + 24}" class="mono" font-size="11" fill="${C.dim}" text-anchor="middle">${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase()}</text>`);
    }
    lastMonth = m;
  });
  const grid = [0.25, 0.5, 0.75, 1]
    .map((f) => `  <path d="M${x0} ${(y1 - f * (y1 - y0)).toFixed(1)} H${x1}" stroke="${C.line}" stroke-dasharray="2 6"/>`)
    .join("\n");
  const [lx, ly] = pts[pts.length - 1] || [x1, y1];

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Contribution activity over the last 12 months">
  <style>${FONTS}
    .line { stroke-dasharray: 4000; stroke-dashoffset: 4000; animation: draw 3s ease-out forwards; }
    .ring { animation: ping 2.4s ease-out infinite; transform-box: fill-box; transform-origin: center; }
    @keyframes draw { to { stroke-dashoffset: 0; } }
    @keyframes ping { 0% { transform: scale(1); opacity: .8; } 70%, 100% { transform: scale(2.6); opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .line { animation: none; stroke-dashoffset: 0; } .ring { animation: none; } }
  </style>
  <defs>
${GRID}
    <linearGradient id="fill" x1="0" y1="${y0}" x2="0" y2="${y1}" gradientUnits="userSpaceOnUse">
      <stop stop-color="${C.accent}" stop-opacity=".35"/>
      <stop offset="1" stop-color="${C.accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>
${frame(W, H)}

  <text x="${x0}" y="44" class="mono" font-size="12" fill="${C.accent}" letter-spacing="2">SYS // ACTIVITY</text>
  <text x="${x0}" y="70" class="sans" font-size="20" font-weight="700" fill="${C.text}">Contributions, last 12 months</text>
  <text x="${x1}" y="44" class="mono" font-size="11" fill="${C.dim}" letter-spacing="1" text-anchor="end">SIG-03 · TOTAL / BEST WEEK</text>
  <text x="${x1}" y="70" class="sans" font-size="20" font-weight="700" fill="${C.accent2}" text-anchor="end">${fmt(cal.totalContributions)} <tspan fill="${C.strong}">/</tspan> ${fmt(best)}</text>

${grid}
  <path d="M${x0} ${y1} H${x1}" stroke="${C.strong}"/>
  <path d="${area}" fill="url(#fill)"/>
  <path class="line" d="${line}" stroke="${C.accent}" stroke-width="2" stroke-linejoin="miter" stroke-linecap="square"/>
  <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4" fill="${C.accent2}"/>
  <circle class="ring" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4" stroke="${C.accent}"/>
${months.join("\n")}
</svg>
`;
}

const user = await fetchUser();
await mkdir(OUT, { recursive: true });
await writeFile(`${OUT}/stats.svg`, statsSvg(user));
await writeFile(`${OUT}/languages.svg`, languagesSvg(user));
await writeFile(`${OUT}/activity.svg`, activitySvg(user));
console.log(`Wrote ${OUT}/stats.svg, ${OUT}/languages.svg, ${OUT}/activity.svg for ${LOGIN}`);
