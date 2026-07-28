/**
 * Heroku prebuild: slim the pnpm workspace to only packages required to
 * build and run the API. This runs before `pnpm install` so Heroku never
 * downloads web/UI/contracts deps (wagmi, vite, hardhat, etc.).
 *
 * P2-8: drop packages/testing (dev-only; not runtime) and strip the root
 * workspace devDependency so install does not require that package.
 *
 * Must not invent new runtime dependency versions — only remove non-runtime
 * workspace members from the install graph.
 *
 * Heroku's Node buildpack hardcodes `pnpm install --frozen-lockfile` (CLI flag
 * wins over .npmrc). After slimming package.json / workspace, sync the lockfile
 * with `pnpm install --lockfile-only` so the frozen install that follows succeeds.
 */
import { execSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const slimWorkspace = `packages:
  - "apps/api"
  - "packages/config"
  - "packages/db"
  - "packages/schemas"
`;

writeFileSync("pnpm-workspace.yaml", slimWorkspace, "utf8");

// Root package.json lists @chronicleai/testing as a workspace devDep for local
// monorepo tests. On Heroku it is not in the slim workspace — remove so install
// does not fail resolving workspace:*.
const rootPkgPath = "package.json";
const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf8"));
if (rootPkg.devDependencies?.["@chronicleai/testing"]) {
  delete rootPkg.devDependencies["@chronicleai/testing"];
  writeFileSync(rootPkgPath, `${JSON.stringify(rootPkg, null, 2)}\n`, "utf8");
  console.log("heroku-prebuild: stripped @chronicleai/testing from root devDependencies");
}

// Belt-and-suspenders for any pnpm invocation that does not pass a CLI flag.
appendFileSync(".npmrc", "\nfrozen-lockfile=false\n", "utf8");

// Buildpack always runs `pnpm install --frozen-lockfile` after prebuild.
// package.json no longer matches the committed lockfile — rewrite lockfile only.
console.log("heroku-prebuild: syncing pnpm-lock.yaml to slim workspace");
execSync("pnpm install --lockfile-only --no-frozen-lockfile", {
  stdio: "inherit",
  env: {
    ...process.env,
    // Ensure CI default cannot force frozen-lockfile for this rewrite step.
    CI: "",
    NPM_CONFIG_CI: "",
  },
});

console.log(
  "heroku-prebuild: workspace limited to api + config/db/schemas (no testing); lockfile synced",
);
