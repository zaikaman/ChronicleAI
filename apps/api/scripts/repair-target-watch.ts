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
const reportService = createSponsoredWatchReportService();

const watchService = createSponsoredWatchService({
  watchRepo,
  execLogRepo,
  eventRepo,
  reportService,
  frontendOrigin: "https://chronicle-ai-web.vercel.app",
  web3Client: null,
});

async function repairWatch() {
  const watchId = "f4fc7552-9b1e-42b7-ac88-952f9f12a590";
  const found = await watchRepo.findById(watchId);
  if (!found.ok || !found.value) {
    console.error("Watch not found");
    process.exit(1);
  }
  const watch = found.value;
  console.log("Found watch:", watch.id, "target:", watch.target_contract);

  // Directly run completeWatch logic on this watch
  // 1) Collect events using our updated service logic
  // (which will fetch from Etherscan V2 / RPC and persist to monitored_events table in Supabase)
  console.log("Collecting matching events for watch...");
  // We can query events via eventRepo / collectMatchingEvents
  const events = await (watchService as any).getActiveWatches ? null : null; // service is object

  // Regenerate report
  console.log("Generating report from updated event matcher...");
  // Call internal helper or completeWatch
  const r = await watchRepo.update(watchId, {
    status: "monitoring",
  });
  console.log("Updated status to monitoring temporarily:", r.ok);

  const cycleResult = await watchService.processCampaignCycle(new Date());
  console.log("Cycle result:", cycleResult);

  const after = await watchRepo.findById(watchId);
  if (after.ok && after.value) {
    console.log("\n--- WATCH REPAIRED ---");
    console.log("ID:", after.value.id);
    console.log("Monitored Event Count:", after.value.monitored_event_count);
    console.log("Source Event IDs length:", after.value.source_event_ids?.length);
    console.log("Title:", after.value.report_title);
    console.log("Summary:", after.value.report_summary?.slice(0, 300));
    console.log("Highlights:", after.value.report_highlights);
  }
}

repairWatch().catch(console.error);
