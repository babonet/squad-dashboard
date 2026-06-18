#!/usr/bin/env node
// Squad Dashboard — declarative knowledge installer.
//
//   npx squad-dashboard-install        → copies the knowledge guide into .squad/
//
// This is a no-CLI fallback for `squad plugin install squad-dashboard`. It writes a
// single declarative knowledge file into your repo's .squad/knowledge/ so your squad's
// agents know the dashboard exists and how to launch it. It writes nothing else.

import { mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");

// Locate the repo's .squad/ directory by walking up from the current working directory.
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

const root =
  (process.env.SQUAD_ROOT && existsSync(join(process.env.SQUAD_ROOT, ".squad")) && resolve(process.env.SQUAD_ROOT)) ||
  findSquadRoot(process.cwd());

if (!root) {
  console.error(`No .squad/ directory found from ${process.cwd()}. Run inside a squad-enabled repo, or set SQUAD_ROOT.`);
  process.exit(1);
}

// Mirror the plugin.manifest.json target under .squad/.
const src = join(PKG_ROOT, "knowledge", "squad-dashboard.md");
const destDir = join(root, ".squad", "knowledge", "squad-dashboard");
const dest = join(destDir, "squad-dashboard.md");

if (!existsSync(src)) {
  console.error(`Knowledge source not found at ${src}.`);
  process.exit(1);
}

try {
  await mkdir(destDir, { recursive: true });
  await copyFile(src, dest);
  console.log(`Installed dashboard knowledge guide → ${dest}`);
  console.log(`Your squad's agents now know the dashboard exists. Launch it with: npx squad-dashboard`);
} catch (err) {
  console.error(`Failed to install knowledge guide: ${String(err)}`);
  process.exit(1);
}
