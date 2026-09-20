import { ActiveIncidentBar } from "@/components/landing/active-incident-bar";
import { EvidencePreview } from "@/components/landing/evidence-preview";
import { FinalCta } from "@/components/landing/final-cta";
import { HeroSection } from "@/components/landing/hero-section";
import { IncidentPipeline } from "@/components/landing/incident-pipeline";
import { IncidentPreview } from "@/components/landing/incident-preview";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";
import { TrustSection } from "@/components/landing/trust-section";

export default function LandingPage() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <ActiveIncidentBar />
        <HeroSection />
        <IncidentPipeline />
        <IncidentPreview />
        <EvidencePreview />
        <TrustSection />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}