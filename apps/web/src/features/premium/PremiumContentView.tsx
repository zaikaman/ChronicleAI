// Premium content view component
// Renders full premium content only after settled payment

import type React from "react";

interface PremiumContentViewProps {
  content: Record<string, unknown>;
  title: string;
  onClose: () => void;
  "data-testid"?: string;
}

export function PremiumContentView({
  content,
  title,
  onClose,
  "data-testid": dataTestId = "premium-content",
}: PremiumContentViewProps): React.ReactElement {
  // Render the private content based on its structure
  const renderContent = (data: Record<string, unknown>): React.ReactNode => {
    return (
      <div style={{ fontSize: "var(--font-size-sm)", lineHeight: 1.7 }}>
        {Object.entries(data).map(([key, value]) => {
          if (key === "sections" && Array.isArray(value)) {
            return (
              <div key={key} style={{ marginBottom: "1.5rem" }}>
                {value.map((section, idx) => (
                  <div key={idx} style={{ marginBottom: "1rem" }}>
                    {section.title && (
                      <h4
                        style={{
                          fontSize: "var(--font-size-md)",
                          fontWeight: 600,
                          color: "var(--fg-primary)",
                          marginBottom: "0.5rem",
                        }}
                      >
                        {section.title}
                      </h4>
                    )}
                    {section.body && (
                      <p style={{ color: "var(--fg-secondary)", lineHeight: 1.6 }}>
                        {section.body}
                      </p>
                    )}
                    {section.findings && Array.isArray(section.findings) && (
                      <ul
                        style={{
                          paddingLeft: "1.25rem",
                          color: "var(--fg-secondary)",
                          display: "flex",
                          flexDirection: "column",
                          gap: "0.5rem",
                        }}
                      >
                        {section.findings.map((finding: string, fi: number) => (
                          <li key={fi}>{finding}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            );
          }

          if (key === "analysis" && typeof value === "string") {
            return (
              <div key={key} style={{ marginBottom: "1.5rem" }}>
                <h4
                  style={{
                    fontSize: "var(--font-size-md)",
                    fontWeight: 600,
                    color: "var(--fg-primary)",
                    marginBottom: "0.5rem",
                  }}
                >
                  Analysis
                </h4>
                <p style={{ color: "var(--fg-secondary)", lineHeight: 1.6, fontStyle: "italic" }}>
                  {value}
                </p>
              </div>
            );
          }

          if (key === "feedEntries" && Array.isArray(value)) {
            return (
              <div key={key} style={{ marginBottom: "1.5rem" }}>
                <h4
                  style={{
                    fontSize: "var(--font-size-md)",
                    fontWeight: 600,
                    color: "var(--fg-primary)",
                    marginBottom: "0.5rem",
                  }}
                >
                  Feed Entries
                </h4>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", fontSize: "var(--font-size-xs)", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border-primary)" }}>
                        {Object.keys(value[0] ?? {}).map((col) => (
                          <th
                            key={col}
                            style={{
                              padding: "0.5rem 0.75rem",
                              textAlign: "left",
                              color: "var(--fg-tertiary)",
                              textTransform: "capitalize",
                            }}
                          >
                            {col.replace(/([A-Z])/g, " $1").trim()}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {value.map((entry, idx) => (
                        <tr
                          key={idx}
                          style={{ borderBottom: "1px solid var(--border-primary)" }}
                        >
                          {Object.values(entry).map((val, vi) => (
                            <td
                              key={vi}
                              style={{
                                padding: "0.5rem 0.75rem",
                                color: "var(--fg-secondary)",
                                fontFamily: typeof val === "number" ? "var(--font-mono)" : undefined,
                              }}
                            >
                              {String(val)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          }

          // Skip metadata keys handled above
          if (["sections", "analysis", "feedEntries", "campaign"].includes(key)) {
            return null;
          }

          return null;
        })}
      </div>
    );
  };

  return (
    <div
      className="card"
      data-testid={dataTestId}
      style={{
        border: "1px solid var(--accent-primary)",
        position: "relative",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1.5rem",
        }}
      >
        <h3
          style={{
            fontSize: "var(--font-size-xl)",
            fontWeight: 700,
            color: "var(--fg-primary)",
          }}
        >
          {title}
        </h3>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--fg-tertiary)",
            cursor: "pointer",
            fontSize: "var(--font-size-lg)",
            padding: "0.25rem",
            lineHeight: 1,
          }}
          aria-label="Close"
        >
          &times;
        </button>
      </div>

      {renderContent(content)}
    </div>
  );
}
