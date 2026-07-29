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

  console.log("=== ALL DRAFT ALERTS IN DATABASE ===");
  const { data: draftAlerts, error: err } = await supabase
    .from("public_alerts")
    .select("*")
    .eq("delivery_status", "draft")
    .order("created_at", { ascending: false });

  if (err) {
    console.error("Error:", err);
    return;
  }

  console.log(`Found ${draftAlerts.length} draft alerts:\n`);
  for (const a of draftAlerts) {
    console.log(`Alert ID: ${a.id}`);
    console.log(`  Title: ${a.title}`);
    console.log(`  Created At: ${a.created_at}`);
    console.log(`  Content URI: ${a.content_uri}`);
    console.log(`  Content Hash: ${a.content_hash}`);
    console.log(`  KeeperHub Run ID: ${a.keeper_hub_run_id}`);
    console.log(`  Registry Tx Hash: ${a.registry_tx_hash}`);
    
    // Check logs for this alert
    const { data: logs } = await supabase
      .from("execution_logs")
      .select("*")
      .eq("entity_id", a.id)
      .order("created_at", { ascending: false });

    console.log(`  Execution logs (${logs?.length || 0}):`);
    logs?.forEach(l => {
      console.log(`    - [${l.action_type}] status=${l.status} msg="${l.message}"`);
    });
    console.log("");
  }
}

main().catch(console.error);
