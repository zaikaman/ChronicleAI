// Payout logs table component
// Displays payout records with period, recipient, amount, reason, and transaction hashes

import type React from "react";
import { StatusBadge, TimestampDisplay } from "../../components/data-primitives.tsx";
import { baseSepoliaAddressUrl, baseSepoliaTxUrl } from "../../lib/explorer.ts";

interface PayoutEntry {
  id: string;
  payoutPeriodHash: string;
  recipient: string;
  amount: number;
  reasonHash: string;
  payoutTxHash?: string;
  registryTxHash?: string;
  keeperHubRunId?: string;
  explorerUrl?: string;
  status: string;
  createdAt: string;
}

interface PayoutLogsTableProps {
  payouts: PayoutEntry[];
  isLoading?: boolean;
  "data-testid"?: string;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function getPayoutStatusVariant(status: string): "default" | "success" | "warning" | "error" {
  switch (status) {
    case "transferred":
      return "success";
    case "pending":
      return "warning";
    case "failed":
      return "error";
    default:
      return "default";
  }
}

function truncateAddress(address: string): string {
  if (address.length <= 16) return address;
  return `${address.slice(0, 10)}...${address.slice(-6)}`;
}

function truncateTxHash(hash: string): string {
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

export function PayoutLogsTable({
  payouts,
  isLoading = false,
  "data-testid": dataTestId = "payout-logs-table",
}: PayoutLogsTableProps): React.ReactElement {
  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: "2rem" }}>
        <p style={{ color: "var(--fg-tertiary)", fontSize: "var(--font-size-sm)" }}>
          Loading payout logs...
        </p>
      </div>
    );
  }

  if (payouts.length === 0) {
    return (
      <div
        data-testid={dataTestId}
        style={{
          padding: "1.5rem",
          textAlign: "center",
          background: "var(--bg-glass)",
          borderRadius: "8px",
          border: "1px solid var(--border-primary)",
        }}
      >
        <h3
          style={{
            fontSize: "var(--font-size-md)",
            fontWeight: 600,
            color: "var(--fg-primary)",
            marginBottom: "0.5rem",
          }}
        >
          Payout Logs
        </h3>
        <p style={{ color: "var(--fg-tertiary)", margin: 0, fontSize: "var(--font-size-sm)" }}>
          No payout records yet. Revenue routing will create payout entries when conditions are met.
        </p>
      </div>
    );
  }

  const tableHeaderStyle: React.CSSProperties = {
    padding: "0.75rem 1rem",
    fontSize: "var(--font-size-xs)",
    color: "var(--fg-tertiary)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    textAlign: "left",
    borderBottom: "1px solid var(--border-primary)",
    fontWeight: 600,
  };

  const tableCellStyle: React.CSSProperties = {
    padding: "0.75rem 1rem",
    fontSize: "var(--font-size-sm)",
    color: "var(--fg-secondary)",
    borderBottom: "1px solid var(--border-primary)",
    verticalAlign: "middle",
  };

  return (
    <div data-testid={dataTestId}>
      <h3
        style={{
          fontSize: "var(--font-size-md)",
          fontWeight: 600,
          color: "var(--fg-primary)",
          marginBottom: "1rem",
        }}
      >
        Payout Logs
      </h3>

      <div
        style={{
          overflowX: "auto",
          borderRadius: "12px",
          border: "1px solid var(--border-primary)",
          background: "var(--bg-glass)",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "700px" }}>
          <thead>
            <tr>
              <th style={tableHeaderStyle}>Period</th>
              <th style={tableHeaderStyle}>Recipient</th>
              <th style={tableHeaderStyle}>Amount</th>
              <th style={tableHeaderStyle}>Status</th>
              <th style={tableHeaderStyle}>KeeperHub</th>
              <th style={tableHeaderStyle}>Transfer Tx</th>
              <th style={tableHeaderStyle}>Registry Tx</th>
              <th style={tableHeaderStyle}>Created</th>
            </tr>
          </thead>
          <tbody>
            {payouts.map((payout) => (
              <tr
                key={payout.id}
                style={{ transition: "background 0.1s ease" }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.02)";
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = "";
                }}
              >
                <td style={tableCellStyle}>
                  <code
                    style={{
                      fontSize: "var(--font-size-xs)",
                      fontFamily: "var(--font-mono)",
                      color: "var(--fg-primary)",
                    }}
                  >
                    {payout.payoutPeriodHash.slice(0, 12)}...
                  </code>
                </td>
                <td style={tableCellStyle}>
                  <a
                    href={baseSepoliaAddressUrl(payout.recipient)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: "var(--font-size-xs)",
                      fontFamily: "var(--font-mono)",
                      color: "var(--accent-primary)",
                      textDecoration: "none",
                    }}
                    title={payout.recipient}
                  >
                    {truncateAddress(payout.recipient)}
                  </a>
                </td>
                <td style={{ ...tableCellStyle, fontWeight: 600, color: "var(--fg-primary)" }}>
                  {formatCurrency(payout.amount)}
                </td>
                <td style={tableCellStyle}>
                  <StatusBadge
                    label={payout.status}
                    variant={getPayoutStatusVariant(payout.status)}
                  />
                </td>
                <td style={tableCellStyle}>
                  {payout.keeperHubRunId ? (
                    <div
                      style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}
                      data-testid="payout-executed-via-keeperhub"
                    >
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          color: "var(--accent-primary)",
                        }}
                      >
                        Executed via KeeperHub
                      </span>
                      <code
                        style={{
                          fontSize: "var(--font-size-xs)",
                          fontFamily: "var(--font-mono)",
                          color: "var(--fg-tertiary)",
                        }}
                        title={payout.keeperHubRunId}
                      >
                        {payout.keeperHubRunId.length > 16
                          ? `${payout.keeperHubRunId.slice(0, 10)}...`
                          : payout.keeperHubRunId}
                      </code>
                    </div>
                  ) : (
                    <span style={{ color: "var(--fg-tertiary)" }}>-</span>
                  )}
                </td>
                <td
                  style={{
                    ...tableCellStyle,
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--font-size-xs)",
                  }}
                >
                  {payout.payoutTxHash ? (
                    <a
                      href={payout.explorerUrl ?? baseSepoliaTxUrl(payout.payoutTxHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "var(--accent-success)", textDecoration: "none" }}
                      title={payout.payoutTxHash}
                    >
                      {truncateTxHash(payout.payoutTxHash)}
                    </a>
                  ) : (
                    <span style={{ color: "var(--fg-tertiary)" }}>-</span>
                  )}
                </td>
                <td
                  style={{
                    ...tableCellStyle,
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--font-size-xs)",
                  }}
                >
                  {payout.registryTxHash ? (
                    <a
                      href={payout.explorerUrl ?? baseSepoliaTxUrl(payout.registryTxHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "var(--accent-primary)", textDecoration: "none" }}
                      title={payout.registryTxHash}
                    >
                      {truncateTxHash(payout.registryTxHash)}
                    </a>
                  ) : (
                    <span style={{ color: "var(--fg-tertiary)" }}>-</span>
                  )}
                </td>
                <td style={{ ...tableCellStyle, whiteSpace: "nowrap" }}>
                  <TimestampDisplay timestamp={payout.createdAt} format="relative" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
