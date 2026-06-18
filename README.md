# Squad Dashboard

A **read-only** web dashboard that visualizes the live state of any Squad-enabled repository. Point it at a repo with a `.squad/` directory and it renders the team's roster, routing, models, casting, decisions, sessions, ceremonies, skills, analytics, and health — straight from the files, with no database and no writes.

## What it is

- **`tools/squad-dashboard.html`** — a single self-contained UI (no build step, no CDN). Uses the Clawpilot theme with automatic light/dark detection.
- **`tools/squad-server.mjs`** — a zero-dependency Node read server (built-in modules only). It parses `.squad/` into JSON and serves the dashboard.

The dashboard fetches `/api/squad` from the server. When the server is offline it shows empty states prompting you to start it.

## Read-only by design

The server never writes to `.squad/` or anywhere else. There are no POST routes, no lifecycle hooks, and no commands that Squad runs on your behalf. You launch the server yourself.

## Requirements

- Node.js **18+**

## How distribution works

Squad plugins are **declarative-only**: a plugin payload may not contain scripts or
executable files, and may only write into approved `.squad/` roots. The dashboard's
UI (`.html` with embedded script) and read server (`.mjs`) are therefore **not** installed
by `squad plugin install`. They live in this repository and you copy them into your
project yourself.

What the plugin *does* install is the declarative knowledge guide
(`knowledge/squad-dashboard/squad-dashboard.md`) so your squad's agents know the
dashboard exists and how to launch it.

## Add via the marketplace

This repo is a Squad marketplace source. Register it, then browse/install:

```
squad plugin marketplace add github/REPLACE_ME/squad-dashboard
squad plugin marketplace browse squad-dashboard
squad plugin install squad-dashboard
squad plugin enable squad-dashboard
```

> Replace `REPLACE_ME` with your GitHub owner (user or org) once the repo is public,
> and update the `repository.url` / `upstream.docs` fields in `plugin.manifest.json` to match.

## Get the dashboard files

Copy the two tool files from this repo into your project (any location works — the
server finds `.squad/` on its own):

```
# from your project root
curl -O https://raw.githubusercontent.com/REPLACE_ME/squad-dashboard/main/tools/squad-dashboard.html --output-dir tools
curl -O https://raw.githubusercontent.com/REPLACE_ME/squad-dashboard/main/tools/squad-server.mjs --output-dir tools
```

…or just clone the repo and copy `tools/`.

## Run

From the root of your Squad repo:

```
node tools/squad-server.mjs
```

Then open **http://localhost:4317**.

The server auto-locates `.squad/` by walking up from the script's own location (so it works whether the files land in `tools/`, `.squad/tools/`, or elsewhere). Override the detected root or port with environment variables:

```
SQUAD_ROOT=/path/to/repo SQUAD_PORT=8080 node tools/squad-server.mjs
```

## What it shows

| Section | Source in `.squad/` |
| --- | --- |
| Overview / Dashboard | `team.md`, `identity/now.md`, counts across the tree |
| Roster | `team.md` members + each `agents/{name}/charter.md` |
| Routing | `routing.md` |
| Models & Config | charters + `config.json` |
| Casting | `casting/registry.json` |
| Decisions | `decisions.md` + `decisions/inbox/` |
| Sessions | `log/` |
| Ceremonies | `ceremonies.md` |
| Skills | `.copilot/skills/` |
| Analytics & Health | derived from the above |

## License

MIT
