# FRAUDFIRST — TASK 13 REPORT

Turn a **persisted correlation into a structured Incident Intelligence Brief** that answers *what happened, when, identifiers, contact points, URLs / payment / transaction references, the evidence behind every fact, what's missing, and what to preserve or verify next* — surfaced as a prominent, fully source-traceable panel in the incident workspace. The brief is **never AI-generated on demand**: it is a deterministic, read-only projection of the last successful `IncidentCorrelationMeta.analysis` already persisted by Task 11/12, with every `sourceEvidenceIds` chain intact.

Result: **TASK 13 — IMPLEMENTED.** New deterministic suite **`test/intelligence-brief.test.ts` with 22 tests (A–S)**. Regression: `npm test` → **116/116 pass** (94 baseline + 22 new), `npm run lint` clean, `npm run typecheck` clean, `npm run build` (Next.js 16.3.5, Turbopack) compiled successfully with the new `/api/incidents/[id]/intelligence` route registered. **No live Textract or Bedrock validation is claimed** (same retained account-level blockers). Task 14 was **not** started.

> Retained blockers (verbatim, not introduced by Task 13):
> - Textract account: `SubscriptionRequiredException` — extraction of previously preserved evidence cannot be live-validated.
> - Bedrock: `ValidationException: Operation not allowed for Nova 2 Lite in us-east-1` — live correlation against Bedrock cannot be validated.
>
> No new blocker found in Task 13.

**Verification scoping.** The Task-13 runtime contract is validated deterministically at the service and API-route boundary only: the DynamoDB store and AI provider are mocked, and the brief is derived from seeded persisted correlation records. The production flow (`captured → S3 → Textract → readiness → Bedrock correlation → DDB → response`) is unchanged; no real AWS calls were made, no production incident data was touched, and the running production server on port 3000 was left untouched.

---

## 1. Scope discipline

**Did NOT (per Task 13 constraints):** add a chatbot or generic AI summarizer, call Bedrock/Textract from the brief path, touch S3/Textract/Step Functions/IAM, add evidence export or PDF, add automations/notifications, start Task 14. The old deprecated `PlaceholderIntelligenceService` (`src/services/intelligence/index.ts`) is untouched and remains unused; the new brief builder lives beside it as `src/services/intelligence/brief.ts` without exporting through the barrel (nothing imports the placeholder contract).

**Did:** add an intelligence presentation model in `src/types/intelligence.ts`, a pure server-side brief builder with the six fixed failure/success behaviors (messages A–F below), a read-only `GET /api/incidents/[id]/intelligence` route, a client hook (`use-incident-intelligence`) that refetches only when the incident record changes (`updatedAt` as `refreshKey` — no polling), and an **Incident Intelligence** panel in the workspace that is fully source-traceable and XSS-safe.

## 2. Intelligence model — `src/types/intelligence.ts`

All Task 13 types are added to the existing `intelligence.ts` barrel file (the deprecated `ExtractedFact`/`CorrelationResult` interfaces are preserved, not removed, because the retired placeholder service still references them):

- `IncidentIntelligence = not_ready | failed | ready` discriminated union.
- `IntelligenceNotReadyReason = no_evidence | not_preserved | extraction_unavailable | correlation_pending`.
- `IncidentIntelligenceBrief` — incident id, `incidentType` + `incidentTypeLabel`, deterministic `generatedAt`/`sourceCorrelationTimestamp` (= the persisted `correlatedAt`), optional `modelId`, computed `summary`, `sourceEvidenceIds`, and the typed sections `facts`, `financialReferences`, `timeline`, `identifiers`, `contactPoints`, `urls`, `missingInformation`, `uncertainInformation`.
- **`IncidentIntelligenceFact`** — a fact type that intentionally **strips `sourceText`**, so the brief never echoes any extracted text snippet (`sourceText?: undefined`).
- `GetIncidentIntelligenceResponse` success/error shapes for the API.

## 3. Server builder — `src/services/intelligence/brief.ts`

`getIncidentIntelligence(incidentId)` loads the incident via `getIncident` (throws `PersistenceServiceError` `INVALID_INCIDENT` / `INCIDENT_NOT_FOUND` as usual) and maps to one of the six states, using the **exact** required messages:

- **A. No evidence captured yet.** — incident has zero evidence records and no correlation meta.
- **B. Evidence must be preserved before intelligence can be generated.** — evidence exists but none has `storage.status === "preserved"`.
- **C. Evidence extraction unavailable.** — preserved evidence exists but none is `processed` with a real extraction meta.
- **D. Correlation has not completed yet.** — pipeline satisfied but no correlation meta yet, or meta is `not_ready`/`correlating`.
- **E. Correlation failed. The previous successful correlation, if any, remains available.** — meta is `correlation_failed`; includes `previous` brief when the persisted failed meta still carries the last `analysis` (Task 12 preservation).
- **F. Successful correlation → `ready` brief.**

`buildIncidentIntelligenceBrief(incident, correlation)` is pure and **deterministic**:

- Projects only persisted `correlation.analysis` fields; never contacts a provider; ignores any client-supplied `intelligence`/`summary` fields (unknown record keys are dropped by `canonicalizeWorkspaceRecord` anyway).
- **Scopes every reference to evidence that belongs to the incident** — each item's `sourceEvidenceIds` is intersected with the incident's evidence ids, de-duplicated (order-preserving), and items with no surviving source are dropped (anti-hallucination, same guarantee Task 11 gave at the schema boundary — test K).
- `financialReferences` = the subset of `facts` whose type matches a conservative financial keyword list (`transaction/upi/payment/amount/transfer/account/card/wallet/bank/reference/receipt/netbanking/imps/neft/rtgs`).
- `summary` is computed, never invented: `Incident <typeLabel>: N evidence-derived fact(s), M timeline candidate(s) from K evidence item(s).`
- `sourceEvidenceIds` = the meta-level list scoped to the incident; falls back to the order-preserving union across all item sources when the meta-level list is empty.
- `generatedAt` = `correlatedAt ?? startedAt ?? ""` (never `new Date()`) so output is fully reproducible.

## 4. Timeline (STEP 7) — from persisted correlation only

`brief.timeline` is copied from `analysis.timelineCandidates` (`timestamp`, `event`, `confidence`, `label`, `sourceEvidenceIds`) with the same scoping/de-dupe. The incident's operational `timeline` array is **never** mixed in (test H): the brief shows only what correlation produced, and no timestamp is invented — entries show “No timestamp in evidence” until one exists.

## 5. Incident type (STEP 8)

No new `incidentType` field is added to the correlation schema (none exists there). The brief preserves the incident's persisted `type` and presents `INCIDENT_TYPE_LABELS[type]` (e.g. “UPI fraud”) in the What Happened header; type is displayed, never re-derived.

## 6. Missing & uncertain information (STEP 9)

`missingInformation` (field → reason, no source requirement) and `uncertainInformation` (field → reason → sourceEvidenceIds) are carried into the brief unchanged and rendered as distinct sections (missing = muted bullet list; uncertain = warning boxes), mirroring the correlation panel's treatment.

## 7. API (STEP 10) — `src/app/api/incidents/[id]/intelligence/route.ts`

- `export const dynamic = "force-dynamic"`; **GET only** (no request body accepted).
- Validates the id with `isValidIncidentId` → **400 `INVALID_INCIDENT`**; maps `PersistenceServiceError` → **404** `INCIDENT_NOT_FOUND`, **503** `DYNAMODB_NOT_CONFIGURED`, **502** `DYNAMODB_REQUEST_FAILED`.
- Success returns `{ ok: true, intelligence }` (200) for any of the discriminated states — a 200 is **not** a claim that the brief exists; `intelligence.status` carries `not_ready`/`failed`/`ready`.

## 8. Client hook (STEP 11) — `src/hooks/use-incident-intelligence.ts`

- Loads once on mount and re-fetches **only when `refreshKey` changes** (workspace passes `incident.updatedAt` — which changes exactly when evidence or correlation is persisted). No polling, no timers, no localStorage writes.
- Returns `{ intelligence, loading, error, refresh }`; malformed/unreadable responses become a `DYNAMODB_REQUEST_FAILED` error rather than a crash.

## 9. UI (STEP 5) — `src/components/incident/incident-intelligence.tsx`

New **Incident Intelligence** panel wired into `incident-workspace.tsx` directly after `IncidentCorrelation` (ConsolePanel staggered `delay` re-sequenced). Rendered content is always the six-state result:

- **Status badge** — `Correlated` (emerald) / `Failed` (destructive) / `Not ready` (warning), plus the correlation timestamp beside the header when ready.
- **What happened** — computed summary + incident type label.
- **Financial and transaction references** — traced fact rows.
- **Timeline** — timestamp (or “No timestamp in evidence”), `CONFIRMED FROM EVIDENCE`/`CANDIDATE` label, confidence, event.
- **Identifiers** and **Contact points** — traced chips.
- **Referenced URLs** — plain text only (never opened), duplicating the correlation panel's rule.
- **Evidence** — every fact with type, unit, confidence, value, and source chain.
- **Missing information** / **Uncertain information**.
- **Source evidence** — the brief-level `sourceEvidenceIds` as chips.
- **Traceability (source chips):** clicking any evidence chip expands an inline card with that evidence's **metadata only** (filename, status, category, size, preserved/captured timestamps) — no raw extracted text is ever shown, and the card labels it “Metadata only — raw extracted text is never shown.”
- **Empty-safe:** a completed correlation with no facts/timeline renders the explanatory line instead of blank space.

## 10. Failure behavior states (STEP 4)

All six messages are exact strings from `src/types/intelligence.ts` constants, asserted verbatim in tests B/C/D/E/F. `not_ready` additionally shows a context-specific hint (add evidence / preserve / process / correlation completes) so an analyst always knows the next action.

## 11. Persistence decision (STEP 12) — derive, do not duplicate

The brief is **derived on read from the persisted correlation and explicitly NOT persisted to DDB**. Rationale: (a) the source data (`analysis`, `correlatedAt`, `modelId`) already lives on the incident record with its own schema validation, so a brief is a pure projection — writing it would duplicate the same data and risk drift between the two copies; (b) deterministic derivation costs one `GetItem` (the same read the workspace already performs) with zero extra storage; (c) a "client-trusted intelligence body" is precisely what Task 13's security rules forbid. Therefore the intelligence route is a thin, idempotent reader over `getIncident` — no new DDB schema, no new write path, no table migration.

## 12. Determinism (tests M, P)

Every brief field derives only from the persisted record: `generatedAt` is the stored `correlatedAt`, the summary is computed, ordering is preserved, and arrays are de-duplicated only by their own content. Two sequential derivations and a fresh derivation after a canonical `saveIncident` round-trip serialize byte-for-byte identically.

## 13. Security (STEP 13)

- No AWS SDK, credentials, or provider calls in the browser; the brief path never contacts Textract/Bedrock (server and client both).
- **No raw OCR**: `IncidentIntelligenceFact` omits `sourceText`; `buildIncidentIntelligenceBrief` discards it while projecting facts (test N). localStorage still can never hold raw OCR (Task 12 M2 unchanged).
- **No client-trusted facts**: the brief is built server-side only from the canonicalized persisted record; a client-supplied `intelligence` blob on the record is ignored (test L).
- **Evidence-id validation**: every `sourceEvidenceIds` is intersected against the incident's actual evidence ids (test K).
- **No HTML injection**: all values render through React/JSX interpolation (auto-escaped); URLs are plain text; no `dangerouslySetInnerHTML` anywhere in the new component.
- Read-only route: no body parsing, no tokens accepted, strict `isValidIncidentId` precheck.

## 14. Tests — `test/intelligence-brief.test.ts` (22 tests, A–S)

Mapped to the Task-13 checklist (harness mirrors `correlation-orchestration.test.ts`: mocked `DynamoDBDocumentClient.send`, in-memory store, seeded records):

- **A** unknown incident → `INCIDENT_NOT_FOUND`. **B** no evidence → `not_ready`/`no_evidence` + exact message. **C** unpreserved → `not_preserved` + exact message. **D** preserved-but-not-extracted → `extraction_unavailable`. **E** processed-without-correlation → `correlation_pending`.
- **F** failed (no prior success) → `failed` + exact message, no `previous`. **F2** failed with preserved analysis → `previous` brief available.
- **G** successful → ready brief with type, label, modelId, generatedAt, summary, and every section populated. **H** timeline only from persisted correlation (incident `timeline` never leaks in). **I** every item preserves `sourceEvidenceIds`. **J** missing + uncertain preserved.
- **K** invalid/hallucinated source refs filtered to the incident's evidence only (timeline item with only a ghost source is dropped). **L** client-supplied fabricated `intelligence` blob never surfaced.
- **M** repeated derivation deterministic. **N** raw OCR text and `sourceText` never appear in the brief output. 
- **O** route 400 invalid id; **O2** route 404 unknown incident; **O3** route 200 ready.
- **P** fresh build after a canonical `saveIncident` round-trip serializes identically. **Q** the `previous` brief equals the last success exactly (byte-identical).
- **R** `financialReferences` = financial subset of facts only. **S** brief source ids unique/ordered/scoped (dedupe of `["ev_two","ev_one","ev_two"]` → `["ev_two","ev_one"]`).

**Result: `npm test` → 116/116 pass** (94 baseline + 22 Task-13).

## 15. lint / typecheck / build (regression, STEP 15)

- `npm test` → **116/116 pass**.
- `npm run lint` → clean.
- `npm run typecheck` (`tsc --noEmit`) → clean (route types regenerated via `npx next typegen` so `RouteContext<"/api/incidents/[id]/intelligence">` resolves).
- `npm run build` (Next.js 16.3.5, Turbopack) → compiled successfully; **13 routes** registered including `/api/incidents/[id]/intelligence`; no warnings.

## 16. Files changed

- `src/types/intelligence.ts` — Incident Intelligence model, message constants, `IncidentIntelligenceFact` (no `sourceText`), API response types (Task-13 additions; legacy interfaces preserved).
- `src/services/intelligence/brief.ts` — **new** server builder `getIncidentIntelligence` + `buildIncidentIntelligenceBrief`.
- `src/app/api/incidents/[id]/intelligence/route.ts` — **new** read-only GET route.
- `src/hooks/use-incident-intelligence.ts` — **new** client hook; `src/hooks/index.ts` barrel updated.
- `src/components/incident/incident-intelligence.tsx` — **new** panel; `incident-workspace.tsx` wires it after `IncidentCorrelation` (delay 0.2; timeline moved to 0.21).
- `test/intelligence-brief.test.ts` — **new** 22-test suite.

## 17. Runtime checks

- No new AWS execution / extraction / correlation / step-function was created; provider and DDB are mocked at the test boundary. The running production server on port 3000 predates this build and was left untouched.
- Deterministic behavior verified for all six states, API status codes, determinism, and XSS/OCR safety via the suite above.

## 18. Blocker

- None caused by Task 13. Retained (verbatim): Textract `SubscriptionRequiredException` and Bedrock Nova 2 Lite `ValidationException` in `us-east-1` — **no live Textract or Bedrock validation is claimed** until account/subscription access exists. No IAM permissions broadened; no S3/Textract/SFN/response-workflow code modified.
- Recommended next task: **Task 14** (as specified) — resolve the Textract subscription and Bedrock model-region configuration so the end-to-end flow can be live-validated; Task 13's brief already handles `not_ready`/`failed` states gracefully until then.