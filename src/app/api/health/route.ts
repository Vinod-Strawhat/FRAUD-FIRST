import { siteConfig } from "@/config/site";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    status: "ok",
    service: siteConfig.name,
    version: siteConfig.version,
    build: siteConfig.buildStatus,
    timestamp: new Date().toISOString(),
  });
}