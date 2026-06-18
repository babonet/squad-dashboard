# Knowledge: Squad Dashboard

This repo has the **Squad Dashboard** plugin installed — a read-only web view of the team's live `.squad/` state. Use this knowledge when someone asks to "see the squad", "open the dashboard", "show the roster/decisions/routing", or check team health.

## How to launch it

The dashboard needs its local read server running. The HTML UI and the `.mjs` server are
**not** installed by the plugin (Squad plugins can't ship executable files) — copy them from
the `squad-dashboard` repository's `tools/` folder into this project, then start the server:

```
node tools/squad-server.mjs
```

Then open **http://localhost:4317**.

- The server is **read-only**: it parses `.squad/` and serves JSON at `/api/squad`. It never writes anything.
- It auto-detects the repo's `.squad/` folder by walking up from the script location.
- Override with `SQUAD_ROOT` (which repo) and `SQUAD_PORT` (default `4317`).
- Requires Node.js 18+.

If the dashboard shows an "Offline — start the read server" banner with empty sections, the server isn't running — start it with the command above.

## What each section reflects

- **Overview** — current focus (`identity/now.md`) plus live counts.
- **Roster** — members from `team.md`, enriched with each `agents/{name}/charter.md` (blurb, responsibilities, boundaries, reviewer flag, model).
- **Routing** — `routing.md` (work-type → who) and issue-label routing.
- **Models & Config** — per-member model assignment and rationale.
- **Casting** — `casting/registry.json` (persona ↔ role).
- **Decisions** — `decisions.md` ledger plus anything pending in `decisions/inbox/`.
- **Sessions** — entries under `log/`.
- **Ceremonies** — `ceremonies.md` (triggers, facilitator, agenda).
- **Skills** — installed `.copilot/skills/`.
- **Analytics / Health** — derived signals (activity, inbox backlog, etc.).
- **Ralph Monitor** — live state, queue depth, and latest update (see below).

## Ralph live heartbeat (optional)

The Ralph Monitor derives its state from `identity/now.md` and the latest dated update in
`agents/ralph/history.md`. Because the dashboard only reads files, Ralph's live loop and any
external backlog (e.g. Azure DevOps work items) are otherwise invisible to it.

To make the live loop and queue depth visible, Ralph can write a small heartbeat file at
`.squad/identity/ralph-status.md` as it works. The dashboard reads it on every refresh
(~10s) and the values override the file-derived state:

```markdown
---
state: active
queue: 3
updated_at: 2026-06-18T17:42:00Z
---

# Ralph Status

## Queue
- PR #1234 review — commerce-iq
- Work item 5678 triage — golden-set regression
- Pipeline failure on main — investigate
```

- `state` — `active` / `idle` / `working` (shown verbatim in "Monitor state").
- `queue` — integer depth. If omitted, the dashboard counts the `## Queue` bullets.
- `## Queue` bullets render as the backlog list in the Ralph Monitor.

When Ralph goes idle it should set `state: idle` and clear the queue. This file is the only
write Ralph needs for the dashboard to mirror its loop; everything else stays read-only.

## Boundaries


- This is a **viewer only**. It does not modify `.squad/`, create decisions, or run agents. To change team state, edit the underlying `.squad/` files through the normal Squad workflow.
