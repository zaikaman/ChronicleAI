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

  console.log("=== ALL SPONSORED WATCHES ===");
  const { data: watches, error: wErr } = await supabase
    .from("sponsored_watches")
    .select("*")
    .order("created_at", { ascending: false });

  if (wErr) console.error("Watches error:", wErr);
  else {
    console.log(`Found ${watches?.length ?? 0} watches:`);
    for (const w of watches ?? []) {
      console.log(JSON.stringify({
        id: w.id,
        on_chain_watch_id: w.on_chain_watch_id,
        target_contract: w.target_contract,
        status: w.status,
        create_tx_hash: w.create_tx_hash,
        report_tx_hash: w.report_tx_hash,
        starts_at: w.starts_at,
        ends_at: w.ends_at,
        monitored_event_count: w.monitored_event_count,
        report_title: w.report_title?.slice(0, 50),
      }, null, 2));
    }
  }

  console.log("\n=== RECENT EXECUTION LOGS FOR SPONSORED WATCHES ===");
  const { data: logs, error: lErr } = await supabase
    .from("execution_logs")
    .select("*")
    .eq("entity_type", "sponsored_watch")
    .order("created_at", { ascending: false })
    .limit(20);

  if (lErr) console.error("Logs error:", lErr);
  else {
    for (const l of logs ?? []) {
      console.log(JSON.stringify({
        id: l.id,
        created_at: l.created_at,
        status: l.status,
        action_type: l.action_type,
        entity_id: l.entity_id,
        message: l.message,
        details: l.details,
      }, null, 2));
    }
  }
}

main().catch(console.error);
