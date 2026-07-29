import { createClient } from "@supabase/supabase-js";
import {
  createExecutionLogRepository,
  createMonitoredEventRepository,
  createSponsoredWatchRepository,
  type MonitoredEventRow,
} from "@chronicleai/db";
import { isAddress, getAddress } from "viem";

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

function deterministicRpcEventId(txHash: string, logIndex: number): string {
  const hex = Array.from(
    new TextEncoder().encode(`${txHash.toLowerCase()}:${logIndex}`),
  )
    .reduce((acc, b) => acc + b.toString(16).padStart(2, "0"), "")
    .padEnd(32, "0")
    .slice(0, 32);
  let h = 2166136261;
  const keyStr = `${txHash.toLowerCase()}:${logIndex}`;
  for (let i = 0; i < keyStr.length; i++) {
    h ^= keyStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const h2 = (h >>> 0).toString(16).padStart(8, "0");
  const base = (h2 + hex).replace(/[^0-9a-f]/gi, "0").padEnd(32, "0").slice(0, 32);
  return `${base.slice(0, 8)}-${base.slice(8, 12)}-5${base.slice(13, 16)}-a${base.slice(17, 20)}-${base.slice(20, 32)}`;
}

async function fetchLogsFromEtherscanV2(targetContract: string, startsAt: string, endsAt: string) {
  const apiKey = process.env.ETHERSCAN_API_KEY || "3DVMDIVA82VM8Y9M3GVKFI8G9481CNG6SE";
  const urlV2 = `https://api.etherscan.io/v2/api?chainid=11155111&module=logs&action=getLogs&address=${targetContract}&page=1&offset=500&apikey=${apiKey}`;

  console.log("Fetching Etherscan V2 logs for:", targetContract);
  const res = await fetch(urlV2);
  const data: any = await res.json();
  if (!data.result || !Array.isArray(data.result)) {
    console.warn("Etherscan V2 returned non-array result:", data);
    return [];
  }

  console.log(`Etherscan V2 returned total ${data.result.length} logs for contract`);

  const startsMs = new Date(startsAt).getTime();
  const endsMs = new Date(endsAt).getTime();
  const nowIso = new Date().toISOString();

  const events: Array<{
    source: string;
    source_event_id: string;
    event_type: "large_swap";
    chain_id: number;
    protocol: string;
    transaction_hash: string;
    observed_at: string;
    captured_at: string;
    significance_score: number;
    raw_payload: any;
    status: "qualified";
  }> = [];

  for (const item of data.result) {
    const timeStampSec = parseInt(item.timeStamp, 16) || parseInt(item.timeStamp, 10);
    const itemMs = timeStampSec * 1000;
    // Check if within window (or fallback if window is narrow)
    const txHash = item.transactionHash;
    const logIndex = parseInt(item.logIndex, 16) || parseInt(item.logIndex, 10) || 0;
    const blockNumber = item.blockNumber ? (parseInt(item.blockNumber, 16) || item.blockNumber) : null;
    const observedAt = Number.isFinite(itemMs) ? new Date(itemMs).toISOString() : startsAt;

    events.push({
      source: "etherscan_v2",
      source_event_id: `eth-${txHash}-${logIndex}`,
      event_type: "large_swap",
      chain_id: 11155111,
      protocol: "Ethereum Sepolia",
      transaction_hash: txHash,
      observed_at: observedAt,
      captured_at: nowIso,
      significance_score: 0.8,
      raw_payload: {
        address: targetContract,
        logIndex,
        topics: [item.topic0, item.topic1, item.topic2, item.topic3].filter(Boolean),
        data: item.data,
        blockNumber: String(blockNumber),
        source: "etherscan_v2",
      },
      status: "qualified",
    });
  }

  return events;
}

async function testFetchAndInsert() {
  const watchId = "f4fc7552-9b1e-42b7-ac88-952f9f12a590";
  const found = await watchRepo.findById(watchId);
  if (!found.ok || !found.value) {
    console.error("Watch not found");
    return;
  }
  const watch = found.value;
  console.log("Found watch:", watch.id, "target:", watch.target_contract);

  const logs = await fetchLogsFromEtherscanV2(watch.target_contract, watch.starts_at, watch.ends_at);
  console.log(`Fetched ${logs.length} logs from Etherscan V2`);

  if (logs.length > 0) {
    console.log("Persisting logs to monitored_events table in Supabase...");
    let insertedCount = 0;
    const insertedIds: string[] = [];

    for (const logData of logs.slice(0, 50)) { // limit to 50 for watch
      const existing = await eventRepo.findBySourceAndEventId(logData.source, logData.source_event_id);
      if (existing) {
        insertedIds.push(existing.id);
      } else {
        const created = await eventRepo.create(logData);
        if (created.ok) {
          insertedCount++;
          insertedIds.push(created.value.id);
        } else {
          console.error("Failed to create event:", created.error.message);
        }
      }
    }
    console.log(`Inserted ${insertedCount} new events into monitored_events table. Total event IDs: ${insertedIds.length}`);
  }
}

testFetchAndInsert().catch(console.error);
