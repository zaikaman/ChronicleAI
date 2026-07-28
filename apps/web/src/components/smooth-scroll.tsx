import { useEffect, type ReactNode } from "react";
import Lenis from "lenis";
import { features } from "@/lib/config";

const LENIS_OPTIONS = {
  duration: 1.6,
  easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
  orientation: "vertical" as const,
  gestureOrientation: "vertical" as const,
  smoothWheel: true,
  wheelMultiplier: 1,
  touchMultiplier: 2,
};

interface SmoothScrollProps {
  children?: ReactNode;
  /**
   * When false, Lenis is not mounted. Product routes use a nested scroll container
   * (`#main-content`); Lenis only drives the document and would swallow wheel events.
   * Keep enabled on the marketing landing page only.
   */
  enabled?: boolean;
}

/**
 * Marketing-only smooth scrolling via Lenis.
 * Must not run on product AppShell routes — those scroll inside an overflow panel.
 */
export function SmoothScroll({
  children,
  enabled = true,
}: SmoothScrollProps): ReactNode {
  useEffect(() => {
    if (!enabled || !features.smoothScroll) return;

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (prefersReducedMotion) return;

    const lenis = new Lenis(LENIS_OPTIONS);
    let rafId = 0;

    function raf(time: number) {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    }

    rafId = requestAnimationFrame(raf);

    function handleAnchorClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      const anchor = target.closest('a[href^="#"]');
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href || href === "#") return;

      const element = document.querySelector(href);
      if (!element) return;

      e.preventDefault();
      lenis.scrollTo(element as HTMLElement, { offset: -100 });
    }

    document.addEventListener("click", handleAnchorClick);

    return () => {
      document.removeEventListener("click", handleAnchorClick);
      cancelAnimationFrame(rafId);
      lenis.destroy();
    };
  }, [enabled]);

  return children ? <>{children}</> : null;
}
