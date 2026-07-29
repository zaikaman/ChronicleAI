import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

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
  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

  const watchId = "7f2bfa16-2ee8-4019-91a9-c0483572bbe6";

  console.log("=== ALL EXECUTION LOGS FOR WATCH ===");
  const { data: logs } = await supabase
    .from("execution_logs")
    .select("*")
    .eq("entity_id", watchId)
    .order("created_at", { ascending: true });

  for (const l of logs ?? []) {
    console.log(`[${l.created_at}] [${l.status}] ${l.action_type}: ${l.message}`);
    const details = l.details as any;
    if (details?.error_message) console.log("   Err:", details.error_message);
    if (details?.keeper_hub_run_id) console.log("   KH Run:", details.keeper_hub_run_id);
  }
}

main().catch(console.error);
