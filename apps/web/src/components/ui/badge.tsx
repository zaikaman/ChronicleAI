import type { ReactNode } from "react";

type BadgeVariant = "default" | "success" | "warning" | "error" | "accent" | "muted";

const variants: Record<BadgeVariant, string> = {
  default: "bg-foreground/10 text-foreground",
  success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  warning: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  error: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  accent: "bg-accent text-black",
  muted: "bg-muted text-muted-foreground",
};

export function Badge({
  children,
  variant = "default",
  className = "",
}: {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}): ReactNode {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${variants[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
