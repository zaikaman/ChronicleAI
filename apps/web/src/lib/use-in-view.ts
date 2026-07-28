// IntersectionObserver helper for progressive panel loading (P1-3).

import { useEffect, useRef, useState, type RefObject } from "react";

export interface UseInViewOptions {
  /** Root margin to prefetch slightly before the element enters the viewport. */
  rootMargin?: string;
  /** Once visible, stay enabled (default true — good for data panels). */
  once?: boolean;
  /** Start enabled without waiting for intersection (e.g. above-the-fold). */
  initiallyVisible?: boolean;
}

export function useInView<T extends Element = HTMLDivElement>(
  options: UseInViewOptions = {},
): { ref: RefObject<T | null>; inView: boolean } {
  const { rootMargin = "200px 0px", once = true, initiallyVisible = false } = options;
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(initiallyVisible);

  useEffect(() => {
    if (initiallyVisible && once) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      // SSR / no IO — enable so data still loads.
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            if (once) observer.disconnect();
          } else if (!once) {
            setInView(false);
          }
        }
      },
      { rootMargin, threshold: 0 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin, once, initiallyVisible]);

  return { ref, inView };
}
