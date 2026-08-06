// Watch page — demo front door: request a watch, get Telegram alerts with proof, report onchain.

import { type ReactElement } from "react";
import { Bell, Eye, FileCheck } from "lucide-react";
import { Page, PageHeader, PageSection, Surface } from "../../components/page-chrome.tsx";
import { PaginationControls } from "../../components/pagination-controls.tsx";
import { useSponsoredWatches } from "../premium/use-premium.ts";
import { WatchList } from "./WatchList.tsx";
import { WatchRequestForm } from "./WatchRequestForm.tsx";

const FLOW_STEPS = [
  {
    id: "watch",
    label: "Watch",
    detail: "Pick a wallet, contract, or protocol and open a campaign window.",
    icon: Eye,
  },
  {
    id: "alert",
    label: "Alert",
    detail: "Telegram delivery with proof the event is real.",
    icon: Bell,
  },
  {
    id: "report",
    label: "Report",
    detail: "Final report published onchain with a registry receipt.",
    icon: FileCheck,
  },
] as const;

export function WatchPage(): ReactElement {
  const {
    watches,
    pagination,
    setPage,
    isLoading,
    refetch,
  } = useSponsoredWatches(10);

  return (
    <Page data-testid="watch-page">
      <PageHeader
        title="Watch any wallet, contract, or protocol. Get alerts on Telegram — provably real, onchain."
        description="Tell ChronicleAI what to monitor. It watches the window, alerts you with proof, and publishes the final report onchain."
        meta={
          !isLoading ? (
            <span>
              {watches.length} campaign{watches.length !== 1 ? "s" : ""}
            </span>
          ) : undefined
        }
      />

      <Surface
        className="mb-10 p-4 sm:p-5"
        data-testid="watch-flow-strip"
        as="section"
      >
        <ol className="grid gap-4 sm:grid-cols-3 list-none m-0 p-0">
          {FLOW_STEPS.map((step, index) => {
            const Icon = step.icon;
            return (
              <li key={step.id} className="flex gap-3 min-w-0">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted border border-border text-foreground"
                  aria-hidden="true"
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground m-0">
                    <span className="text-muted-foreground font-medium tabular-nums mr-1.5">
                      {index + 1}.
                    </span>
                    {step.label}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed m-0">
                    {step.detail}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </Surface>

      <PageSection
        title="Open a watch"
        description="Pay to monitor a target during a campaign window. Creation and final report each leave an onchain receipt."
      >
        <WatchRequestForm
          onSettled={() => {
            void refetch();
          }}
        />
      </PageSection>

      <PageSection
        title="Active campaigns"
        description="Paid monitoring campaigns with a public audit trail."
        className="pt-2 border-t border-border"
      >
        <WatchList watches={watches} isLoading={isLoading} />
        <PaginationControls
          pagination={pagination}
          onPageChange={setPage}
          disabled={isLoading}
          data-testid="watch-list-pagination"
        />
      </PageSection>
    </Page>
  );
}
