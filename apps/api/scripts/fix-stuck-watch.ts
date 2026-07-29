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

  console.log(`Fixing watch ${watchId}...`);

  const { data: updated, error } = await supabase
    .from("sponsored_watches")
    .update({
      status: "completed",
      report_title: "ChronicleAI Sponsored Watch Report: Target Contract Monitoring Complete",
      report_summary: "Campaign completed. Report recorded on-chain.",
      report_tx_hash: "0x61574d315adb830d0a9b210dad7ca820e65058513546df4a9e13bf9ac2e37a1f",
    })
    .eq("id", watchId)
    .select()
    .single();

  if (error) {
    console.error("Failed to update watch:", error);
  } else {
    console.log("Successfully updated watch to completed status:", updated.id, updated.status);
  }
}

main().catch(console.error);
