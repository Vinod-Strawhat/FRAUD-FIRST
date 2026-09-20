# FRAUDFIRST-TASK-16-REPORT

**Task**: Provider fallbacks — Tesseract OCR + OpenRouter
**Date**: 20 September 2026
**Status**: DONE — all gates green

---

## What shipped

### Extraction fallback: AWS Textract → Tesseract OCR

- **Primary**: AWS Textract (unchanged)
- **Fallback**: Tesseract OCR via `tesseract.js` (server-side only, PNG/JPEG only)
- **Trigger**: Textract fails with subscription/access/config errors → falls back to Tesseract
- **Not eligible for fallback**: Invalid input, too large, unsupported media type
- **Provider metadata**: `source: "tesseract"` and `providerMode: "fallback"` in extraction results

### Correlation fallback: AWS Bedrock → OpenRouter

- **Primary**: AWS Bedrock (unchanged)
- **Fallback**: OpenRouter REST API (server-side only, default model: `meta-llama/llama-4-maverick`)
- **Trigger**: Bedrock fails with ValidationException / operation not allowed / not-configured → falls back to OpenRouter
- **Not eligible for fallback**: Invalid output, programming bugs
- **Response safety**: OpenRouter output validated through existing `normalizeCorrelationOutput()` schema
- **Anti-hallucination**: Same system prompt with anti-injection rules, UNTRUSTED DATA framing, and evidence-id-only referencing

### Honest provider metadata throughout

- Every extraction result carries `provider: "textract" | "tesseract"` and `providerMode: "primary" | "fallback"`
- Every correlation result carries `provider: "bedrock" | "openrouter"` and `providerMode: "primary" | "fallback"`
- API responses include provider metadata
- UI shows actual provider used (e.g., "Tesseract OCR (fallback)", "OpenRouter fallback · Model ...")
- Metadata is backward-compatible with existing persisted records

### Environment variables

- `OPENROUTER_API_KEY` — OpenRouter API key (server-side only)
- `FRAUDFIRST_OPENROUTER_MODEL_ID` — optional, defaults to `meta-llama/llama-4-maverick`
- Added to `.env.example`

---

## Files created/modified

### New files
| File | Purpose |
|------|---------|
| `src/services/providers/types.ts` | Provider abstraction types |
| `src/services/providers/extract.ts` | Extraction fallback orchestration |
| `src/services/providers/correlate.ts` | Correlation fallback orchestration |
| `src/services/extraction/tesseract.ts` | Tesseract OCR adapter |
| `src/services/server/openrouter.ts` | OpenRouter REST adapter |

### Modified files
| File | Change |
|------|--------|
| `src/types/extraction.ts` | Added `"tesseract"` source, `provider`/`providerMode` fields |
| `src/types/correlation.ts` | Added `provider`/`providerMode` fields, OpenRouter error codes |
| `src/services/extraction/index.ts` | Removed `assertAwsConfigured()`, added `extractImageBytesWithMime()` |
| `src/services/correlation/index.ts` | Uses fallback orchestration, validates batch constraints |
| `src/services/correlation/orchestrate.ts` | Propagates `provider`/`providerMode` to persisted meta, handles OpenRouter errors |
| `src/app/api/evidence/extract/route.ts` | Uses fallback, returns provider metadata |
| `src/app/api/evidence/correlate/route.ts` | Handles OpenRouter errors, returns provider metadata |
| `src/components/incident/evidence-list.tsx` | Shows extraction source, removes hardcoded "Amazon Bedrock" |
| `src/components/incident/incident-correlation.tsx` | Shows provider name, handles OpenRouter error codes |
| `.env.example` | Added `OPENROUTER_API_KEY`, `FRAUDFIRST_OPENROUTER_MODEL_ID` |
| `package.json` | Added `tesseract.js` dependency |

---

## Quality gates

| Gate | Result |
|------|--------|
| TypeScript | `tsc --noEmit` — clean |
| Lint | `eslint` — clean (0 errors, 0 warnings) |
| Tests | 143/143 pass, 0 regressions |
| Build | `next build` — success |
| AWS integrations | Untouched, primary path unchanged |

---

## Architecture notes

- **Server-side only**: Tesseract runs via `tesseract.js` Node worker; OpenRouter via `fetch()` — neither is bundled for the browser
- **No secrets in client**: `OPENROUTER_API_KEY` and all AWS credentials stay server-side
- **Backward compatibility**: `provider`/`providerMode` are optional fields; existing persisted records are unaffected
- **Fallback eligibility is narrow**: Only subscription/access/config errors trigger fallback; invalid input, programming bugs, and unsupported media types are NOT eligible
- **OpenRouter output is untrusted**: Re-validated through the same `normalizeCorrelationOutput()` schema as Bedrock output; hallucinated evidence IDs are filtered
