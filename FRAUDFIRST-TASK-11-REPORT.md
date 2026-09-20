# FRAUDFIRST — TASK 11 REPORT

Harden the Evidence → Correlation pipeline: a server-side **incident-level** correlation that starts from what the app actually has (session text extracted by real Textract work when preserved), derives a strict readiness state for every evidence item, correlates only the ready subset, and stores a deterministic idempotent `correlation` meta on the incident. The UI now distinguishes "correlation not available yet" (with a per-evidence reason) from "correlation failed" from "correlation completed."

Result: **TASK 11 — IMPLEMENTED.** All 15 deterministic tests (A–N + staleness) cover the orchestration, plus 5 endpoint-level tests for the new API route. Regression: `npm test` → **86/86 pass**, `npm run lint` clean, `npm run typecheck` clean, `npm run build` (Next.js 16.3.5, Turbopack) compiled successfully with the new route registered. The Task-11 build was NOT deployed/restarted onto the running production server; runtime smoke was limited to code paths that need no AWS calls, kept safe (no real Textract or Bedrock calls were made).

> Retained blockers (verbatim, not introduced by Task 11):
> - Textract account: `SubscriptionRequiredException` — extraction of previously preserved evidence cannot be live-validated.
> - Bedrock: `ValidationException: Operation not allowed for Nova 2 Lite in us-east-1` — live correlation against Bedrock cannot be validated.
>
> No new blocker found in Task 11.

**Verification scoping.** Per instructions, a full browser → real Textract → real Bedrock end-to-end was **NOT claimed** (impossible absent subscriptions; also out of scope — extraction/preservation/response-workflow code was not modified). Task 11 runtime validation is deterministic at the service and API-route boundary: DynamoDB (`DynamoDBDocumentClient.prototype.send`) and the AI provider are mocked with an in-memory store; the provider fixture is used only at the test boundary. No real AWS calls were made by this task, and no production incident data was touched.

---

## 1. What Task 11 changed (scope discipline)

- **Did NOT** touch S3 preservation, Textract, Step Functions, the response workflow, or IAM. Extraction is used exactly as it already exists (session text + `extraction` metadata).
- **Did** add: incident-level correlation orchestration, a deterministic readiness model, idempotent/conflict-safe DynamoDB persistence of a server-side `correlation` meta, a new API route, a client hook, and a UI panel with distinct availability/failure/completion states.

## 2. Readiness model (pure, client-safe)

### `src/services/correlation/readiness.ts` (new)
- `isExtractionSupportedMime(mimeType)` — supports `image/png`, `image/jpeg` (the media the pipeline can actually Textract).
- `deriveEvidenceReadiness(evidence, claim?)` → `{ state, reason, text? }` with states:
  - `ready` — evidence processed (or having processed status) **and** usable text is available (claim text present).
  - `processing` — `status === "processing"`.
  - `extraction_failed` — `status === "failed"`.
  - `no_text_found` — processed but no text claim supplied.
  - `not_extracted` — captured but not preserved/processed.
  - `preserved_extraction_unavailable` — preserved to S3 but no Textract text was extracted yet and it is not re-extracted here (explicit, honest — never claimed as extractable now).
  - `text_unavailable` / `unsupported_media` — catch-alls.
- Pure function: no AWS, no server-only imports ⇒ safe to ship to the client for the readiness reasons.

## 3. Correlation service (`src/services/correlation/index.ts`, `schema.ts`)

- **Batch API.** Added `correlateEvidenceBatch(items)` with `buildEvidenceBlock` + `buildCorrelationPrompt`; `correlateEvidenceText` now delegates to the batch path. Batch caps: `CORRELATION_BATCH_MAX_ITEMS = 50`, `CORRELATION_BATCH_TOTAL_CHARS = 100_000` (and per-item hard limit 60k).
- **Hallucination guard.** `baseSourceEvidenceIds(value, evidenceId, allowedEvidenceIds?)` intersects any provider-supplied `sourceEvidenceIds` with the **evidence ids that were actually sent**; falls back to `[evidenceId]` when empty. All parsers (`facts`, `timeline`, `identifiers`, `contacts`, `urls`, `uncertain`) and `normalizeCorrelationOutput` thread the allowed set through, so the model can never reference evidence that wasn't in the batch.
- No invented facts: facts surface only via the structured corpus analysis parsed from the (real) provider output; every fact kind carries `sourceEvidenceIds` + `sourceText` traceability.

## 4. Incident persistence (`src/services/incident-persistence.ts`)

- **`correlation?: IncidentCorrelationMeta`** added to `IncidentWorkspaceRecord` **only** (not the lightweight `Incident` type), so it stays server-side and out of localStorage.
- `canonicalizeIncidentCorrelation` validates status (`INCIDENT_CORRELATION_STATUSES`), signature (hex-64 `INCIDENT_CORRELATION_SIGNATURE_RE`), evidence/ready counts, not-ready evidence states, and coalesces legacy/unknown values.
- `canonicalizeWorkspaceRecord` accepts and preserves `correlation` when present; `saveIncident` **merges** an existing server-side correlation across a client push (same pattern as `response`) rather than dropping it.
- New timeline event types: `correlation_started`, `correlation_completed`, `correlation_failed` (added to `TIMELINE_TYPES` in the same file).

## 5. Orchestration (`src/services/correlation/orchestrate.ts`, new)

`correlateIncidentEvidence(incidentId, claims?, provider?)` — the single server-side entry point used by both the route and the hook:

- **Validation first:** `isValidIncidentId` before any AWS call; `assertPersistenceConfigured`; `INCIDENT_NOT_FOUND` for unknown incidents.
- **Deterministic signature:** sha256 over `(incidentId, each evidence: id/status/mimeType/storage.status/textLength, claim text length)`. Same readiness inputs ⇒ same signature ⇒ idempotency.
- **Idempotent reuse:** if an existing non-`correlating` correlation has the same signature, it is **returned as-is** (no provider call, no rewrite).
- **In-flight de-dupe:** a `correlating` meta is returned as-is (and never re-run) for `INCIDENT_CORRELATION_STALE_MS = 2 min`; after the staleness window a stale `correlating` is superseded and re-run (so a crashed run can be retried).
- **Not-ready short-circuit:** if `readyCount === 0`, a `not_ready` meta is persisted (with per-evidence reason) and the provider is never contacted.
- **Coarse checkpoint + timeline:** `correlating` meta is persisted first with a deterministic `tl_{incidentId}_correlation_start` event; then the provider is called. Failure → `correlation_failed` meta + `tl_{incidentId}_correlation_failed` (error code mapped); success → `correlated` meta + `tl_{incidentId}_correlation_complete`. All timeline ids are fixed ⇒ de-duplicated by `appendTimelineEvent`.
- **Conflict-safe writes:** `persistIncidentCorrelation` reads current, writes with `expectedUpdatedAt` (conditional), and on `DynamoDbConflictError` re-reads + retries once — preserving the freshest evidence/timeline while still landing the correlation.
- **Payload caps:** `capReadyText` enforces per-item 60k and batch-total 100k before the provider call.
- **Provider abstraction:** the default provider is `correlateEvidenceBatch` (Bedrock via `src/services/server/bedrock`); tests inject a deterministic fixture. Failure mapping covers `CorrelationServiceError` (incl. `BEDROCK_NOT_CONFIGURED`) and `BedrockRuntimeError` → `BEDROCK_REQUEST_FAILED`.

## 6. API route (`src/app/api/evidence/correlate-incident/route.ts`, new)

- `POST` — body `{ incidentId, claims?: CorrelateEvidenceBatchItemInput[] }`, returns `{ ok: true, incidentId, correlation }`.
- Validation: incident id regex `FF-\d{8}-[A-Z2-9]{4}`, evidence id regex, `claims` must be an array, `MAX_CLAIMS = 500`, `MAX_CLAIM_TEXT_CHARS = 60_000`, serialized claims ≤ 512 KiB.
- Error mapping table (`CorrelateIncidentErrorResponse`): `INCIDENT_NOT_FOUND` → 404, `INVALID_REQUEST` / `EVIDENCE_NOT_FOUND` / `EXTRACTION_NOT_AVAILABLE` → 400, too-many/oversized → 413, `BEDROCK_NOT_CONFIGURED` → 503, everything else (incl. AI failure) → 502. `DYNAMODB_NOT_CONFIGURED` is mapped to `BEDROCK_NOT_CONFIGURED` so callers get one consistent "AI not configured" signal.

## 7. UI

### `src/hooks/use-incident-correlation.ts` (new)
- On mount: fetches the remote incident, derives `readyWithText` = evidence with `status === "processed"` **and** available text (`getText`).
- `correlateIncident()` POSTs `{ incidentId, claims: [...readyWithText] }`; exposes state (`correlation`, `loading`, `correlating`, `error`) and `refresh()` (re-apply idempotency after the panel remounts).
- No token/AWS material — the hook only reads text already in the client.

### `src/components/incident/incident-correlation.tsx` (new) + wiring in `incident-workspace.tsx`
- New `ConsolePanel` (delay 0.19) between *Incident Understanding* and *Incident Timeline*, with `getText={(evidenceId) => resultFor(evidenceId)?.text}`.
- Distinct states: loading → none-meta, → **correlating**, → **not ready** (list of items with state + reason), → **failed** (error code + restart affordance), → **completed** (`FactList` rendering facts, timeline candidates, identifiers, contact points, URLs as plain text, missing/uncertain info). Panel never fabricates: completed facts come only from the stored correlation.

## 8. Tests

### `test/correlation-orchestration.test.ts` (new, 20 tests)
DDB mocked (`DynamoDBDocumentClient.prototype.send` → in-memory store, resets between tests), provider injected as deterministic fixture (AI turns the exact `items` passed into `corpusAnalysis`); env = real table name + fake credentials. Tests A–N:

- **A** no evidence → persisted `not_ready`, provider never called, no timeline event.
- **B** captured/not_preserved → `not_ready` with `not_extracted` reason.
- **C** failed extraction → `not_ready` `extraction_failed`.
- **D** one processed + claim → `correlated`, provider receives exactly the ready item, `correlation_started`+`correlation_completed`.
- **E** multiple processed → one batch of 2, ids preserved.
- **F** mixed readiness → `correlated` for the ready subset, the rest reported in `notReadyEvidence`, **both** preserved on the stored meta.
- **G** preserved-but-not-extracted-now → never treated as success (`preserved_extraction_unavailable`).
- **H** provider failure → persisted `correlation_failed` + `correlation_failed` timeline event, error code surfaced.
- **I** completed run idempotent — second run reuses stored result (provider not called again).
- **J** provider `sourceEvidenceIds` preserved in persisted analysis.
- **K** `normalizeCorrelationOutput` filters hallucinated source ids to the allowed set.
- **L** no duplicate timeline events when re-running an already-correlating incident (in-flight de-dupe).
- **M** correlation meta survives a canonical `saveIncident` round-trip from a client that omits it.
- **N** invalid incident ids rejected (`INVALID_INCIDENT`, no AWS call) and claims for unknown evidence ids ignored → `not_ready`.
- **+stale** a `correlating` meta older than the staleness window is re-run exactly once.

Endpoint tests (route handler called directly with the same mocked DDB, no HTTP server):
- invalid incident id → 400 `INCIDENT_NOT_FOUND`; nonexistent incident → 404; 501 claims → 413 `INVALID_REQUEST`; missing `text` claim → 400 `EXTRACTION_NOT_AVAILABLE`; no ready evidence → 200 `{ ok, correlation.status: "not_ready" }`.

**Result: `npm test` → 86/86 pass** (66 regression + 20 new).

## 9. lint / typecheck / build
- `npm run lint` → clean.
- `npm run typecheck` (`tsc --noEmit`) → clean.
- `npm run build` (Next.js 16.3.5, Turbopack) → compiled successfully; 12 routes registered including `/api/evidence/correlate-incident`; no warnings.

## 10. Runtime checks
- No new AWS execution/extraction/correlation was created (provider and DDB mocked in tests; the running production server on port 3000 predates the Task-11 build and was left untouched, so its `/api/evidence/correlate-incident` correctly 404s).
- Validation-before-AWS and not-configured/not-found behaviors are covered by the deterministic tests above.

## 11. Files changed
- `src/types/correlation.ts` (new — `IncidentCorrelationMeta`, `CorrelationTextClaim`, `CorrelateIncidentRequest`/Responses, readiness states)
- `src/types/persistence.ts` (`correlation` on `IncidentWorkspaceRecord`)
- `src/types/timeline.ts` (+`correlation_started`/`completed`/`failed`)
- `src/services/correlation/readiness.ts` (new)
- `src/services/correlation/orchestrate.ts` (new)
- `src/services/correlation/index.ts` (`correlateEvidenceBatch`, batch caps, prompt builder)
- `src/services/correlation/schema.ts` (allowed-evidence filtering everywhere)
- `src/services/incident-persistence.ts` (canonicalize `correlation`, timeline types, merge-on-save)
- `src/app/api/evidence/correlate-incident/route.ts` (new)
- `src/hooks/use-incident-correlation.ts` (new)
- `src/components/incident/incident-correlation.tsx` (new) + `src/components/incident/incident-workspace.tsx` (panel wiring)
- `test/correlation-orchestration.test.ts` (new, 20 tests)

## 12. Blocker
- None for Task 11. Retained (verbatim, not caused by Task 11): Textract `SubscriptionRequiredException` and Bedrock Nova 2 Lite `ValidationException` in `us-east-1` — live Textract and live Bedrock validation remain impossible until account/subscription access exists. No IAM permissions broadened; no S3/Textract/SFN/response-workflow code modified.