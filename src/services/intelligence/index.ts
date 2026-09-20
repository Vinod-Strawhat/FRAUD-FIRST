import type { CorrelationResult, ExtractedFact } from "@/types";

export interface IntelligenceService {
  extractFacts(incidentId: string): Promise<ExtractedFact[]>;
  correlate(incidentId: string): Promise<CorrelationResult>;
}

/**
 * Placeholder contract only — no AI functionality exists yet.
 * Intelligence-backed implementations (e.g. AWS Bedrock/Comprehend)
 * will replace this in a later task without changing call sites.
 */
export class PlaceholderIntelligenceService implements IntelligenceService {
  async extractFacts(incidentId: string): Promise<ExtractedFact[]> {
    void incidentId;
    return [];
  }

  async correlate(incidentId: string): Promise<CorrelationResult> {
    return {
      incidentId,
      matchedSignals: [],
      createdAt: new Date().toISOString(),
    };
  }
}

export const intelligenceService: IntelligenceService =
  new PlaceholderIntelligenceService();