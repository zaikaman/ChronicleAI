// Real-time plain text audit trail page: /transactions.txt
// Displays total transaction count and chronological list (#1 to #N).
// Auto-refreshes in real-time.

import { useQuery } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, RefreshCw } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { API_BASE } from "../../lib/api.ts";
import { useExecutionLogs } from "./use-activity-lists.ts";

export function formatTransactionsTextList(logs: any[]): string {
  const count = logs.length;
  const nowIso = new Date().toISOString();

  let out = `================================================================================\n`;
  out += `                    CHRONICLE AI — KEEPERHUB TRANSACTIONS                       \n`;
  out += `================================================================================\n`;
  out += `Total Transactions Executed: ${count}\n`;
  out += `Last Updated (UTC): ${nowIso}\n`;
  out += `Order: Chronological (#1 = 1st transaction executed, #${count} = latest)\n`;
  out += `Public Audit URL: https://chronicle-ai-web.vercel.app/transactions.txt\n`;
  out += `================================================================================\n\n`;

  if (count === 0) {
    out += `No transactions executed yet.\n\n`;
  } else {
    logs.forEach((log: any, index: number) => {
      const num = index + 1;
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
  out += `End of ChronicleAI KeeperHub Execution Audit Trail (${count} total transactions)\n`;
  out += `================================================================================\n`;

  return out;
}

export function TransactionsTxtPage(): React.ReactElement {
  const [copied, setCopied] = useState(false);

  // Poll raw text endpoint or execution logs list every 5 seconds for real-time updates
  const { data: rawText, isFetching, refetch } = useQuery({
    queryKey: ["transactions-txt-raw"],
    queryFn: async () => {
      try {
        const res = await fetch(`${API_BASE.replace(/\/+$/, "")}/transactions.txt`);
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
  const logsState = useExecutionLogs(100);
  const fallbackLogs = (logsState.items ?? []).slice().reverse(); // reverse from DESC to ASC (1st to last)

  const textContent =
    rawText && rawText.length > 0 ? rawText : formatTransactionsTextList(fallbackLogs);

  const logsCount =
    logsState.pagination.total ?? (fallbackLogs.length > 0 ? fallbackLogs.length : 0);

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
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
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
            {logsCount} Transactions
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

        <div style={{ display: "flex", gap: "8px" }}>
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
            href={`${API_BASE.replace(/\/+$/, "")}/transactions.txt`}
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
