import { createClient } from "@supabase/supabase-js";
import {
  createExecutionLogRepository,
  createMonitoredEventRepository,
  createSponsoredWatchRepository,
} from "@chronicleai/db";
import { createSponsoredWatchService } from "../src/services/sponsored-watch-service.ts";
import { createSponsoredWatchReportService } from "../src/services/sponsored-watch-report-service.ts";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const watchRepo = createSponsoredWatchRepository(supabase);
const eventRepo = createMonitoredEventRepository(supabase);
const execLogRepo = createExecutionLogRepository(supabase);
const reportService = createSponsoredWatchReportService({ providerConfigs: {} as any });

const mockWeb3Client = {
  async publishSponsoredReport() {
    return {
      txHash: "0x70627259da1fe644610f096bab07973c0be5241b5242d44e1b2457070c6c82ca",
      keeperHubRunId: "test-run-123",
      explorerUrl: "https://sepolia.etherscan.io/tx/0x70627259da1fe644610f096bab07973c0be5241b5242d44e1b2457070c6c82ca",
    };
  },
} as any;

const watchService = createSponsoredWatchService({
  watchRepo,
  execLogRepo,
  eventRepo,
  reportService,
  frontendOrigin: "https://chronicle-ai-web.vercel.app",
  web3Client: mockWeb3Client,
});

async function runTwoMinuteCampaign() {
  const targetContract = "0x2bd57c3ca216f0d38b18bcfd14595f12dfb13c35";
  const now = new Date();
  const startsAt = new Date(now.getTime() - 2 * 60 * 1000).toISOString(); // 2 minutes ago
  const endsAt = new Date(now.getTime()).toISOString(); // now

  const watchSpecHash = "0x81e321abbfef2cc8e71db00b958016e1dd541b830868a19262b78e2c5e41524d";

  console.log(`\n=== Creating 2-minute Sponsored Watch Campaign ===`);
  console.log(`Target Contract: ${targetContract}`);
  console.log(`Starts At:       ${startsAt}`);
  console.log(`Ends At:         ${endsAt}`);

  // Clean up failed synthetic test watches without on_chain_watch_id
  await supabase.from("sponsored_watches").delete().eq("status", "accepted").is("on_chain_watch_id", null);

  // 1. Create watch entry in Supabase with on_chain_watch_id
  const createRes = await watchRepo.create({
    target_contract: targetContract,
    watch_spec_hash: watchSpecHash,
    starts_at: startsAt,
    ends_at: endsAt,
    status: "accepted",
    on_chain_watch_id: 3,
    create_tx_hash: "0xea0673acee0a64ac70d841ff4ec82e1f03e5b8fb8784e9b922d53a8c8ef16049",
    create_explorer_url: "https://sepolia.etherscan.io/tx/0xea0673acee0a64ac70d841ff4ec82e1f03e5b8fb8784e9b922d53a8c8ef16049",
  });

  if (!createRes.ok) {
    console.error("Failed to create watch:", createRes.error.message);
    process.exit(1);
  }

  const watch = createRes.value;
  console.log(`Watch created with ID: ${watch.id} (onChainWatchId: ${watch.on_chain_watch_id})`);
  console.log(`Web URL: https://chronicle-ai-web.vercel.app/premium/watches/${watch.id}`);

  // 2. Run campaign cycle (activate -> monitor -> complete)
  console.log("\nRunning campaign cycle (activate -> monitor -> complete)...");
  const cycleResult = await watchService.processCampaignCycle(now);
  console.log("Campaign cycle result:", cycleResult);

  // 3. Fetch final watch state from database
  const finalRes = await watchRepo.findById(watch.id);
  if (!finalRes.ok || !finalRes.value) {
    console.error("Failed to re-fetch watch from database");
    process.exit(1);
  }

  const finalWatch = finalRes.value;
  console.log("\n=== 2-MINUTE CAMPAIGN RESULT ===");
  console.log(`ID:                      ${finalWatch.id}`);
  console.log(`Status:                  ${finalWatch.status}`);
  console.log(`Monitored Event Count:   ${finalWatch.monitored_event_count}`);
  console.log(`Source Event IDs stored: ${finalWatch.source_event_ids?.length ?? 0}`);
  console.log(`Source Event Root:        ${finalWatch.source_event_root}`);
  console.log(`Report Title:            ${finalWatch.report_title}`);
  console.log(`Report Summary:          ${finalWatch.report_summary}`);
  console.log(`Report Highlights Count: ${finalWatch.report_highlights?.length ?? 0}`);
}

runTwoMinuteCampaign().catch(console.error);
