export const siteConfig = {
  name: "FraudFirst",
  tagline:
    "The incident-response layer for people who have just been scammed.",
  description:
    "The first 15 minutes after a scam matter. FraudFirst is an incident-response layer that helps scam victims preserve what happened, organize the evidence, and follow the right next steps — 1930, banks, and reporting portals included as guidance, never replaced.",
  url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  version: "0.2.0",
  buildStatus: "landing",
} as const;

export type SiteConfig = typeof siteConfig;