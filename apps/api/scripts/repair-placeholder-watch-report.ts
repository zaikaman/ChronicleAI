/**
 * One-shot: regenerate narrative for a completed sponsored watch stuck with
 * placeholder ("...") LLM copy, or force-refresh with --force.
 * Does NOT re-publish on-chain.
 *
 * Usage (from apps/api):
 *   pnpm exec tsx --env-file=.env scripts/repair-placeholder-watch-report.ts <watchId> [--force]
 */
import { createClient } from "@supabase/supabase-js";
import {
  createExecutionLogRepository,
  createMonitoredEventRepository,
  createSponsoredWatchRepository,
} from "@chronicleai/db";
import { isPlaceholderSponsoredReport } from "../src/services/sponsored-watch-report-service.ts";
import { createSponsoredWatchService } from "../src/services/sponsored-watch-service.ts";

const watchId = process.argv[2];
const force = process.argv.includes("--force");
if (!watchId) {
  console.error(
    "Usage: repair-placeholder-watch-report.ts <watchId> [--force]",
  );
  process.exit(1);
}

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

// Use the real campaign service so RPC window fallback + quality gates apply.
const watchService = createSponsoredWatchService({
  watchRepo,
  execLogRepo,
  eventRepo,
  frontendOrigin: process.env.FRONTEND_ORIGIN || "https://chronicle-ai-web.vercel.app",
  web3Client: null,
});

const found = await watchRepo.findById(watchId);
if (!found.ok || !found.value) {
  console.error("Watch not found:", found.ok ? null : found.error.message);
  process.exit(1);
}
const watch = found.value;

const needsRepair = isPlaceholderSponsoredReport({
  reportTitle: watch.report_title,
  reportSummary: watch.report_summary,
  reportAnalysis: watch.report_analysis,
  reportHighlights: watch.report_highlights,
});

// Also re-run when the body claims zero events but source_event_ids were stored
// (classic RPC-orphan / bad empty-template repair).
const suspiciousEmpty =
  (watch.source_event_ids?.length ?? 0) > 0 &&
  (watch.monitored_event_count ?? 0) === 0 &&
  (watch.report_summary ?? "").toLowerCase().includes("no qualifying");

if (!needsRepair && !force && !suspiciousEmpty) {
  console.log("Watch already has a real narrative; pass --force to regenerate.");
  console.log("title:", watch.report_title);
  process.exit(0);
}

// processCampaignCycle step 4 only — call repair via a full cycle filtered by forcing
// placeholder detection: temporarily the service repairs isPlaceholder rows.
// For --force / suspiciousEmpty we update via an internal cycle after clearing title.
if (!needsRepair && (force || suspiciousEmpty)) {
  const cleared = await watchRepo.update(watchId, {
    report_title: "...",
    report_summary: "...",
    report_highlights: ["..."],
    report_analysis: "...",
  });
  if (!cleared.ok) {
    console.error("Failed to mark watch for repair:", cleared.error.message);
    process.exit(1);
  }
}

const cycle = await watchService.processCampaignCycle(new Date());
console.log("cycle", {
  completed: cycle.completed,
  repaired: cycle.repaired,
  failed: cycle.failed,
  errors: cycle.errors,
});

const after = await watchRepo.findById(watchId);
if (!after.ok || !after.value) {
  console.error("Watch missing after repair");
  process.exit(1);
}
const w = after.value;
console.log("Repaired watch", watchId);
console.log("title:", w.report_title);
console.log("summary:", (w.report_summary ?? "").slice(0, 240));
console.log("highlights:", w.report_highlights?.length ?? 0);
console.log("events:", w.monitored_event_count);
console.log("preserved report_tx_hash:", w.report_tx_hash);

if (
  isPlaceholderSponsoredReport({
    reportTitle: w.report_title,
    reportSummary: w.report_summary,
    reportAnalysis: w.report_analysis,
    reportHighlights: w.report_highlights,
  })
) {
  console.error("Still placeholder after repair");
  process.exit(1);
}
