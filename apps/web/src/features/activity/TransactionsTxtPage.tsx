// Real-time plain text audit trail page: /transactions.txt
// Displays total transaction count and chronological list (#1 to #N).
// Supports pagination (100 per page) and 'View All' (parallel batching for all 29k+ transactions).

import { useQuery } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Copy, ExternalLink, RefreshCw } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { API_BASE } from "../../lib/api.ts";
import { useExecutionLogs } from "./use-activity-lists.ts";

export function formatTransactionsTextList(logs: any[], startNum = 1, totalCount?: number): string {
  const count = logs.length;
  const total = totalCount ?? count;
  const nowIso = new Date().toISOString();

  let out = `================================================================================\n`;
  out += `                    CHRONICLE AI — KEEPERHUB TRANSACTIONS                       \n`;
  out += `================================================================================\n`;
  out += `Total Transactions Executed: ${total}\n`;
  out += `Showing: Transactions #${startNum} to #${startNum + count - 1} (${count} shown on this page)\n`;
  out += `Last Updated (UTC): ${nowIso}\n`;
  out += `Public Audit URL: https://chronicle-ai-web.vercel.app/transactions.txt\n`;
  out += `================================================================================\n\n`;

  if (count === 0) {
    out += `No transactions executed yet.\n\n`;
  } else {
    logs.forEach((log: any, index: number) => {
      const num = startNum + index;
      const createdAt = log.createdAt || log.created_at || "N/A";
      const actionType = log.actionType || log.action_type || "N/A";
      const status = (log.status || "UNKNOWN").toUpperCase();
      const message = log.message || "No message provided";

      const details =
        typeof log.details === "object" && log.details ? (log.details as Record<string, any>) : {};
      const keeperHubRunId =
        log.keeperHubRunId || log.keeper_hub_run_id || details.keeper_hub_run_id || details.keeperHubRunId || null;
      const txHash =
        log.txHash ||
        log.tx_hash ||
        details.txHash ||
        details.transactionHash ||
        details.registryTxHash ||
        details.payoutTxHash ||
        details.burnTxHash ||
        details.mintTxHash ||
        null;
      const explorerUrl =
        log.explorerUrl ||
        log.explorer_url ||
        details.explorer_url ||
        details.explorerUrl ||
        (txHash ? `https://sepolia.etherscan.io/tx/${txHash}` : null);
      const routing = log.routing || details.routing || null;

      out += `#${num} | [${createdAt}]\n`;
      out += `Action: ${actionType}\n`;
      out += `Status: ${status}\n`;
      if (keeperHubRunId) out += `KeeperHub Run ID: ${keeperHubRunId}\n`;
      if (txHash) out += `Tx Hash: ${txHash}\n`;
      if (explorerUrl) out += `Explorer: ${explorerUrl}\n`;
      if (routing) out += `Routing: ${routing}\n`;
      out += `Message: ${message}\n`;
      out += `--------------------------------------------------------------------------------\n\n`;
    });
  }

  out += `================================================================================\n`;
  out += `End of ChronicleAI Execution Log (Showing ${count} of ${total} Total Transactions)\n`;
  out += `================================================================================\n`;

  return out;
}

export function TransactionsTxtPage(): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const [page, setPage] = useState<number | "all">(1);
  const [limit, setLimit] = useState<number>(100);

  // Poll raw text endpoint with page and limit parameters
  const { data: rawText, isFetching, refetch } = useQuery({
    queryKey: ["transactions-txt-raw", page, limit],
    queryFn: async () => {
      try {
        const url = `${API_BASE.replace(/\/+$/, "")}/transactions.txt?page=${page}&limit=${limit}`;
        const res = await fetch(url);
        if (res.ok) {
          return await res.text();
        }
      } catch {
        // Fall back to client query if server endpoint unreachable
      }
      return null;
    },
    refetchInterval: 5000,
  });

  // Client-side fallback using execution logs list
  const logsState = useExecutionLogs(limit);
  const fallbackLogs = (logsState.items ?? []).slice().reverse(); // reverse from DESC to ASC (1st to last)

  const textContent =
    rawText && rawText.length > 0 ? rawText : formatTransactionsTextList(fallbackLogs, 1, logsState.pagination.total);

  const logsCount = logsState.pagination.total ?? 0;
  const totalPages = Math.ceil(logsCount / limit) || 1;

  const handleCopy = () => {
    navigator.clipboard.writeText(textContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#090a0f",
        color: "#38bdf8",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        padding: "16px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
          marginBottom: "16px",
          paddingBottom: "12px",
          borderBottom: "1px solid #1e293b",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <span style={{ fontWeight: "bold", fontSize: "14px", color: "#f8fafc" }}>
            transactions.txt
          </span>
          <span
            style={{
              fontSize: "12px",
              padding: "2px 8px",
              borderRadius: "4px",
              backgroundColor: "#0369a1",
              color: "#f0f9ff",
              fontWeight: "600",
            }}
          >
            {logsCount > 0 ? `${logsCount.toLocaleString()} Total Transactions` : "Loading..."}
          </span>
          <span
            style={{
              fontSize: "11px",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              color: "#34d399",
            }}
          >
            <RefreshCw
              style={{
                width: "12px",
                height: "12px",
                animation: isFetching ? "spin 1s linear infinite" : "none",
              }}
            />
            Realtime (5s)
          </span>
        </div>

        {/* Pagination controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          {page !== "all" && (
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => (typeof p === "number" ? Math.max(1, p - 1) : 1))}
                style={{
                  padding: "4px 8px",
                  fontSize: "12px",
                  backgroundColor: page <= 1 ? "#0f172a" : "#1e293b",
                  color: page <= 1 ? "#475569" : "#f8fafc",
                  border: "1px solid #334155",
                  borderRadius: "4px",
                  cursor: page <= 1 ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <ChevronLeft style={{ width: "14px", height: "14px" }} /> Prev
              </button>
              <span style={{ fontSize: "12px", color: "#94a3b8", padding: "0 4px" }}>
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => (typeof p === "number" ? Math.min(totalPages, p + 1) : 1))}
                style={{
                  padding: "4px 8px",
                  fontSize: "12px",
                  backgroundColor: page >= totalPages ? "#0f172a" : "#1e293b",
                  color: page >= totalPages ? "#475569" : "#f8fafc",
                  border: "1px solid #334155",
                  borderRadius: "4px",
                  cursor: page >= totalPages ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                Next <ChevronRight style={{ width: "14px", height: "14px" }} />
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setPage(page === "all" ? 1 : "all")}
            style={{
              padding: "4px 10px",
              fontSize: "12px",
              backgroundColor: page === "all" ? "#7c3aed" : "#1e293b",
              color: "#f8fafc",
              border: "1px solid #6d28d9",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "600",
            }}
          >
            {page === "all" ? "Paginated View (100/pg)" : `Fetch All (${logsCount.toLocaleString()})`}
          </button>

          <button
            onClick={handleCopy}
            type="button"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "12px",
              backgroundColor: "#1e293b",
              color: "#f8fafc",
              border: "1px solid #334155",
              borderRadius: "4px",
              padding: "6px 12px",
              cursor: "pointer",
            }}
          >
            {copied ? <Check style={{ width: "14px", height: "14px", color: "#4ade80" }} /> : <Copy style={{ width: "14px", height: "14px" }} />}
            {copied ? "Copied" : "Copy .txt"}
          </button>
          <a
            href={`${API_BASE.replace(/\/+$/, "")}/transactions.txt?page=${page}&limit=${limit}`}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "12px",
              backgroundColor: "#0284c7",
              color: "#ffffff",
              borderRadius: "4px",
              padding: "6px 12px",
              textDecoration: "none",
              fontWeight: "500",
            }}
          >
            Raw API <ExternalLink style={{ width: "14px", height: "14px" }} />
          </a>
        </div>
      </div>

      <pre
        style={{
          margin: 0,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontSize: "13px",
          lineHeight: "1.5",
          color: "#e2e8f0",
          backgroundColor: "#0f172a",
          padding: "16px",
          borderRadius: "8px",
          border: "1px solid #1e293b",
          overflowX: "auto",
        }}
      >
        {textContent}
      </pre>
    </div>
  );
}
