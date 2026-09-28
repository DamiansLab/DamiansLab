// Generates the "Signals" SVGs (stats, languages, activity) from the GitHub API.
// Runs in .github/workflows/stats.yml. Set STATS_MOCK=<file.json> to render from a saved API response.
import { mkdir, readFile, writeFile } from "node:fs/promises";

const LOGIN = process.env.STATS_USER || process.env.GITHUB_REPOSITORY_OWNER || "DamiansLab";
const OUT = "generated";

const C = { bg: "#0A0A0B", accent: "#F18E45", text: "#F5F5F5", muted: "#A8A8A8", dim: "#6B6B6B" };
const FONTS = `
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; }
    .sans { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }`;

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

function card(width, height, label, title, body) {
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(title)}">
  <style>${FONTS}
  </style>
  <defs>
    <radialGradient id="g" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(${width - 20} 0) scale(260 200)">
      <stop stop-color="${C.accent}" stop-opacity=".16"/>
      <stop offset="1" stop-color="${C.accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x=".75" y=".75" width="${width - 1.5}" height="${height - 1.5}" rx="16" fill="${C.bg}"/>
  <rect x=".75" y=".75" width="${width - 1.5}" height="${height - 1.5}" rx="16" fill="url(#g)" stroke="#FFFFFF" stroke-opacity=".1" stroke-width="1.5"/>
  <rect x="0" y="30" width="3" height="40" rx="1.5" fill="${C.accent}"/>
  <text x="28" y="44" class="mono" font-size="12" fill="${C.accent}" letter-spacing="2">${esc(label)}</text>
  <text x="28" y="74" class="sans" font-size="22" font-weight="700" fill="${C.text}">${esc(title)}</text>
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
      const y = 112 + Math.floor(i / 3) * 46;
      return `  <text x="${x}" y="${y}" class="sans" font-size="22" font-weight="700" fill="${C.accent}">${fmt(value)}</text>
  <text x="${x}" y="${y + 16}" class="mono" font-size="11" fill="${C.muted}">${esc(label)}</text>`;
    })
    .join("\n");
  return card(580, 190, "SYSTEM · STATS", "Lab output", body);
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
    return card(580, 190, "SYSTEM · LANGUAGES", "Top languages", `  <text x="28" y="120" class="sans" font-size="15" fill="${C.muted}">No public code yet.</text>`);
  }

  const barX = 28, barW = 524, barY = 94;
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
      const ly = 136 + Math.floor(i / 3) * 28;
      const pct = ((v.size / sum) * 100).toFixed(1);
      return `  <circle cx="${lx + 5}" cy="${ly - 4}" r="5" fill="${v.color}"/>
  <text x="${lx + 18}" y="${ly}" class="sans" font-size="14" fill="${C.text}">${esc(name)} <tspan class="mono" font-size="12" fill="${C.muted}">${pct}%</tspan></text>`;
    })
    .join("\n");
  const body = `  <clipPath id="bar"><rect x="${barX}" y="${barY}" width="${barW}" height="10" rx="5"/></clipPath>
  <g clip-path="url(#bar)">
${segs}
  </g>
${legend}`;
  return card(580, 190, "SYSTEM · LANGUAGES", "Top languages", body);
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
    .map((f) => `  <path d="M${x0} ${(y1 - f * (y1 - y0)).toFixed(1)} H${x1}" stroke="#FFFFFF" stroke-opacity=".05"/>`)
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
    <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1" fill="#FFFFFF" fill-opacity=".05"/>
    </pattern>
    <linearGradient id="fill" x1="0" y1="${y0}" x2="0" y2="${y1}" gradientUnits="userSpaceOnUse">
      <stop stop-color="${C.accent}" stop-opacity=".35"/>
      <stop offset="1" stop-color="${C.accent}" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="panel"><rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="18"/></clipPath>
  </defs>
  <g clip-path="url(#panel)">
    <rect width="${W}" height="${H}" fill="${C.bg}"/>
    <rect width="${W}" height="${H}" fill="url(#dots)"/>
  </g>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="18" stroke="#FFFFFF" stroke-opacity=".08"/>

  <text x="${x0}" y="44" class="mono" font-size="12" fill="${C.accent}" letter-spacing="2">SYSTEM · ACTIVITY</text>
  <text x="${x0}" y="70" class="sans" font-size="20" font-weight="700" fill="${C.text}">Contributions, last 12 months</text>
  <text x="${x1}" y="44" class="mono" font-size="11" fill="${C.muted}" text-anchor="end">TOTAL · BEST WEEK</text>
  <text x="${x1}" y="70" class="sans" font-size="20" font-weight="700" fill="${C.accent}" text-anchor="end">${fmt(cal.totalContributions)} <tspan fill="${C.dim}">·</tspan> ${fmt(best)}</text>

${grid}
  <path d="M${x0} ${y1} H${x1}" stroke="#FFFFFF" stroke-opacity=".12"/>
  <path d="${area}" fill="url(#fill)"/>
  <path class="line" d="${line}" stroke="${C.accent}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4" fill="${C.accent}"/>
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
