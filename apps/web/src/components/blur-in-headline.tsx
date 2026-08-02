import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

const headline =
  "ChronicleAI follows one visible loop: publish a public Alert from onchain activity, project eligible Alerts into Desk Signals, apply hard policy, execute the approved Action through KeeperHub, and publish the proof.";

export function BlurInHeadline(): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const words = headline.split(" ");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let ticking = false;

    const handleScroll = () => {
      if (ticking) return;
      ticking = true;

      requestAnimationFrame(() => {
        const rect = container.getBoundingClientRect();
        const windowHeight = window.innerHeight;

        const startOffset = windowHeight * 0.9;
        const endOffset = windowHeight * 0.25;

        const progress = Math.min(
          1,
          Math.max(0, (startOffset - rect.top) / (startOffset - endOffset)),
        );

        setScrollProgress(progress);
        ticking = false;
      });
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <section ref={containerRef} className="w-full bg-background px-6 py-24">
      <div className="mx-auto max-w-5xl">
        <p className="text-3xl font-medium text-left leading-snug tracking-tight text-foreground sm:text-4xl lg:text-5xl lg:leading-snug">
          {words.map((word, index) => {
            const wordStart = index / words.length;
            const wordEnd = wordStart + 1 / words.length;

            const wordProgress = Math.min(
              1,
              Math.max(0, (scrollProgress - wordStart) / (wordEnd - wordStart)),
            );
            const opacity = 0.15 + wordProgress * 0.85;
            const blur = (1 - wordProgress) * 8;

            return (
              <span
                key={`${word}-${wordStart}`}
                className="mr-2 inline-block lg:mr-3"
                style={{
                  opacity,
                  filter: `blur(${blur}px)`,
                  transition: "opacity 75ms, filter 75ms",
                }}
              >
                {word}
              </span>
            );
          })}
        </p>
      </div>
    </section>
  );
}
