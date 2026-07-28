import type { ReactElement } from "react";
import { sepoliaTxUrl, truncateHash } from "../../lib/explorer.ts";

interface ProofMonoLinkProps {
  value: string;
  href?: string | null | undefined;
  label?: string | undefined;
  asTx?: boolean | undefined;
  title?: string | undefined;
  "data-testid"?: string | undefined;
}

/** Mono hash/run id with optional explorer link — proof-first, not decorative. */
export function ProofMonoLink({
  value,
  href,
  label,
  asTx = false,
  title,
  "data-testid": dataTestId,
}: ProofMonoLinkProps): ReactElement {
  const resolvedHref = href ?? (asTx ? sepoliaTxUrl(value) : undefined);
  const display = label ?? truncateHash(value);
  const className =
    "font-mono text-[11px] sm:text-xs text-muted-foreground hover:text-foreground transition-colors break-all";

  if (resolvedHref) {
    return (
      <a
        href={resolvedHref}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        title={title ?? value}
        data-testid={dataTestId}
      >
        {display}
      </a>
    );
  }

  return (
    <code className={className} title={title ?? value} data-testid={dataTestId}>
      {display}
    </code>
  );
}
