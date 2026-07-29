import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile() {
  const envPath = path.resolve(process.cwd(), ".env");
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

async function main() {
  loadEnvFile();
  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

  const targetIds = [
    "0b973095-51ea-4f17-91e6-b554b082902b",
    "f65c4f8f-6b36-4f13-a532-7ee65b266238",
    "d80d2b23-a268-4355-a1e6-cfec661c2379",
    "ec7c4e1d-3c92-4c40-8d59-f398c370e406"
  ];

  console.log("=== LOGS FOR DRAFT ALERTS ===");
  const { data: logs, error: logsErr } = await supabase
    .from("execution_logs")
    .select("*")
    .in("entity_id", targetIds)
    .order("created_at", { ascending: false });

  if (logsErr) console.error("Logs error:", logsErr);
  else console.log(JSON.stringify(logs, null, 2));

  console.log("\n=== ALL RECENT EXECUTION LOGS BETWEEN 07:15 and 07:30 ===");
  const { data: recentLogs, error: rErr } = await supabase
    .from("execution_logs")
    .select("*")
    .gte("created_at", "2026-07-29T07:15:00Z")
    .lte("created_at", "2026-07-29T07:30:00Z")
    .order("created_at", { ascending: false });

  if (rErr) console.error("Recent logs error:", rErr);
  else console.log(JSON.stringify(recentLogs, null, 2));
}

main().catch(console.error);
