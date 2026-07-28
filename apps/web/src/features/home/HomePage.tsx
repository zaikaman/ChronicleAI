import type { ReactElement } from "react";
import { Hero } from "../../components/hero.tsx";
import { BlurInHeadline } from "../../components/blur-in-headline.tsx";
import { FeaturesBento } from "../../components/features-bento.tsx";
import { HowItWorks } from "../../components/how-it-works.tsx";
import { FAQ } from "../../components/faq.tsx";
import { Footer } from "../../components/footer.tsx";
import { useHomeLiveData } from "./use-home-live-data.ts";

export function HomePage(): ReactElement {
  // P1-2: establish shared React Query subscriptions once at the page root so
  // Hero + FeaturesBento reuse the same alerts/activity/desk cache (1× each).
  useHomeLiveData();

  return (
    <div className="flex-1">
      <Hero />
      <BlurInHeadline />
      <FeaturesBento />
      <HowItWorks />
      <FAQ />
      <Footer />
    </div>
  );
}
