#!/usr/bin/env node
// Squad read-only server — zero dependencies (Node built-ins only).
// Serves the dashboard and a /api/squad endpoint that parses the live .squad/ state.
//
//   node tools/squad-server.mjs        → http://localhost:4317
//   npx squad-dashboard                → http://localhost:4317 (from any squad repo)
//
// Read-only: it never writes to .squad/. Open the dashboard via this server for
// live data, or open the HTML file directly to use the embedded snapshot fallback.

import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Locate the repo's .squad/ directory by walking up from the server file (and the
// current working directory). Lets this tool live anywhere in any squad-enabled repo.
function findSquadRoot(start) {
  let dir = resolve(start);
  for (let i = 0; i < 15; i++) {
    if (existsSync(join(dir, ".squad"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const ROOT =
  (process.env.SQUAD_ROOT && existsSync(join(process.env.SQUAD_ROOT, ".squad")) && resolve(process.env.SQUAD_ROOT)) ||
  findSquadRoot(__dirname) ||
  findSquadRoot(process.cwd()) ||
  resolve(__dirname, "..");
const SQUAD = join(ROOT, ".squad");
const PORT = process.env.SQUAD_PORT ? Number(process.env.SQUAD_PORT) : 4317;

if (!existsSync(SQUAD)) {
  console.error(`No .squad/ directory found from ${__dirname}. Run inside a squad-enabled repo, or set SQUAD_ROOT.`);
  process.exit(1);
}

// ---------- small helpers ----------
const read = async (p) => {
  try { return await readFile(p, "utf8"); } catch { return null; }
};
const listDirs = async (p) => {
  try {
    const ents = await readdir(p, { withFileTypes: true });
    return ents.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch { return []; }
};
const listFiles = async (p) => {
  try {
    const ents = await readdir(p, { withFileTypes: true });
    return ents.filter((e) => e.isFile()).map((e) => e.name);
  } catch { return []; }
};

// Pull the leading emoji (if any) off a role string: "🔭 Research Lead" → { emoji, role }
const splitEmoji = (s) => {
  const m = s.match(/^\s*(\p{Extended_Pictographic}(?:\uFE0F)?)\s*(.*)$/u);
  return m ? { emoji: m[1], role: m[2].trim() } : { emoji: "👤", role: s.trim() };
};

// Parse a markdown pipe-table that appears anywhere in `lines`, optionally after a heading.
// Returns array of cell-arrays (data rows only, header + separator skipped).
function parseTable(lines) {
  const rows = lines
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|"))
    .map((l) => l.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim()));
  // drop the separator row(s) like |---|---|
  const data = rows.filter((cells) => !cells.every((c) => /^:?-{2,}:?$/.test(c) || c === ""));
  return data;
}

// Collect every pipe-table in the document as a separate cell-row array
// (first row of each = its header). Tables are split on any non-table line.
function allTables(text) {
  const tables = [];
  let block = [];
  const flush = () => {
    if (block.length) { const rows = parseTable(block); if (rows.length) tables.push(rows); }
    block = [];
  };
  for (const l of text.split(/\r?\n/)) {
    if (l.trim().startsWith("|")) block.push(l);
    else flush();
  }
  flush();
  return tables;
}

// Slice the lines belonging to a `## Heading` section (until the next same-or-higher heading).
function section(text, headingRegex, level = 2) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => headingRegex.test(l));
  if (start === -1) return [];
  const out = [];
  const stop = new RegExp(`^#{1,${level}}\\s`);
  for (let i = start + 1; i < lines.length; i++) {
    if (stop.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out;
}

// Bullet list items under a heading.
function bullets(lines) {
  return lines
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, "").replace(/\*\*/g, "").trim());
}

// role → default model (mirrors the coordinator's cost-first mapping)
function roleToModel(role) {
  const r = role.toLowerCase();
  if (/lead|architect|strateg/.test(r)) return "auto (per-task)";
  if (/investigat|research|writer|docs|logger|monitor|scribe/.test(r)) return "claude-haiku-4.5";
  if (/test|qa|valid|analyst|backend|frontend|prototyp|dev/.test(r)) return "claude-sonnet-4.6";
  return "auto (per-task)";
}
function modelWhy(role) {
  const r = role.toLowerCase();
  if (/lead|architect/.test(r)) return "Mixed work — proposals bump premium, planning to fast";
  if (/strateg/.test(r)) return "Ideation like prompts → sonnet; research → haiku";
  if (/valid|analyst|test|qa/.test(r)) return "Writes experiment/test code — quality first";
  if (/prototyp|dev|backend|frontend/.test(r)) return "Writes code — quality first";
  if (/scribe|logger/.test(r)) return "Mechanical file ops — cheapest";
  if (/monitor/.test(r)) return "Mechanical monitoring — cheapest";
  return "Research / non-code — cost first";
}

// ---------- parsers ----------
async function parseMembers() {
  const text = await read(join(SQUAD, "team.md"));
  if (!text) return [];
  const rows = parseTable(section(text, /^##\s+Members/i));
  const members = [];
  for (const cells of rows) {
    if (cells[0].toLowerCase() === "name") continue;
    const [name, roleRaw, charterRel, status] = cells;
    const { emoji, role } = splitEmoji(roleRaw || "");
    const m = {
      name, emoji, role, status: (status || "active").toLowerCase(),
      charter: charterRel || "—", reviewer: false,
      model: roleToModel(role),
      blurb: "", responsibilities: [], boundaries: [],
    };
    if (charterRel && charterRel !== "—") {
      const ctext = await read(join(SQUAD, charterRel));
      if (ctext) {
        const lines = ctext.split(/\r?\n/);
        // blurb = first non-heading, non-empty paragraph
        const bi = lines.findIndex((l, i) => i > 0 && l.trim() && !l.startsWith("#"));
        m.blurb = bi >= 0 ? lines[bi].trim() : "";
        m.responsibilities = bullets(section(ctext, /^##\s+Responsibilities/i));
        m.boundaries = bullets(section(ctext, /^##\s+Boundaries/i));
        m.reviewer = /^##\s+Reviewer Role/im.test(ctext);
      }
    }
    members.push(m);
  }
  return members;
}

async function parseRouting() {
  const text = await read(join(SQUAD, "routing.md"));
  const routing = [], issueRouting = [];
  if (!text) return { routing, issueRouting };

  // Preferred: an explicit "## Routing Table" (work type | who | example).
  for (const cells of parseTable(section(text, /^##\s+Routing Table/i))) {
    if (/^work type$/i.test(cells[0])) continue;
    routing.push({ type: cells[0], who: cells[1], ex: cells[2] || "" });
  }

  // Fallback for other routing.md layouts: scan every table and keep the ones
  // that map something (signal / domain / decision) → an owner column.
  if (!routing.length) {
    const clean = (s) => (s || "").replace(/[*_`]/g, "").trim();
    for (const rows of allTables(text)) {
      const header = rows[0].map((c) => c.toLowerCase());
      const whoIdx = header.findIndex((h) => /owner|who|assignee|lead/.test(h));
      if (whoIdx < 1) continue; // need an owner column that isn't the first column
      const exIdx = header.findIndex((h, i) => i !== whoIdx && i !== 0);
      for (const cells of rows.slice(1)) {
        const type = clean(cells[0]), who = clean(cells[whoIdx]);
        if (!type || !who) continue;
        routing.push({ type, who, ex: exIdx >= 0 ? clean(cells[exIdx]) : "" });
      }
    }
  }

  for (const cells of parseTable(section(text, /^##\s+Issue Routing/i))) {
    if (/^label$/i.test(cells[0])) continue;
    issueRouting.push({ label: cells[0].replace(/`/g, ""), action: cells[1], who: cells[2] || "" });
  }
  return { routing, issueRouting };
}

function statusClass(raw) {
  const s = (raw || "").toLowerCase();
  if (/deliverable|ready/.test(s)) return "delivered";
  if (/finding|evidence/.test(s)) return "findings";
  if (/propos|framing|direction/.test(s)) return "proposed";
  return "findings";
}

async function parseDecisions() {
  const text = await read(join(SQUAD, "decisions.md"));
  if (!text) return [];
  const blocks = text.split(/\n(?=###\s)/).filter((b) => b.trim().startsWith("###"));
  return blocks.map((b) => {
    const lines = b.split(/\r?\n/);
    const head = lines[0].replace(/^###\s+/, "").trim();
    const dm = head.match(/^(\d{4}-\d{2}-\d{2}):\s*(.*)$/);
    const date = dm ? dm[1] : "";
    const title = dm ? dm[2] : head;
    const byLine = lines.find((l) => /\*\*By:\*\*/.test(l)) || "";
    const author = (byLine.match(/\*\*By:\*\*\s*([^·(]+)/) || [])[1]?.trim() || "";
    const status = (byLine.match(/\*\*Status:\*\*\s*([^·]+)/) || [])[1]?.trim() || "";
    // body = first substantive paragraph after the meta lines
    const bodyLine = lines.find((l, i) =>
      i > 1 && l.trim() && !l.startsWith("**") && !l.startsWith("#") && !l.startsWith("|") && !l.startsWith("-"));
    let body = (bodyLine || "").replace(/\*\*/g, "").replace(/^>\s*/, "").trim();
    if (body.length > 360) body = body.slice(0, 357) + "…";
    const role = (byLine.match(/\(([^)]+)\)/) || [])[1] || "";
    return { date, title, status: statusClass(status), meta: `${author}${role ? " · " + role : ""}`, body };
  });
}

async function parseCasting() {
  const text = await read(join(SQUAD, "casting", "registry.json"));
  if (!text) return [];
  try {
    const json = JSON.parse(text);
    return Object.entries(json.agents || {}).map(([slug, a]) => ({
      slug, name: a.persistent_name, universe: a.universe,
      created: a.created_at, status: a.status || "active",
    }));
  } catch { return []; }
}

async function parseCeremonies() {
  const text = await read(join(SQUAD, "ceremonies.md"));
  if (!text) return [];
  const parts = text.split(/\n(?=##\s)/).filter((p) => /^##\s/.test(p) && !/^##\s+Ceremonies/i.test(p));
  return parts.map((p) => {
    const lines = p.split(/\r?\n/);
    const name = lines[0].replace(/^##\s+/, "").trim();
    const field = (re) => {
      const row = lines.find((l) => re.test(l) && l.includes("|"));
      if (!row) return "";
      const cells = row.replace(/^\|/, "").split("|").map((c) => c.trim().replace(/\*\*/g, ""));
      return cells[1] || "";
    };
    const when = field(/\*\*When\*\*/i) || field(/^\|\s*\*\*When/i);
    const trigger = field(/\*\*Trigger\*\*/i);
    const facilitator = field(/\*\*Facilitator\*\*/i);
    const cond = field(/\*\*Condition\*\*/i);
    const enabledRaw = field(/\*\*Enabled\*\*/i);
    const enabled = /yes|✅/i.test(enabledRaw);
    const agenda = bullets(section(p, /\*\*Agenda/i).length ? section(p, /\*\*Agenda/i) : lines)
      .filter((x) => /^\d|review|root|what|action|surface|set|agree|identify|carried/i.test(x));
    const numbered = lines.filter((l) => /^\d+\.\s/.test(l.trim())).map((l) => l.replace(/^\d+\.\s*/, "").trim());
    return { name, when, trigger, facilitator, cond, enabled, agenda: numbered.length ? numbered : agenda };
  });
}

async function parseNow() {
  const text = await read(join(SQUAD, "identity", "now.md"));
  if (!text) return { focus: "—", area: "", updated: new Date().toISOString() };
  const updated = (text.match(/updated_at:\s*(\S+)/) || [])[1] || new Date().toISOString();
  const area = (text.match(/focus_area:\s*(.+)/) || [])[1]?.trim() || "";
  const body = section(text, /^#\s+What We're Focused On/i, 1).map((l) => l.trim()).filter(Boolean);
  return { focus: body[0] || "—", area, updated };
}

async function parseSessions() {
  const dir = join(SQUAD, "log");
  const files = (await listFiles(dir)).filter((f) => f.endsWith(".md")).sort().reverse();
  const memberNames = (await parseMembers()).map((m) => m.name);
  const sessions = [];
  for (const f of files) {
    const text = await read(join(dir, f));
    if (!text) continue;
    const h = text.split(/\r?\n/).find((l) => /^#\s/.test(l)) || "";
    const hm = h.match(/—\s*(\d{4}-\d{2}-\d{2})\s*—\s*(.+)$/);
    const fm = f.match(/^(\d{4}-\d{2}-\d{2})/);
    const date = (hm && hm[1]) || (fm && fm[1]) || "";
    const title = (hm && hm[2].trim()) || h.replace(/^#\s+/, "").trim();
    const sumLines = section(text, /^##\s+(Summary|Goal)/i).map((l) => l.trim()).filter(Boolean);
    const summary = bullets(sumLines).join(" ") || sumLines.find((l) => !l.startsWith("#")) || "";
    const who = memberNames.filter((n) => new RegExp(`\\b${n}\\b`).test(text));
    const outputs = bullets(section(text, /^##\s+Deliverables/i)).filter((x) => x.includes("/")).map((x) => x.split("—")[0].trim());
    sessions.push({ date, title, who, summary: summary.slice(0, 420), outputs });
  }
  return sessions;
}

async function parseSkills() {
  const out = [];
  const dir = join(ROOT, ".copilot", "skills");
  for (const name of (await listDirs(dir)).sort()) {
    const sk = await read(join(dir, name, "SKILL.md"));
    let desc = "";
    if (sk) {
      const d = sk.match(/description:\s*(.+)/);
      desc = d ? d[1].trim().replace(/^["']|["']$/g, "").slice(0, 90) : "";
    }
    out.push({ name, desc, conf: "high" });
  }
  return out;
}

async function inboxCount() {
  return (await listFiles(join(SQUAD, "decisions", "inbox"))).filter((f) => f.endsWith(".md")).length;
}

async function buildPayload() {
  const members = await parseMembers();
  const { routing, issueRouting } = await parseRouting();
  const [decisions, casting, ceremonies, now, sessions, copilotSkills] = await Promise.all([
    parseDecisions(), parseCasting(), parseCeremonies(), parseNow(), parseSessions(), parseSkills(),
  ]);

  const models = members.map((m) => ({ name: m.name, role: m.role, model: m.model, why: modelWhy(m.role) }));

  // analytics derived from the orchestration log + decisions + sessions
  const orchFiles = (await listFiles(join(SQUAD, "orchestration-log"))).map((f) => f.toLowerCase());
  const decByAuthor = (name) => decisions.filter((d) => d.meta.toLowerCase().startsWith(name.toLowerCase())).length;
  const activity = members
    .filter((m) => !/ralph/i.test(m.name))
    .map((m) => {
      const orch = orchFiles.filter((f) => f.includes(m.name.toLowerCase())).length;
      const dels = sessions.reduce((n, s) => n + s.outputs.filter(() => s.who.includes(m.name)).length, 0);
      const dec = decByAuthor(m.name);
      let throughput = "seeded";
      if (/scribe/i.test(m.name)) throughput = "background";
      else if (orch >= 3) throughput = "high";
      else if (orch >= 1) throughput = "steady";
      return { name: m.name, orch, decisions: dec, deliverables: dels, throughput };
    });
  const deliverables = [...new Set(sessions.flatMap((s) => s.outputs))];

  const ralph = await parseRalph();

  const teamRoot = SQUAD;
  return {
    project: await projectContext(),
    members, routing, issueRouting, decisions, casting, ceremonies, now,
    sessions, copilotSkills, models, activity, deliverables, ralph,
    meta: { inboxCount: ralph.inbox, teamRoot, generatedAt: new Date().toISOString() },
  };
}

async function projectContext() {
  const text = await read(join(SQUAD, "team.md")) || "";
  const owner = (text.match(/\*\*Owner:\*\*\s*(.+)/) || [])[1]?.trim() || "—";
  const universe = (text.match(/\*\*Universe:\*\*\s*(.+)/) || [])[1]?.trim() || "—";
  const created = (text.match(/\*\*Created:\*\*\s*(.+)/) || [])[1]?.trim() || "—";
  const proj = (text.match(/\*\*Project:\*\*\s*(.+)/) || [])[1]?.trim() || "InnoSquad";
  return { name: proj, owner, universe, created };
}

// Derive Ralph's monitor state from the live .squad/ files (identity/now.md +
// agents/ralph/history.md). Falls back to "idle" when there's no active focus.
async function parseRalph() {
  const inbox = await inboxCount();
  const nowText = (await read(join(SQUAD, "identity", "now.md"))) || "";
  const idleHints = /no active task|awaiting|idle|standby|no current focus/i;
  // Strip headings and bullet markers to see whether there's substantive focus content.
  const focusBody = nowText.replace(/^#.*$/gm, "").replace(/[-*]\s*/g, "").trim();
  let state = focusBody && !idleHints.test(nowText) ? "active" : "idle";
  let queue = 0;
  let queueItems = [];
  let statusUpdated = "";

  // Authoritative live heartbeat: Ralph may write identity/ralph-status.md while it
  // runs. When present, it overrides the now.md-derived state and provides queue depth.
  const status = await read(join(SQUAD, "identity", "ralph-status.md"));
  if (status) {
    const s = (status.match(/^\s*state:\s*(\S+)/im) || [])[1];
    if (s) state = s.toLowerCase();
    statusUpdated = (status.match(/^\s*updated_at:\s*(\S+)/im) || [])[1] || "";
    queueItems = bullets(section(status, /^##\s+Queue/i));
    const q = (status.match(/^\s*queue:\s*(\d+)/im) || [])[1];
    queue = q !== undefined ? Number(q) : queueItems.length;
  }

  // Newest dated top-level bullet from Ralph's history.md "## Updates", if present.
  let lastUpdate = "";
  const hist = await read(join(SQUAD, "agents", "ralph", "history.md"));
  if (hist) {
    const dated = section(hist, /^##\s+Updates/i)
      .filter((l) => /^[-*]\s+(\*\*)?\d{4}-\d{2}-\d{2}/.test(l));
    if (dated.length) {
      lastUpdate = dated[dated.length - 1].replace(/^[-*]\s+/, "").replace(/\*\*/g, "").trim();
    }
  }
  return {
    state, queue, queueItems, statusUpdated, inbox, lastUpdate,
    followups: [], // populated from the newest session's "## Next" by withFollowups()
  };
}

// fix follow-ups: read newest log's "## Next" directly
async function withFollowups(payload) {
  const dir = join(SQUAD, "log");
  const files = (await listFiles(dir)).filter((f) => f.endsWith(".md")).sort().reverse();
  if (files[0]) {
    const text = await read(join(dir, files[0])) || "";
    payload.ralph.followups = bullets(section(text, /^##\s+Next/i));
  }
  return payload;
}

// ---------- http ----------
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname === "/api/squad") {
      const payload = await withFollowups(await buildPayload());
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(payload));
      return;
    }
    // static: dashboard at /
    let file = url.pathname === "/" ? "squad-dashboard.html" : url.pathname.replace(/^\//, "");
    const full = join(__dirname, file);
    if (!full.startsWith(__dirname) || !existsSync(full)) {
      res.writeHead(404).end("Not found");
      return;
    }
    const ext = file.slice(file.lastIndexOf("."));
    const body = await readFile(full);
    res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream" });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(err) }));
  }
});

server.listen(PORT, () => {
  console.log(`Squad dashboard (read-only) → http://localhost:${PORT}`);
  console.log(`Reading live state from: ${SQUAD}`);
});
