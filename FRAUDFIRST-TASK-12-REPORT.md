# FRAUDFIRST — TASK 12 REPORT

Integrate real evidence extraction with incident correlation: a server-side bridge (`getCorrelationReadyEvidence`) that re-derives correlation readiness **from the persisted incident record** instead of trusting the client, enforces that **only genuinely processed + usable extracted text may be correlation-ready**, enriches every text payload the AI model receives with its source identity (`incidentId`, `evidenceId`, category, extraction timestamp/status, confidence), and never lets a failed re-correlation destroy a previously successful correlation.

Result: **TASK 12 — IMPLEMENTED.** The correlation suite grew from 20 to **28 deterministic tests** (A–N + staleness + 7 new bridge/readiness tests + 1 route test for evidence-id rejection). Regression: `npm test` → **94/94 pass**, `npm run lint` clean, `npm run typecheck` clean, `npm run build` (Next.js 16.3.5, Turbopack) compiled successfully with all 12 routes registered. No live Textract or Bedrock calls were made; the running production server on port 3000 was left untouched.

> Retained blockers (verbatim, not introduced by Task 12):
> - Textract account: `SubscriptionRequiredException` — extraction of previously preserved evidence cannot be live-validated.
> - Bedrock: `ValidationException: Operation not allowed for Nova 2 Lite in us-east-1` — live correlation against Bedrock cannot be validated.
>
> No new blocker found in Task 12.

**Verification scoping.** The production flow remains `captured → S3 preserved → Textract extraction → normalized result → readiness → incident correlation → structured result → DDB persistence → response`. A full browser → real Textract → real Bedrock run is still **NOT claimed** (the same account-level blockers apply). Task 12 runtime validation is deterministic at the service and API-route boundary: DDB and the AI provider are mocked, and the provider fixture is injected only at the test boundary. No real AWS calls were made and no production incident data was touched.

---

## 1. What Task 12 changed (scope discipline)

- **Did NOT** touch S3 preservation, Textract, Step Functions, the response workflow, or IAM. The bridge sits between the extraction outcome and the existing Task-11 orchestration; no duplicate extraction/correlation abstraction was created.
- **Did** add a server-only evidence→correlation bridge, harden the pure readiness model, enforce server-side claim validation (reject unknown / never-processed evidence ids), preserve the last successful correlation across a failed re-run, enrich the Bedrock evidence block with source identity, extend the error-code mapping, and surface a provider-unavailable state with the preserved result in the UI.

## 2. Readiness hardened (pure) — `src/services/correlation/readiness.ts`

`deriveEvidenceReadiness` no longer grants `ready` from a bare client claim. The claim-with-text branch now requires **`status === "processed"` AND a real `extraction` meta** on the evidence record; otherwise the claim cannot manufacture readiness for a `captured`, `processing`, or `failed` item:

- `captured` + fabricated claim → `not_extracted` (never ready).
- `processing` + claim → stays `processing`.
- `failed` + claim → stays `extraction_failed` (an extraction failure is never converted into an empty/“successful” correlation).
- `processed` + `extraction` + usable claim text → `ready`, and only this state reaches the provider.

## 3. Server bridge (new) — `src/services/correlation/evidence-bridge.ts`

`getCorrelationReadyEvidence(incidentId, claims?)` is the clean server-only adapter connecting extraction to correlation. It is **never bundled for the client** (it imports persistence and the AWS-backed correlation service):

- Loads the incident record (the source of truth) and re-derives readiness from it — the client only supplies session text, never the readiness decision.
- **Validates every claim against the record:**
  - an `evidenceId` that is not in the incident → `PersistenceServiceError("EVIDENCE_NOT_FOUND")` (rejected, not ignored);
  - an `evidenceId` whose evidence was never `processed` → `PersistenceServiceError("EXTRACTION_NOT_AVAILABLE")` (no arbitrary evidence-ID injection / fabricated text for un-processed evidence).
- Builds the **ready provider payload enriched with source identity**: `{ incidentId, evidenceId, filename, mimeType, category, capturedAt, extractedAt, source, confidence, status: "processed", text }`.
- Returns a deterministic `signature` (see §4), `entries` (readiness per evidence), counts, `sourceEvidenceIds`, `notReadyEvidence`, and the incident's existing `correlation` meta (so preservation decisions stay in one read).
- Enforces `CORRELATION_BATCH_MAX_ITEMS = 50` on the ready subset before anything reaches the provider.

## 4. Orchestration re-wired — `src/services/correlation/orchestrate.ts`

`correlateIncidentEvidence` now delegates readiness to the bridge and changes behavior in four Task-12-relevant ways:

- **Signature enriched** — sha256 over `(incidentId, per evidence: id/status/mimeType/category/storage.status/extraction.source/extractedAt/textLength + claim text/source/extractedAt)`. A changed evidence set, re-extraction, or changed text content ⇒ a new signature ⇒ a new correlation run.
- **Idempotency tightened** — a matching signature reuses the stored result only for `correlated` / `not_ready`. A `correlation_failed` meta is **never short-circuited**: an explicit retry always calls the provider again (manual trigger only — no auto-spam on refresh).
- **Previous success preserved (requirement I)** — on any provider failure, if the incident already has a successful `analysis`, the failed meta **keeps** `correlatedAt`/`modelId`/`durationMs`/`textLength`/`analysis` alongside the new `error`, so a failed re-run never destroys the last successful correlation.
- **Not-ready never clobbers a success** — if nothing is ready but the incident already has a `correlated` result, that result is returned intact instead of being overwritten by a `not_ready` meta.

## 5. Provider payload + prompt — `src/services/correlation/index.ts` and `correlate` route

- `CorrelateEvidenceBatchItemInput` / `CorrelateEvidenceTextInput` gain `incidentId`, `category`, and `status?: "processed"`; `buildEvidenceBlock` now emits `incidentId="…" category="…" extractionStatus="processed"` (XML-escaped) alongside the existing id/filename/mimeType/capturedAt/extractedAt/source/confidence attributes.
- The single-evidence route (`src/app/api/evidence/correlate/route.ts`) was updated to pass `incidentId` and `category` (from `claim.category`, defaulting to `unclassified`), so **every** payload that reaches Bedrock carries its source identity.
- No binary files are ever sent to the model; truncated text only. `sourceEvidenceIds` remain intersected with the allowed set (unchanged Task-11 hallucination guard).

## 6. Persistence + API mapping

- `src/types/persistence.ts`: `PersistenceErrorCode` extended with `EVIDENCE_NOT_FOUND` and `EXTRACTION_NOT_AVAILABLE`.
- `src/services/incident-persistence.ts`: `canonicalizeIncidentCorrelation` now **preserves a present `analysis` on `correlation_failed`** (previously it was only honored on `correlated`), so the saved last-successful result survives DDB round-trips and canonical `saveIncident` pushes.
- `src/app/api/evidence/correlate-incident/route.ts`: `mapPersistenceFailure` now maps bridge errors `EVIDENCE_NOT_FOUND` and `EXTRACTION_NOT_AVAILABLE` to their API codes with HTTP **400**; the 503/404/400/502 status ladder is unchanged for everything else.

## 7. UI — `src/components/incident/incident-correlation.tsx`

- **Provider-unavailable state** — when the correlation error is `BEDROCK_NOT_CONFIGURED` / `BEDROCK_REQUEST_FAILED`, the panel shows the fixed sentence **“Correlation unavailable — AI provider unavailable. The preserved evidence and extracted text are unaffected.”** in place of the raw error.
- **Lost nothing on failure** — if the failed meta still carries `analysis`, the panel renders a **“Last successful correlation”** section (with `formatDateTime(correlatedAt)`) under the failure box plus the ready/excluded counts, and keeps the **Try again** affordance.
- Manual trigger only: `use-incident-correlation.ts` still POSTs solely on user click; nothing changed there and no refresh-triggered provider calls exist.

## 8. Tests — `test/correlation-orchestration.test.ts` (28 tests total)

New/updated vs Task 11, mapped to the Task-12 checklist:

- **A/B/C/D/E/F/G/H/I/J/K/L/M** — retained from Task 11 (A no-evidence, B captured-no-text, C failed extraction, D one processed, E multi-batch, F mixed readiness, G preserved-not-extracted-now, H provider failure, I idempotent completed run, J provider source ids preserved, K hallucination filtering, L in-flight timeline de-dupe, M canonical round-trip). **N** updated: claims for unknown evidence ids are now **rejected** with `EVIDENCE_NOT_FOUND` (previously ignored).
- **C2** processing extraction → `not_ready`, state `processing`, provider never called.
- **H2** a changed evidence set produces a new signature and re-correlates (provider called twice, both ready items sent).
- **I2** a failed re-correlation **preserves the previous successful correlation** — failed meta keeps `modelId`, `correlatedAt`, `analysis`; the saved record still canonicalizes with the analysis intact.
- **J2** an unavailable AI provider → persisted `correlation_failed` with `error.code === "BEDROCK_NOT_CONFIGURED"` (the state the UI’s provider-unavailable message reads).
- **K2** retry after a failure stays timeline-idempotent — exactly one `correlation_completed` and one `correlation_failed` event.
- **L2** claims referencing evidence that was never `processed` → rejected with `EXTRACTION_NOT_AVAILABLE`.
- **L2-route** claims referencing unknown evidence ids → API **400 `EVIDENCE_NOT_FOUND`**.
- **M2** raw OCR text is never serialized — `buildIncidentWorkspaceRecord`/`sanitizeEvidenceRecord` produce an evidence extraction meta with only `source / extractedAt / confidence / textLength` and drop any `text` field (localStorage can never hold raw OCR).
- **D enrichment** extended to assert the provider item carries `incidentId`, `category`, and `status: "processed"`.

**Result: `npm test` → 94/94 pass** (66 baseline + 28 correlation).

## 9. lint / typecheck / build

- `npm run lint` → clean.
- `npm run typecheck` (`tsc --noEmit`) → clean.
- `npm run build` (Next.js 16.3.5, Turbopack) → compiled successfully; 12 routes registered; no warnings.

## 10. Runtime checks

- No new AWS execution/extraction/correlation was created (provider and DDB mocked in tests). The running production server on port 3000 predates this build and was left untouched.
- Validation-before-AWS, not-configured/not-found, and provider-unavailable behaviors are covered by the deterministic tests above.

## 11. Files changed

- `src/services/correlation/evidence-bridge.ts` (new — server-only bridge `getCorrelationReadyEvidence`)
- `src/services/correlation/readiness.ts` (hardened — ready requires processed + real extraction meta)
- `src/services/correlation/orchestrate.ts` (uses the bridge; enriched provider input; retry-after-failure; preserve previous success; not-ready never clobbers correlated)
- `src/services/correlation/index.ts` (`incidentId`/`category`/`status` on provider inputs; evidence-block attributes)
- `src/app/api/evidence/correlate/route.ts` (passes `incidentId` + `category`)
- `src/app/api/evidence/correlate-incident/route.ts` (`EVIDENCE_NOT_FOUND`/`EXTRACTION_NOT_AVAILABLE` → 400)
- `src/types/persistence.ts` (extended `PersistenceErrorCode`)
- `src/services/incident-persistence.ts` (`correlation_failed` preserves `analysis`)
- `src/components/incident/incident-correlation.tsx` (provider-unavailable state; last-successful-correlation section)
- `test/correlation-orchestration.test.ts` (+8 tests; N updated to rejection)

## 12. Blocker

- None caused by Task 12. Retained (verbatim): Textract `SubscriptionRequiredException` and Bedrock Nova 2 Lite `ValidationException` in `us-east-1` — live Textract and live Bedrock validation remain impossible until account/subscription access exists. No IAM permissions broadened; no S3/Textract/SFN/response-workflow code modified.