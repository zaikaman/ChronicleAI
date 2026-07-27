import type { ReactElement } from "react";
import { Hero } from "../../components/hero.tsx";
import { BlurInHeadline } from "../../components/blur-in-headline.tsx";
import { FeaturesBento } from "../../components/features-bento.tsx";
import { HowItWorks } from "../../components/how-it-works.tsx";
import { FAQ } from "../../components/faq.tsx";
import { Footer } from "../../components/footer.tsx";

export function HomePage(): ReactElement {
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
