import fs from "node:fs";
import path from "node:path";

function loadEnvFile() {
  for (const rel of ["apps/api/.env", ".env"]) {
    const envPath = path.resolve(process.cwd(), rel);
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  }
}

async function main() {
  loadEnvFile();
  const apiBaseUrl = process.env.KEEPERHUB_API_BASE_URL?.replace(/\/+$/, "");
  const apiKey = process.env.KEEPERHUB_API_KEY;

  const executionIds = ["4sib9rpx2olah4s1bhxs6", "lkev73cau2wpfjdbxz3cv", "0v06qgz2dd2subyhbh9wv"];

  for (const execId of executionIds) {
    console.log(`\n=== KEEPERHUB EXECUTION ${execId} ===`);
    const res = await fetch(`${apiBaseUrl}/api/workflows/executions/${execId}/status`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });
    console.log(`HTTP ${res.status}`);
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  }
}

main().catch(console.error);
