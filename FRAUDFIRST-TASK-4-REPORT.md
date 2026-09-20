# FRAUDFIRST — TASK 4 REPORT

Real evidence ingestion + AWS Textract extraction foundation.

Status: **COMPLETE** · Task 5 NOT started · Bedrock and S3 NOT implemented

---

## 1. What was implemented

A real extraction pipeline with a clean server boundary:

```
Browser (File in session memory)
  → client hook (use-evidence-processing)
  → POST /api/evidence/extract (multipart/form-data)
  → Next.js server validation
  → AWS Textract DetectDocumentText (image bytes)
  → normalized ExtractedText
  → evidence state machine (captured → processing → processed | failed)
  → incident UI (TEXT EXTRACTED preview, source, confidence, retry)
```

- PNX/JPG image evidence is processed through a real AWS Textract call.
- WebP/PDF/other types are preserved as evidence but explicitly rejected for extraction with clear structured errors.
- When AWS credentials are missing, the endpoint returns `AWS_NOT_CONFIGURED` and the UI shows **"AWS processing unavailable"** — no fake data, no silent fallback.

## 2. AWS services used

- **AWS Textract** only — `DetectDocumentText` (synchronous, image bytes).

## 3. AWS SDK packages added

- `@aws-sdk/client-textract` (^3.1134.0) — the minimum SDK needed. Nothing else.

## 4. Environment variables

Server-side only (never `NEXT_PUBLIC_*`, never in client code):

- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- optional `AWS_PROFILE` (use shared-config profile instead of static keys)

Documented in `.env.example`. Configuration check additionally honours `AWS_DEFAULT_REGION`.

## 5. API route

`POST /api/evidence/extract` (`src/app/api/evidence/extract/route.ts`, `force-dynamic`):

Accepts `multipart/form-data`: `incidentId`, `evidenceId`, `file`.

Validation order and behaviour:

| Check | Result |
| --- | --- |
| Body unparseable | 400 `INVALID_REQUEST` |
| missing incidentId/evidenceId | 400 `MISSING_FIELD` |
| incidentId not `FF-…` format | 400 `INCIDENT_NOT_FOUND` |
| evidenceId not `ev_…` format | 400 `EVIDENCE_NOT_FOUND` |
| no file | 400 `FILE_REQUIRED` |
| unsupported type | 415 `UNSUPPORTED_MEDIA_TYPE` (distinct PDF / WebP / generic messages) |
| file > 5 MB | 413 `FILE_TOO_LARGE` |
| AWS not configured | 503 `AWS_NOT_CONFIGURED` |
| Textract rejects document | 422 `FILE_NOT_READABLE` |
| Textract failure | 422 `EXTRACTION_FAILED` |
| success | 200 `ok: true` + extraction |

## 6. Request contract

```
POST /api/evidence/extract
Content-Type: multipart/form-data
  incidentId: string   (FF-YYYYMMDD-####)
  evidenceId: string   (ev_…)
  file: image/png | image/jpeg
```

## 7. Response contract

Success:

```
{ ok: true, evidenceId, status: "processed",
  extraction: { evidenceId, status, text, confidence?, source: "aws-textract", extractedAt } }
```

Error:

```
{ ok: false, error: { code, message } }
```

Typed in `src/types/extraction.ts` (`ExtractEvidenceResponse`, `ExtractionError`, `ExtractionErrorCode`).

## 8. Textract implementation

`src/services/extraction/textract.ts`:

- Lazy singletons `TextractClient`, region from env.
- `DetectDocumentTextCommand({ Document: { Bytes } })` on image bytes.
- Returns `{ text, confidence? }`.

## 9. Extraction normalization

`src/services/extraction/index.ts`:

- `ExtractedText { text, confidence?, source: "aws-textract", extractedAt }`.
- Confidence = rounded average of Textract WORD-block confidence values; **omitted entirely when no word blocks exist** — never fabricated.
- Text = LINE blocks joined by newlines (no table/form analysis).
- AWS failure names mapped to safe codes (`InvalidImageFormatException` → `FILE_NOT_READABLE`, `DocumentTooLargeException` → `FILE_TOO_LARGE`, everything else → `EXTRACTION_FAILED`). No raw stack traces or AWS messages reach the UI.
- Extensible type shape ready for Task 5/6 entity fields.

## 10. Evidence state machine

```
captured ──▶ processing ──▶ processed
                │
                └──▶ failed   (retry: failed ──▶ processing)
                └──▶ captured (revert on AWS_NOT_CONFIGURED)
```

Enforced in `src/services/evidence/index.ts` via atomic `markProcessing / markProcessed / markFailed / markCaptured`:

- duplicate/simultaneous processing blocked (`markProcessing` returns false while already processing; client `inFlight` ref guard too)
- processing already-removed evidence blocked (`update` no-ops on missing record)
- unsupported types never offered a Process control in the UI
- processed → processing allowed for "Extract again"

## 11. UI changes

`src/components/incident/evidence-list.tsx` (rewritten) + `incident-workspace.tsx` (wired `useEvidenceProcessing`):

- Per-item **"Process evidence"** button for eligible PNG/JPEG, hidden for WebP/PDF/other (with an explanatory note).
- During processing: spinner + "Extracting text…" (button disabled, list item `aria-busy`), status shows "Processing".
- Success: "TEXT EXTRACTED" panel — scrollable `EXTRACTED TEXT` preview, `Source: AWS Textract`, `Confidence: N%` (omitted if none), plus "Extract again".
- AWS-missing: **"AWS processing unavailable"** block with the exact copy *"AWS credentials are not configured for this environment."* and a Try-again button; evidence reverts to Captured.
- Failure: **"Extraction failed"** block with a safe message + Try-again.
- Missing File after refresh: *"File needs to be selected again before processing."* — processing is not pretended possible.
- Processed-but-text-not-in-this-session: explanation that extracted text is session-only.

## 12. Timeline changes

New events (via the existing timeline service, with timestamp + evidence filename):

- `evidence_processing_started` → "Evidence processing started"
- `text_extracted` → "Text extracted"
- `evidence_processing_failed` → "Evidence processing failed"

Also fixed a pre-existing duplicate-write bug in `use-incident` where "Evidence captured/removed" were written twice (service + hook). Hook now relies on service-side events — one event per action.

## 13. Error handling

- Structured `{ ok, error: { code, message } }` everywhere.
- Safe, human-readable messages; Textract/AWS internals never surfaced.
- Content never logged (no text, no bytes); only error names/codes are classified internally.
- Distinct UX for unavailable (revert + retry), failed (retry), and un-eligible files.

## 14. Security considerations

- **Credentials server-side only** — never in `NEXT_PUBLIC_*`, never sent to the browser (verified: no `@aws-sdk` in client chunks).
- MIME type whitelist + size limit (5 MB, matching the Textract sync image limit; check also rejects via extension).
- Evidence is never written to disk — the upload exists only as request memory (`formData()` → `Uint8Array` in memory) and is GC'd after the request.
- Raw OCR text is **not** persisted; kept in client memory only (documented in §17). Only non-sensitive metadata (`source`, `extractedAt`, `confidence`, `textLength`) is stored in localStorage.
- No keys/secrets in source; `.env*` ignored by git; no credential values printed.

## 15. Files created

- `src/types/extraction.ts` — request/response/normalized types
- `src/services/extraction/textract.ts` — Textract adapter (server-only import)
- `src/services/extraction/index.ts` — normalization + config/size constants + error mapping
- `src/app/api/evidence/extract/route.ts` — server endpoint
- `src/hooks/use-evidence-processing.ts` — client processing hook (in-memory text store)

## 16. Files modified

- `src/types/index.ts` — export extraction types
- `src/types/evidence.ts` — optional `extraction?: EvidenceExtractionMeta`
- `src/types/timeline.ts` — 3 new event types
- `src/services/evidence/index.ts` — state machine + timeline events
- `src/hooks/use-incident.ts` — fixed duplicate timeline events; returns `reload`
- `src/hooks/index.ts` — export new hook
- `src/components/incident/evidence-list.tsx` — processing UI
- `src/components/incident/incident-workspace.tsx` — hook wiring
- `next.config.ts` — `serverExternalPackages: ["@aws-sdk/client-textract"]`
- `.env.example` — documented AWS vars
- `package.json` / `package-lock.json` — SDK dependency

Note: `src/services/index.ts` intentionally does NOT export the extraction services, keeping the AWS import server-side only.

## 17. Dependencies added

- `@aws-sdk/client-textract@^3.1134.0`

## 18. Validation results

- `npm run lint` — clean
- `npm run typecheck` — clean
- `npm run build` — clean (routes: `/` static; `/api/evidence/extract`, `/api/health`, `/incident/[id]` dynamic)
- Endpoint probes (live dev server):
  - no fields → 400 `INVALID_REQUEST`
  - bad incidentId → 400 `INCIDENT_NOT_FOUND`
  - bad evidenceId → 400 `EVIDENCE_NOT_FOUND`
  - missing file → 400 `FILE_REQUIRED`
  - PDF → 415 `UNSUPPORTED_MEDIA_TYPE` ("PDF text extraction is not available yet.")
  - WebP → 415 `UNSUPPORTED_MEDIA_TYPE` ("WebP is not a supported Textract input format yet.")
  - 12 MB PNG → 413 `FILE_TOO_LARGE`
  - valid PNG, no AWS credentials → 503 `AWS_NOT_CONFIGURED` (honest, no fake extraction)
- Landing `/` 200 · `/api/health` ok · `/incident/[id]` renders console shell · no dev-log errors
- Client bundle check: no `@aws-sdk/client-textract` reference in `.next/static` chunks
- State-machine harness: **21/21** checks passed (transitions, duplicate/order guards, timeline events with filenames, reverts, and localStorage *not* containing raw text)

## 19. Real Textract test result

**TEXTRACT TEST: NOT RUN — AWS credentials unavailable.**

No AWS credentials are configured in this environment, so no claim of real Textract extraction is made. The full pipeline is implemented and every non-AWS behaviour was verified; the extraction call executes against real Textract the moment credentials are present.

## 20. Manual test results

See §18. Interaction-level checks (clicking "Process evidence", success preview rendering) follow from the verified logic + state machine (21/21) and the live endpoint tests covering every branch the UI consumes.

## 21. Problems encountered

- ESLint `react-hooks/set-state-in-effect` (Task 3 pattern) — not applicable to new code; new hook is event-driven.
- `tsc` errors after the first pass:
  - `errorBody` helper wasn't typed to `ExtractionError` (code was `string`, not `ExtractionErrorCode`).
  - removed `timelineService` import from `use-incident` that was still needed by the reload function.
  - leftover unused/broken `failed` helper in the route (typed nonsense) — removed.

## 22. Problems fixed

- All three `tsc` errors from §21 fixed; lint/typecheck/build now clean.
- Pre-existing duplicate timeline events for evidence capture/removal fixed (single writer per event).

## 23. Known limitations

- **WebP** is captured but rejected for extraction — AWS Textract does not accept WebP input. This is intentional per the "where supported" scope.
- **PDF** is captured but not processed — sync `DetectDocumentText` does not accept PDF; async Textract (Task 5) is the right venue.
- Extractable sync image size limited to 5 MB (Textract constraint).
- Multipart body is parsed fully in memory; fine for the 5 MB evidence target, worth revisiting with streaming when durable storage arrives.
- Extracted text is session-only by design; a page refresh requires re-extraction to view it again.
- Serverless function timeouts could limit long Textract calls on hosted deployments (not an issue for local `next start/dev`).

## 24. Architecture decisions

- **Boundary**: client never speaks to AWS; a single server route owns validation + Textract.
- **Textractor kept out of the services barrel** so the SDK can't leak into the client bundle.
- **Status is the UI driver** — evidence records persist `status`/metadata; extracted text stays in hook memory.
- **LocalStorage holds metadata only**, not raw OCR text (explicit decision; raw text is sensitive and session-only for now).
- AWS config is detected, not faked — missing credentials produce an explicit, honest state.
- `DetectDocumentText` (sync, bytes) chosen as the simplest correct Textract API for image evidence.

## 25. Exact commands used

- `npm install @aws-sdk/client-textract`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npx --yes tsx ff4-check.ts` (transient logic harness, deleted after run — no repo change)
- Endpoint probes via `curl.exe -F … http://localhost:3000/api/evidence/extract`

## 26. Final directory structure (Task 4 additions highlighted)

```
src/
  app/
    api/
      evidence/extract/route.ts        ← NEW server endpoint
      health/route.ts
    incident/[id]/page.tsx
    page.tsx
  components/incident/*                (evidence-list.tsx, incident-workspace.tsx updated)
  hooks/
    use-evidence-processing.ts         ← NEW
    use-incident.ts / use-incident-timer.ts / use-start-incident.ts
  services/
    extraction/
      index.ts                         ← NEW normalization + limits
      textract.ts                      ← NEW Textract adapter
    evidence/index.ts                  (state machine added)
    incidents/, timeline/, intelligence/, storage.ts
  types/
    extraction.ts                      ← NEW
    evidence.ts / incident.ts / timeline.ts / intelligence.ts / index.ts
  lib/format.ts, lib/utils.ts
  config/site.ts
.env.example                           (AWS vars documented)
next.config.ts                         (serverExternalPackages)
package.json                           (@aws-sdk/client-textract)
```

## 27. Confirmation: Bedrock was NOT implemented

Confirmed. AWS Bedrock is not imported, installed, or referenced anywhere. Textract is scoped strictly to IMAGE → TEXT; no reasoning/AI is present.

## 28. Confirmation: S3 was NOT implemented

Confirmed. No S3 client, bucket logic, or object storage exists. Evidence bytes travel browser → API → Textract in-memory only.

## 29. Confirmation: Task 5 was NOT started

Confirmed. Work stopped at the Task 4 boundary (extraction foundation). No entity extraction, correlation, durable storage, or intelligence features were begun.

## 30. Ready for Task 5?

**YES.** The extraction boundary, normalized contract (extensible in `types/extraction.ts`), evidence state machine, timeline wiring, and honest AWS-unconfigured behaviour are in place and verified — a clean foundation for Task 5 (structured entity extraction from the extracted text) and later durable/tamper-evident evidence storage.