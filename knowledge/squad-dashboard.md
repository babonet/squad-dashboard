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

## Boundaries

- This is a **viewer only**. It does not modify `.squad/`, create decisions, or run agents. To change team state, edit the underlying `.squad/` files through the normal Squad workflow.
