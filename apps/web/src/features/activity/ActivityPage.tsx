// Activity page — "see what happened and verify it" in one stream.
// Unified feed (all events, newest first) + filter chips replace the old 5-tab / 13-panel layout.

import { type ReactElement, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Page, PageHeader, SectionLink } from "../../components/page-chrome.tsx";
import { ActivityFeed } from "./ActivityFeed.tsx";
import { StatusStrip } from "./StatusStrip.tsx";
import type { ActivityFilterId } from "./use-activity-feed.tsx";
import { useActivityFeed } from "./use-activity-feed.tsx";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_FILTERS: ActivityFilterId[] = ["all", "publications", "desk", "money", "system"];

/** Legacy ?tab= values map onto the new filter vocabulary (kept for existing links). */
const LEGACY_TAB_MAP: Record<string, ActivityFilterId> = {
  proofs: "publications",
  overview: "all",
  trading: "desk",
  financials: "money",
  all: "all",
};

export function ActivityPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const feed = useActivityFeed();

  const entityIdRaw = searchParams.get("entityId")?.trim() ?? "";
  const entityId = UUID_RE.test(entityIdRaw) ? entityIdRaw : null;
  const entityTypeRaw = searchParams.get("entityType")?.trim() ?? "";
  const entityType = entityTypeRaw.length > 0 ? entityTypeRaw : null;

  const filterParam = searchParams.get("filter");
  const tabParam = searchParams.get("tab");
  const filterFromUrl: ActivityFilterId =
    filterParam && VALID_FILTERS.includes(filterParam as ActivityFilterId)
      ? (filterParam as ActivityFilterId)
      : tabParam && LEGACY_TAB_MAP[tabParam]
        ? LEGACY_TAB_MAP[tabParam]
        : "all";

  // A deep link to a specific intent defaults to the system log, but only when
  // the visitor has not already picked a filter chip (chip choice wins).
  const activeFilter: ActivityFilterId =
    entityId && filterFromUrl === "all" ? "system" : filterFromUrl;

  const handleFilterChange = (next: ActivityFilterId) => {
    const nextParams = new URLSearchParams(searchParams);
    if (next === "all") {
      nextParams.delete("filter");
    } else {
      nextParams.set("filter", next);
    }
    nextParams.delete("tab");
    setSearchParams(nextParams, { replace: true });
  };

  // Scroll to the execution log panel after paint (ticket deep link).
  useEffect(() => {
    if (!entityId) return;
    const t = window.setTimeout(() => {
      document.getElementById("execution-logs")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 120);
    return () => window.clearTimeout(t);
  }, [entityId]);

  const clearEntityFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("entityId");
    next.delete("entityType");
    setSearchParams(next, { replace: true });
  };

  return (
    <Page data-testid="activity-page">
      <PageHeader
        title="Activity"
        description="Everything ChronicleAI did, newest first: what was published, what money settled, and what the desk recorded — each with proof links when available."
        meta={
          <div className="flex items-center gap-3">
            <SectionLink to="/transactions.txt">Raw transactions.txt →</SectionLink>
            <SectionLink to="/desk">Open desk →</SectionLink>
          </div>
        }
      />

      <div className="mb-8">
        <StatusStrip treasury={feed.treasury} stats={feed.stats} />
      </div>

      <ActivityFeed
        feed={feed}
        filter={activeFilter}
        onFilterChange={handleFilterChange}
        entityId={entityId}
        entityType={entityType}
        onClearEntityFilter={clearEntityFilter}
      />
    </Page>
  );
}
