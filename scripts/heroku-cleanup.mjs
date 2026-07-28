/**
 * Heroku cleanup: drop non-runtime trees from the slug after the API bundle
 * is produced. The esbuild bundle already inlines workspace TypeScript.
 */
import { existsSync, rmSync } from "node:fs";

const dropPaths = [
  "apps/web",
  "packages/contracts",
  "packages/testing",
  "example",
  "keeperhub",
  "docs",
  "specs",
  "tests",
  "workflows",
  "supabase",
  ".agents",
  ".specify",
  ".codex",
  ".impeccable",
  "apps/api/src",
  "apps/api/scripts",
  "scripts",
];

for (const path of dropPaths) {
  if (!existsSync(path)) continue;
  rmSync(path, { recursive: true, force: true });
  console.log(`heroku-cleanup: removed ${path}`);
}

console.log("heroku-cleanup: done");
