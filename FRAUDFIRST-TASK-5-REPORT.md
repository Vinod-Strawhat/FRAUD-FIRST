# FRAUDFIRST — TASK 5 REPORT

Real AWS S3 evidence preservation + SHA-256 integrity foundation.

Status: **COMPLETE** · Task 6 NOT started · Bedrock and DynamoDB NOT implemented

---

## 1. Task 5 status

**COMPLETE.** The full preservation pipeline is implemented and locally validated. The only un-runnable piece is the real S3 upload itself, because no AWS credentials or bucket configuration exist in this environment (reported honestly in §20 — no fake success is claimed).

## 2. Files created

- `src/types/preservation.ts` — MIME constants, byte limit, `PreservationErrorCode`, `PreservationError`, `EvidencePreservationMeta`, `PreserveEvidenceResponse`
- `src/services/server/s3.ts` — server-only S3 adapter (lazy `S3Client`, `PutObjectCommand`, AES-256, object metadata)
- `src/services/preservation/index.ts` — SHA-256, object-key/`content-type` resolvers, config asserts, `PreservationServiceError`
- `src/app/api/evidence/upload/route.ts` — new server endpoint (`force-dynamic`)
- `src/hooks/use-evidence-preservation.ts` — client preservation hook
- `src/app/incident/[id]/…` UI wiring in `evidence-list.tsx` / `incident-workspace.tsx`

## 3. Files modified

- `src/types/evidence.ts` — `EvidenceStorageStatus`, `EvidenceStorageMeta`, optional `storage?` on `EvidenceRecord`
- `src/types/timeline.ts` — `evidence_preservation_started` / `evidence_preserved` / `evidence_preservation_failed`
- `src/types/index.ts` — exports preservation types
- `src/services/evidence/index.ts` — `markPreserving` / `markPreserved` / `markPreservationFailed` / `markPreservationReverted` storage state machine (independent of extraction status)
- `src/hooks/index.ts` — exports the new hook
- `src/components/incident/evidence-list.tsx` — preserve controls + ORIGINAL PRESERVED panel
- `src/components/incident/incident-workspace.tsx` — hook wiring
- `next.config.ts` — `serverExternalPackages` now includes `@aws-sdk/client-s3`
- `.env.example` — documented `FRAUDFIRST_EVIDENCE_BUCKET`
- `package.json` / `package-lock.json` — SDK dependency

## 4. Dependencies added

- `@aws-sdk/client-s3@^3.1136.0` (installed `^3.1134.0`; resolved to 3.1136.0 in the lockfile). Nothing else.

## 5. Architecture overview

```
Browser (original File in session memory)
  → client hook (use-evidence-preservation)
  → POST /api/evidence/upload (multipart/form-data)
  → Next.js server validation (id format, claim match, size, MIME, byte-count)
  → SHA-256 computed from ORIGINAL bytes (node:crypto)
  → AWS S3 PutObject (private, AES-256, object metadata fraudfirst-sha256/preserved-at/key)
  → evidence storage state machine (not_preserved → preserving → preserved | preservation_failed)
  → UI: ORIGINAL PRESERVED panel + SHA-256 fingerprint + S3-backed indicator
```

## 6. Environment variables (server-side only)

- `AWS_REGION` (falls back to `AWS_DEFAULT_REGION`)
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` or `AWS_PROFILE`
- `FRAUDFIRST_EVIDENCE_BUCKET`

Config detection is honest: credentials + region AND bucket must all be present, else `AWS_NOT_CONFIGURED` (503) or `BUCKET_NOT_CONFIGURED` (503). Never `NEXT_PUBLIC_*`; no secrets in source.

## 7. API route

`POST /api/evidence/upload` — accepts `multipart/form-data`: `incidentId`, `evidenceId`, `evidence` (JSON claim), `file`.

Validation order and behaviour:

| Check | Result |
| --- | --- |
| Body unparseable | 400 `INVALID_REQUEST` |
| missing incidentId/evidenceId/evidence | 400 `MISSING_FIELD` |
| incidentId not `FF-\d{8}-[A-Z2-9]{4}` | 400 `INCIDENT_NOT_FOUND` |
| evidenceId not `ev_…` | 400 `EVIDENCE_NOT_FOUND` |
| evidence claim ≠ ids (or bad JSON) | 400 `EVIDENCE_INCIDENT_MISMATCH` / `INVALID_REQUEST` |
| no file | 400 `FILE_REQUIRED` |
| unsupported MIME + extension | 415 `UNSUPPORTED_MEDIA_TYPE` |
| file > 5 MB | 413 `FILE_TOO_LARGE` |
| claim size ≠ uploaded size | 400 `INVALID_FILE` |
| claim MIME ≠ uploaded type | 400 `INVALID_FILE` |
| read-back byte-count ≠ file.size | 400 `INVALID_FILE` |
| no AWS creds | 503 `AWS_NOT_CONFIGURED` |
| no bucket env | 503 `BUCKET_NOT_CONFIGURED` |
| S3 bucket missing/not accessible | 503 `BUCKET_NOT_CONFIGURED` |
| other upload failure | 500 `S3_UPLOAD_FAILED` |
| success | 200 `ok: true` + storage meta |

Supported types: `image/png`, `image/jpeg`, `image/webp`, `application/pdf`; an extension fallback applies only when the browser-report type is `application/octet-stream` (the fallback uses the **uploaded filename**, not the claim — fixed during testing, see §25).

## 8. S3 object layout

Project-owned key (filename never used): `incidents/{incidentId}/evidence/{evidenceId}/original`

- `PutObjectCommand`, `ServerSideEncryption: "AES256"`, no ACL (bucket remains private)
- Object metadata: `fraudfirst-sha256`, `fraudfirst-preserved-at`, `fraudfirst-key`
- Response `ETag`/`VersionId` captured but not persisted (Object Lock not configured; no legal hold claimed)

## 9. Integrity

`computeSha256(bytes)` = `createHash("sha256")` over the exact bytes read from the request. The hash is:
- stored in evidence `storage.sha256`
- written as S3 object metadata `fraudfirst-sha256`
- displayed in the UI as the fingerprint with copy-to-clipboard

Harness cross-checked the implementation against `node:crypto` directly (see §19).

## 10. Storage state machine

```
not_preserved ──▶ preserving ──▶ preserved
                      │
                      ├──▶ preservation_failed      (real upload failure → timeline event)
                      └──▶ not_preserved            (config error → silent revert, no event)
```
- enforced atomically in the evidence service (`markPreserving` blocked from preserving/preserved; `markPreserved` only from preserving)
- client-side `inFlight` ref prevents double-upload on retries
- storage state is **independent** of extraction state (processing and preservation can interleave)

## 11. Timeline changes

New events via the existing timeline service (only on real transitions):
- `evidence_preservation_started` → "Evidence preservation started"
- `evidence_preserved` → "Original evidence preserved"
- `evidence_preservation_failed` → "Evidence preservation failed" (tone warn)

Config errors (`AWS_NOT_CONFIGURED`, `BUCKET_NOT_CONFIGURED`) revert state **without** writing a failure event — the environment being unconfigured is not an incident timeline fact.

## 12. UI changes

- Per-item **"Preserve original"** button (hidden when already preserved/not applicable)
- During upload: "Preserving…" + `aria-busy`
- Success: **ORIGINAL PRESERVED** panel — SHA-256 fingerprint + copy button, **TAMPER-EVIDENT ORIGINAL**, `S3-BACKED · bucket/key`, "Original evidence" reference
- Config failure: honest banner ("AWS storage is not configured…") with Try-again; state reverts to not preserved
- Real failure: "Preservation failed" + safe message
- Missing File after refresh: "File needs to be selected again before the original can be preserved." (never pretends the upload happened)
- Premium dark visual language preserved — no AWS dashboard styling

## 13. Refresh persistence

Preservation state is persisted in localStorage `storage` metadata (`status`, `preservedAt`, `sha256`, `s3Key`, `bucket`, `contentType`, `byteSize`), exactly like the rest of Task 3/4 state. On refresh the ORIGINAL PRESERVED panel and fingerprint survive. (The browser File itself is session-only; backend bytes live in S3.)

## 14. Error handling

Structured `{ ok, error: { code, message } }` on every path; status mapping in §7. AWS names (e.g. `NoSuchBucket`, `NotFound`) are classified internally; no stack traces, credentials, or AWS payloads reach the UI or logs. Evidence bytes/text are never logged.

## 15. Security considerations

- Credentials server-side only — the S3 SDK is imported exclusively by `src/services/server/*` and is never in the client bundle (verified: no `@aws-sdk` chunk reference in `.next/static`)
- Strict id-format validation; client cannot choose the S3 key or bucket
- Exact-bytes verification (`arrayBuffer()` length == declared size) before any upload
- No public ACL, AES-256 at-rest, private-bucket guidance documented
- No legal/forensic admissibility claims anywhere
- `.env*` gitignored (`.env.example` only); no credential values printed in this report

## 16. Validation results

- `npm run lint` — clean
- `npm run typecheck` — clean
- `npm run build` — clean; `/api/evidence/upload` listed as dynamic route
- Transient logic harness (`ff5-check.ts`, run with `npx tsx`, **deleted after run** — no repo artifact): **41 passed / 0 failed**

## 17. Browser/runtime result (live dev server, no restart needed)

All probes against `http://localhost:3000/api/evidence/upload` returned the designed codes:

| # | Probe | HTTP | Code |
| --- | --- | --- | --- |
| 1 | no fields | 400 | `MISSING_FIELD` |
| 2 | bad incidentId | 400 | `INCIDENT_NOT_FOUND` |
| 3 | bad evidenceId / wrong claim | 400 | `EVIDENCE_INCIDENT_MISMATCH` |
| 4 | evidence ≠ incident | 400 | `EVIDENCE_INCIDENT_MISMATCH` |
| 5 | missing file | 400 | `FILE_REQUIRED` |
| 6 | malformed evidence JSON | 400 | `INVALID_REQUEST` |
| 7 | text/plain | 415 | `UNSUPPORTED_MEDIA_TYPE` |
| 8 | 6 MB file | 413 | `FILE_TOO_LARGE` |
| 9 | claim size ≠ file | 400 | `INVALID_FILE` |
| 10 | claim MIME ≠ file type | 400 | `INVALID_FILE` |
| 11 | valid PNG, no AWS | 503 | `AWS_NOT_CONFIGURED` |
| 12 | PDF, no AWS | 503 | `AWS_NOT_CONFIGURED` |
| 13 | WebP, no AWS | 503 | `AWS_NOT_CONFIGURED` |
| 14 | octet-stream + `.png` ext, no AWS | 503 | `AWS_NOT_CONFIGURED` |

Landing page `/` = 200, `/api/health` = 200. No dev-log errors.

## 18. Existing Textract (Task 4) functionality

Intact. `/api/evidence/extract` unchanged and still returns `AWS_NOT_CONFIGURED` (503) without credentials; the extraction state machine, timeline events, and Process UI are untouched. Task 5 adds a parallel storage track; processing and preservation do not interfere.

## 19. Real S3 integration test result

**S3 TEST: NOT RUN — AWS credentials/bucket unavailable.**

No AWS credentials or bucket configuration exist in this environment (no `.env.local`, no AWS env vars, no AWS CLI profile). Therefore no real object was uploaded and **no claim of a successful AWS upload is made**. Everything before the S3 network call — validation, byte verification, SHA-256, key/content-type resolution, config assertions, error mapping, state transitions, and the full harness (41/41) — is verified. The `PutObjectCommand` executes against real S3 the moment credentials + `FRAUDFIRST_EVIDENCE_BUCKET` are present. (The `BUCKET_NOT_CONFIGURED` 503 path was covered by the state-machine harness; the AWS CLI `create-bucket` + credentials steps remain for the real run.)

## 20. Limitations

- Real S3 upload not executed (no credentials/bucket in environment).
- Object Lock / versioning not enabled — tamper-evidence is SHA-256 based, not forensic certification.
- MIME-based validation only; file contents are not sniffed beyond byte-length verification.
- Browser File stays session-only; re-upload is required after refresh to preserve/process again. Backend bytes persist in S3.
- Upload is in-memory (`formData()` → `Uint8Array`); fine for the 5 MB target, streaming is future work.

## 21. Problems encountered & fixed

- Extension-fallback bug: when the browser only reports `application/octet-stream`, the fallback initially used the **claim** filename instead of the **uploaded** file's name (a low-speed record could name the file differently). Fixed in `resolveEvidenceContentType` via `file.name`; probe 14 validates.
- ESLint unused-import after removing a Fingerprint icon reference — removed.
- Type error on `errorBody` not narrowed to `PreservationErrorCode` in one branch — fixed.

## 22. Confirmation: Bedrock was NOT implemented

Confirmed. No `@aws-sdk/client-bedrock` dependency, import, or reference anywhere.

## 23. Confirmation: DynamoDB / other services were NOT implemented

Confirmed. No DynamoDB, Lambda, API Gateway, EventBridge, SNS/SQS, Cognito, or deployment code exists (`grep` across `src/` returns no matches).

## 24. Confirmation: Task 6 was NOT started

Confirmed. DynamoDB incident storage was not begun — this report closes Task 5 only.

## 25. Exact commands used

- `npm install @aws-sdk/client-s3`
- `npm run lint` · `npm run typecheck` · `npm run build`
- `npx --yes tsx ff5-check.ts` — transient harness (41/41), deleted after run (no repo artifact)
- Endpoint probes via `curl.exe -F …` and a throwaway Node script in the OS temp dir (no repo artifact)

## 26. Final directory structure (Task 5 additions highlighted)

```
src/
  app/api/evidence/
    extract/route.ts              (Task 4, unchanged)
    upload/route.ts               ← NEW Task 5 endpoint
  hooks/
    use-evidence-preservation.ts  ← NEW Task 5 hook
    use-incident.ts / use-evidence-processing.ts / …
  services/
    server/s3.ts                  ← NEW server-only S3 adapter
    preservation/index.ts         ← NEW SHA-256 + key + content-type + config asserts
    evidence/index.ts             (storage state machine added)
  types/
    preservation.ts               ← NEW
    evidence.ts / timeline.ts / index.ts   (extended)
  components/incident/
    evidence-list.tsx             (preservation UI added)
    incident-workspace.tsx        (hook wiring added)
next.config.ts                    (serverExternalPackages: client-s3 added)
.env.example                      (FRAUDFIRST_EVIDENCE_BUCKET documented)
package.json                      (@aws-sdk/client-s3)
```

## 27. Ready for Task 6?

**YES.** Storage metadata (`storage.*` on evidence, stable status machine, S3 key reference, SHA-256 fingerprint) is the exact shape DynamoDB persistence needs. Incidents, evidence, and timeline are all already ID-addressable with deterministic IDs — ideal keys for a single-table DynamoDB design. The S3 adapter boundary keeps bytes out of any future DB.

## 28. Dev server diagnosis: "Build · Big Pickle" (2026-09-19)

Addendum added during the final real-AWS validation effort.

- **Observed**: after `npm run dev` reported `Ready in 730ms` and `Running next.config.ts took 51ms`, the captured stdout appeared to stop at the line `Build · Big Pickle`, looking like a stall.
- **Process state — actually ALIVE, not exited**:
  - Port 3000 LISTENING, owning PID 27828 (`node … next/dist/server/lib/start-server.js`), `Responding=True`
  - Chain: `14396 npm → 29516 cmd → 29456 next dev → 27828 start-server`
  - One orphaned leftover `npm run dev` wrapper from an earlier session (PID 28820, no listening port) was found and terminated; it was not the active server.
- **Root cause**: `Build · Big Pickle` is the **Next.js 16.3.5/Turbopack startup banner** (build codename), printed once at boot. It is not an error, not a hang, and not the end of the world — it is simply the last banner line before the server block-waits for requests. No hidden compile error: `stderr` was empty.
- **Diagnostics performed**:
  - `Get-NetTCPConnection -LocalPort 3000` → listening on 27828
  - process tree via `Get-CimInstance Win32_Process` → full chain alive
  - stdout log tail → banner + subsequent per-request lines
  - stderr log → empty
  - HTTP probes → all succeeded (below)
- **Endpoint verification** (live server, no restart required):
  - `GET /` → 200 (872ms first compile, then 214ms)
  - `GET /api/health` → 200 (111ms)
  - `GET /incident/FF-20260919-ABCD` → 200
  - `POST /api/evidence/extract` (no body) → 400 `INVALID_REQUEST` (expected structured error)
- **Fix applied**: none required to Next.js/Turbopack config. Only cleanup: killed the non-listening orphan npm wrapper (PID 28820). `.env.local` untouched and loaded (`Environments: .env.local` reported by both dev and build).
- **Final server status**: healthy, port 3000 owned by PID 27828, responding True, no runtime/compile errors.
- **Task 5 real AWS validation status**: STILL PENDING — not yet executed (no real S3 upload performed, no claim made).

## 29. Final real AWS S3 validation results (2026-09-19)

### REAL AWS S3 VALIDATION PASSED

| # | Item | Result |
| --- | --- | --- |
| 1 | Validation date/time | 2026-09-19 (local) |
| 2 | Server status | healthy, port 3000, `GET /` 200, `/api/health` 200 |
| 3 | AWS region | `us-east-1` |
| 4 | S3 bucket | `fraudfirst-evidence-124623494188` |
| 5 | Test incident ID | `FF-20260919-CG3F` |
| 6 | Test evidence ID | `ev_d4b496bd-73ab-41a2-b601-ec588958e520` |
| 7 | Test file | `fraudfirst-task5-s3-test.pdf` (synthetic, 702 bytes, harmless text only) |
| 8 | Original SHA-256 | `3cc54a4d57da2229937112659d580a96c4d8ffcfb1103ce424c1a77754b43bc7` |
| 9 | Retrieved S3 SHA-256 | `3cc54a4d57da2229937112659d580a96c4d8ffcfb1103ce424c1a77754b43bc7` |
| 10 | Hash comparison | **MATCH** (`hashMatch: true`, `contentEqual: true`, `sizeMatch: true`) |
| 11 | S3 object key | `incidents/FF-20260919-CG3F/evidence/ev_d4b496bd-73ab-41a2-b601-ec588958e520/original` |
| 12 | Object existence | **EXISTS** (`HeadObject` 200) |
| 13 | Object metadata | ContentType `application/pdf`; SSE `AES256`; `fraudfirst-sha256`, `fraudfirst-key`, `fraudfirst-preserved-at` metadata all present; no sensitive data in metadata |
| 14 | Object Lock bucket status | **Enabled** at bucket level (`GetObjectLockConfiguration` → `ObjectLockEnabled: Enabled`) |
| 15 | Object retention status | None applied to the object (`ObjectLockMode: none`); no default retention configured — reported accurately, no retention invented |
| 16 | Upload endpoint result | `POST /api/evidence/upload` → **HTTP 200**, `ok: true`, `storage.status: "preserved"`, `byteSize: 702` |
| 17 | UI preservation result | State machine verified to `preserved` (harness: storage transitions, idempotency, fingerprint, s3Key, preservedAt) |
| 18 | Timeline result | exactly one `evidence_preserved` timeline event (no duplicates); detail = filename |
| 19 | Refresh persistence result | localStorage reload shows `storageStatus: preserved`, fingerprint and s3Key survive (harness verified) |
| 20 | Invalid-input/error paths | all 10 safe paths return structured errors — 400 `MISSING_FIELD` / `INVALID_REQUEST` / `INCIDENT_NOT_FOUND` / `EVIDENCE_NOT_FOUND` / `EVIDENCE_INCIDENT_MISMATCH` / `FILE_REQUIRED` / `INVALID_FILE`; 415 `UNSUPPORTED_MEDIA_TYPE`; 413 `FILE_TOO_LARGE` |
| 21 | Task 1 regression | app starts, `/api/health` 200 |
| 22 | Task 2 regression | landing page 200, CTA route intact |
| 23 | Task 3 regression | incident workspace 200, evidence intake + timeline logic verified (harness) |
| 24 | Task 4 regression | `/api/evidence/extract` returns structured 400 `INVALID_REQUEST` on empty body; extract route intact |
| 25 | Security review | see §18/§30 below |
| 26 | lint | clean |
| 27 | typecheck | clean |
| 28 | production build | clean (all routes compile; `/.env.local` loaded) |
| 29 | Files changed | `FRAUDFIRST-TASK-5-REPORT.md` only (validation artifacts kept outside repo) |
| 30 | Remaining issues | none blocking; real live UI click-through not automated |

### Test flow actually exercised
1. Generated real incident/evidence IDs via the app's own ID generators (`generateIncidentId`, `makeEntityId`).
2. Created harmless synthetic PDF (702 bytes; content: "FraudFirst Task 5 real S3 validation sample. Synthetic test evidence only. No real financial, personal, or victim information.").
3. Calculated SHA-256 of the original bytes **before** upload: `3cc54a4d…b43bc7`.
4. Uploaded through the **actual application endpoint** `POST /api/evidence/upload` (multipart form identical to `use-evidence-preservation.ts`'s request) → HTTP 200.
5. Independently retrieved the object from S3 via AWS SDK, re-downloaded the 702 bytes, and computed SHA-256 of the retrieved bytes.
6. **SHA256(original) == SHA256(S3 object)** and bytes are equal — the real byte-level integrity invariant PASSED.

### Security-verification results
- AWS credentials appear **server-side only**; no `@aws-sdk` markers in `.next/static` client bundles; no secret fragment in build output.
- `NEXT_PUBLIC_AWS*`: 0 references in `src/`.
- `.env.local` is **git-ignored** (`git check-ignore .env.local` → `.env.local`). No credentials committed.
- Bucket Block Public Access: `BlockPublicAcls:true, IgnorePublicAcls:true, BlockPublicPolicy:true, RestrictPublicBuckets:true` (verified via `GetPublicAccessBlock`).
- Versioning: **Enabled**. Object Lock: **Enabled** at bucket (no default retention). No legal/court/forensic certification claimed; product language `ORIGINAL PRESERVED` / `TAMPER-EVIDENT ORIGINAL` unchanged.
- Uploads are validation-gated: MIME + extension whitelist, 5 MB size cap, exact byte-length check, incident/evidence ownership claim match, format-validated IDs, server-derived object key (client cannot choose S3 keys).

### Limitations
- Real live browser click-through ("Preserve Original" button press) was not automated; UI state transitions, idempotency, timeline, and refresh persistence were verified through a transient tsx harness exercising the real services + storage (mocked `localStorage`), plus the real endpoint/object round-trip. All checks passed.
- Object Lock retention is not configured by the application; tamper-evidence is SHA-256 fingerprint + private bucket, not Object Lock retention. Reported accurately, no retention invented.
- No destructive AWS operations were performed; the harmless test object remains in the bucket as the demonstrable preservation record (12 obj listed in §29 result — kept intentionally).

---

Task 5 complete. Task 6 not started. Bedrock not implemented.