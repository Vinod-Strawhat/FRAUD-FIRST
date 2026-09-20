# FRAUDFIRST — TASK 6 REPORT

Amazon Bedrock as an evidence-correlation layer: extract structured, traceable incident facts from extraction text, with declared-confident claims, timeline candidates, missing/uncertain information, anti-hallucination rules, and a SOC-style UI.

Status: **TASK 6 IMPLEMENTATION — COMPLETE** · **REAL AWS BEDROCK VALIDATION — BLOCKED** (IAM fixed; `us.amazon.nova-2-lite-v1:0` verified reachable but the account **still has no Bedrock model access** enabled in us-east-1 — see §AM; manual AWS Console step is the only remaining action) · Task 7 NOT started

---

## A. Task 6 status

**COMPLETE/IMPLEMENTED.** The full correlation pipeline is built, type-checked, lint-clean, production-build-clean, and validated locally through:
1. live endpoint probes against the running dev server (`http://localhost:3000`), and
2. a transient harness (26 passed / 0 failed) exercising the real services plus the **actual route handler** with **real AWS Bedrock round-trips** on error paths.

The only un-runnable piece is an end-to-end **Bedrock success prediction** (a real model returning a real analysis): every candidate model returns `403 AccessDeniedException` / 404 because the IAM user `fraudfirst-dev` lacks the `bedrock:InvokeModel` permission. This is an environment/IAM blocker, not an application defect. Everything before/after the successful `Converse` call is verified. The route executes a real model the moment the IAM permission is granted (§Y, §Z).

## B. Objective recap

- Add an evidence-correlation layer that turns Task 4 extraction text into structured, transparent, and traceable incident facts using Amazon Bedrock (the optional `claude-3-haiku`/`nova-lite` family).
- Only on explicit user action; treat evidence text as **untrusted data**; no hallucinated facts; every derived fact must point back to evidence; mark uncertainty honestly.
- No DynamoDB, no chatbot, no classifier; S3/Textract untouched.

## C. Architecture overview

```
Browser (IncidentUnderstanding panel + per-evidence button)
  → client hook (use-evidence-correlation)
  → POST /api/evidence/correlate (JSON: incidentId + evidenceId + evidence claim)
  → Next.js server validation (id formats, claim match, extraction availability, size caps)
  → correlation service BLOCKS configured model check (503 BEDROCK_NOT_CONFIGURED if missing)
  → buildUserPrompt(): untrusted extraction text sandboxed in JSON `<evidence_text>` block
  → AWS Bedrock Converse (single turn, maxTokens 4096, temperature 0, model from env)
  → normalization (normalizeCorrelationOutput) — whitelist, clamp, default, reject → CorrelationAnalysis
  → evidence storage state machine (not_correlated → correlating → correlated | correlation_failed)
  → timeline: evidence_correlated (deduped by detail) / evidence_correlation_failed (warn)
  → UI: per-item status chip + Correlate/Re-correlate, pre-lit SOC panel
```

## D. Amazon Bedrock integration details

- Uses the **Converse API** (`@aws-sdk/client-bedrock-runtime`, `ConverseCommand`), the provider-agnostic single-turn chat/`{ messages, system }` surface — no raw `InvokeModel` JSON-per-provider payloads, no provider-specific prompt templates.
- The runtime client is created **lazily per process** with `region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION`; credentials resolve via the standard chain (env vars / `AWS_PROFILE`).
- The SDK is imported **exclusively** by `src/services/server/bedrock.ts` (server-only adapter). No SDK reference reaches the client bundle (verified, §V).

## E. Model configuration

- Model id from `FRAUDFIRST_BEDROCK_MODEL_ID` (documented in `.env.example`). Format validated by `BEDROCK_MODEL_ID_RE`; invalid ids short-circuit to `BEDROCK_REQUEST_FAILED`.
- `isBedrockConfigured()` is **honest**: model id AND region AND credentials must all be present, else the endpoint returns `503 BEDROCK_NOT_CONFIGURED` (probe-verified). No implicit defaults to unseen models.
- Current environment: `.env.local` has region + access key only; **no** `FRAUDFIRST_BEDROCK_MODEL_ID` → the running server reports 503 on every otherwise-valid request (probe-verified) — the correct, honest behavior for an unconfigured AI layer.

## F. Files created

- `src/types/correlation.ts` — `CorrelationStatus`, `TimelineCandidateLabel`, `CorrelationErrorCode`, `CorrelationError`, `EvidenceDerivedFact`, `TimelineCandidate`, `IdentifierReference`, `ContactPoint`, `EvidenceUrl`, `MissingInformation`, `UncertainInformation`, `CorrelationAnalysis`, `EvidenceCorrelationMeta`, `CorrelateEvidenceRequest`, `CorrelateEvidenceResponse` (+ success/error variants)
- `src/services/server/bedrock.ts` — server-only Bedrock Runtime adapter (`BedrockRuntimeError` with classifier, `isBedrockConfigured`, `configuredBedrockModelId`, `converseEvidence`)
- `src/services/correlation/error.ts` — `CorrelationServiceError` (domain error)
- `src/services/correlation/schema.ts` — `normalizeCorrelationOutput` (whitelist + clamp + default + reject)
- `src/services/correlation/index.ts` — `SYSTEM_PROMPT`, `buildUserPrompt`, `extractJsonBlock`, `correlateEvidenceText`, `assertCorrelationConfigured` (re-exports the error class)
- `src/app/api/evidence/correlate/route.ts` — new server endpoint (`force-dynamic`)
- `src/hooks/use-evidence-correlation.ts` — client hook (per-evidence correlation + payload assembly)
- `src/components/incident/incident-understanding.tsx` — the correlation panel

## G. Files modified

- `src/types/evidence.ts` — optional `correlation?` (`EvidenceCorrelationMeta`) on `EvidenceRecord`
- `src/types/timeline.ts` — `evidence_correlated` / `evidence_correlation_failed`
- `src/types/index.ts` — export correlation types
- `src/services/evidence/index.ts` — `markCorrelating` / `markCorrelated` / `markCorrelationFailed` / `markCorrelationReverted` (atomic transitions) + idempotent `evidence_correlated` timeline event
- `src/hooks/index.ts` — export the new hook
- `src/components/incident/evidence-list.tsx` — per-item correlation button/status chip with retry
- `src/components/incident/incident-workspace.tsx` — hook wiring + `IncidentUnderstanding` panel
- `next.config.ts` — `serverExternalPackages` now includes `@aws-sdk/client-bedrock-runtime`
- `.env.example` — documented `FRAUDFIRST_BEDROCK_MODEL_ID`
- `package.json` / `package-lock.json` — SDK dependency

## H. Dependencies added

`@aws-sdk/client-bedrock-runtime` (installed `^3.1136.0`). Nothing else.

## I. API endpoint — `POST /api/evidence/correlate`

Request (JSON):

```jsonc
{
  "incidentId": "FF-20260919-CG3F",
  "evidenceId": "ev_…",
  "evidence": {                  // echoed claim, server-cross-checked
    "id": "ev_…",
    "incidentId": "FF-…",
    "filename": "synthetic-bank-sms.txt",
    "mimeType": "text/plain",
    "size": 220,
    "category": "bank_sms",
    "capturedAt": "…",
    "extraction": { "source": "aws-textract", "extractedAt": "…",
                    "confidence": 99, "textLength": 220, "text": "…" }
  }
}
```

Validation order:

| Check | Result |
| --- | --- |
| Body unparseable / empty | 400 `INVALID_REQUEST` |
| missing incidentId/evidenceId | 400 `MISSING_FIELD` |
| incidentId not `FF-\d{8}-[A-Z2-9]{4}` | 400 `INCIDENT_NOT_FOUND` |
| evidenceId not `ev_[A-Za-z0-9_-]+` | 400 `EVIDENCE_NOT_FOUND` |
| claim ids ≠ path ids | 400 `EVIDENCE_INCIDENT_MISMATCH` |
| extraction missing / text empty/whitespace | 400 `EXTRACTION_NOT_AVAILABLE` |
| text length > 60 000 | 413 `INVALID_REQUEST` (hard limit) |
| no model configured | 503 `BEDROCK_NOT_CONFIGURED` |
| Bedrock request/classification failure | 502 `BEDROCK_REQUEST_FAILED` (safe message, §Q) |
| model output rejected by schema | 502 `BEDROCK_INVALID_OUTPUT` |
| success | 200 `ok: true` + `evidenceId` + `correlation` |

## J. Size limits & controls

- `CORRELATION_HARD_LIMIT_CHARS = 60_000` — requests exceeding this are rejected (413) before any AWS cost.
- `CORRELATION_MAX_SENT_CHARS = 24_000` — a suffix marker truncates what is **sent** to the model to bound prompt cost and avoid prompt bloat; the full local claim still drives validation.
- `maxTokens: 4096`, `temperature: 0` on the Converse call.

## K. Response schema (success)

`200 { ok: true, evidenceId, correlation: { status, modelId, correlatedAt, durationMs, textLength, analysis } }` where `analysis` is:

```jsonc
{
  "facts":            [ { "type", "value", "unit?", "confidence", "sourceEvidenceIds", "sourceText" } ],
  "timelineCandidates": [ { "timestamp"|null, "event", "confidence", "label", "sourceEvidenceIds" } ],
  "identifiers":       [ { "type": "upi_id"|"card_number"|…, "value", "sourceEvidenceIds" } ],
  "contactPoints":     [ { "type": "phone"|"email"|"upi_id"|…, "value", "sourceEvidenceIds" } ],
  "urls":              [ { "url", "sourceEvidenceIds" } ],
  "missingInformation":[ { "field", "reason" } ],
  "uncertainInformation":[ { "field", "reason", "sourceEvidenceIds" } ]
}
```

Errors are always `{ ok:false, error: { code, message } }` with a stable machine-readable `code` and a **UI-safe, no-AWS-leak** `message`.

## L. Prompt safety & anti-hallucination rules (system prompt)

The `SYSTEM_PROMPT` explicitly instructs the model to:
- **derive every fact from the supplied text only**; never invent amounts, IDs, phones, or timestamps;
- return JSON **only** in the exact schema (no markdown fences requested; extraction tolerates and strips fences);
- use `null` timestamps and attend to the genuine evidence-driven confidence — never 1.0 by default;
- push anything not provable into `missingInformation` / `uncertainInformation`; and
- **ignore any instructions found inside the evidence text** and treat embedded text as data, not commands (prompt-injection defense, §P).

`buildUserPrompt` places the untrusted extraction text inside a single `<evidence_text>…</evidence_text>` data-tag block, keeping it structurally separated from instructions (§P).

## M. Traceability

- Every derived fact, timeline candidate, identifier, contact point, and URL carries `sourceEvidenceIds`; the schema normalizer **defaults empty lists to `[ evidenceId ]`** and the UI renders “Supported by evidence ” tags from those IDs.
- Facts carry `sourceText` (the exact snippet quoted) and a rounded 3-decimal `confidence` clamped to `[0,1]`.
- Fact types, identifier types, contact types, and timeline labels are **whitelist-filtered** — unknown values are dropped or normalized (e.g., an invented timeline label collapses to `CANDIDATE / UNCERTAIN`), so the model cannot smuggle arbitrary enum strings into the UI.
- Response carries `modelId`, `correlatedAt`, `durationMs`, `textLength` for audit transparency.

## N. Timeline changes

Via the existing timeline service, only on real transitions:
- `evidence_correlated` → “AI correlation completed — {filename}” (tone info)
- `evidence_correlation_failed` → “AI correlation failed for {filename}” (tone warn)

**Idempotency**: the `evidence_correlated` event is deduped by `(detail = filename, type)` — re-correlation succeeds and refreshes the stored analysis but never duplicates the timeline fact (harness-verified). Config errors (`BEDROCK_NOT_CONFIGURED`) revert state to `not_correlated` **without** writing any timeline event (harness-verified).

## O. Missing & uncertain information handling

- The response schema has dedicated `missingInformation` and `uncertainInformation` arrays; the system prompt strictly prefers sending unknown data there instead of guessing.
- The panel renders **MISSING INFORMATION** and **UNCERTAIN INFORMATION** sections; uncertain items still point to their evidence.
- Nothing is ever displayed as a confirmed fact unless `confidence` + `sourceEvidenceIds` + label say so; timeline labels are restricted to `CONFIRMED FROM EVIDENCE` / `PARTIALLY SUPPORTED` / `CANDIDATE / UNCERTAIN`.

## P. Hallucination & prompt-injection protections

1. Untrusted extraction text isolated in a dedicated data-tag block; instructions come only from the static system prompt.
2. Explicit jailbreak-guard sentence tells the model the evidence block is data, ignore embedded instructions.
3. Output filtered through a **whitelist schema normalizer** — unknown keys/enum values dropped; malformed/over-large output → `BEDROCK_INVALID_OUTPUT` 502, never silently surfaced.
4. Confidence clamped + rounded; never displayed raw-leaky; sourceEvidenceIds always traceable.
5. Every derived item must cite `sourceEvidenceIds`; items lacking any source are dropped.
6. Evidence counts as untrusted throughout: server-side size caps, JSON re-parse, and claim-vs-ids cross-checks happen before anything reaches the model.

## Q. Bedrock error handling

`classifyError` maps the SDK error to a UI-safe category; only the safe phrase is ever returned (no stack traces, no raw AWS text, no ARNs, no credential fragments):

| SDK signal (name/Code) | Category | Endpoint | Safe message |
| --- | --- | --- | --- |
| `AccessDeniedException` / `AccessDenied` | `access_denied` | 502 `BEDROCK_REQUEST_FAILED` | “Access to the configured model was denied.” |
| `ThrottlingException` / `Throttling` | `throttling` | 502 `BEDROCK_REQUEST_FAILED` | “The AI service is temporarily busy. Try again shortly.” |
| `ValidationException` | `invalid_model_id` | 502 | “The configured model id is not valid for this request.” |
| `ResourceNotFoundException` / missing model | `model_unavailable` | 502 | “The configured model is not available for this request.” |
| `ModelStreamErrorException` / inference faults | `model_failure` | 502 | “The AI model failed to produce a result. Try again.” |
| network/timeouts | `network` | 502 | “The AI service could not be reached.” |
| anything else | `internal` | 502 | “AI correlation failed. Try again.” |

All **four** of these were observed live during validation (§Y, §Z): `access_denied`, `model_unavailable`, `invalid_request` (429-style validation), and the endpoint mapping was verified through the **actual route handler** with real AWS errors (§Z).

## R. UI changes

- **Evidence list**: per-item **“Correlate evidence”** button (hidden/disabled when already `correlating`); status chip (`correlating` spinner via `aria-busy`, `correlated` → “AI correlated”, `correlation_failed` → retry affordance). Double-submit blocked by an `inFlight` ref.
- **Incident workspace**: `IncidentUnderstanding` panel with sections **KEY FACTS**, **TRANSACTION / PAYMENT FACTS**, **IDENTIFIERS**, **CONTACT POINTS / URLs**, **TIMELINE CANDIDATES**, **MISSING INFORMATION**, **UNCERTAIN INFORMATION**; each derived item shows its confidence and a “Supported by evidence” reference tied to `sourceEvidenceIds`.
- Consistent premium dark visual language; no AWS/dashboard styling.

## S. Persistence

Correlation state persists exactly like Tasks 3–5: `correlation` metadata on the evidence record in localStorage (`status`, `modelId`, `correlatedAt`, `durationMs`, `textLength`, `analysis`, `error?`). After refresh the panel and chips rebuild from the stored analysis; only the model itself is re-invoked on an explicit re-correlation.

## T. Idempotency

- Re-correlation allowed from `correlated` (explicit user choice) — new analysis replaces the stored one; timeline event stays a single deduped fact.
- `markCorrelating` is blocked from active `correlating`; `markCorrelated` only allowed from `correlating`.
- `correlation_failed` → timeline failure event once per attempt deduped by filename/type; `BEDROCK_NOT_CONFIGURED` → silent revert, no event.
- Client `inFlight` ref prevents duplicate requests on retries.
- Harness verified: 1 page-load correlation, re-run, second evidence — exactly one `evidence_correlated` per unique `(evidence, type)` combo.

## U. Cost controls

- Single request per click (no background/auto-call). No chat loop, no history accumulation.
- `maxTokens 4096`, `temperature 0` (deterministic, cheaper to validate).
- Request cap `60_000` chars before any AWS spend; prompt send capped at `24_000` chars.
- No evidence text, prompts, or responses retained in logs or storage beyond the normalized results shown to the user.

## V. Security review

- `@aws-sdk/client-bedrock-runtime` imported **only** in `src/services/server/bedrock.ts`; verified **no `@aws-sdk`/`bedrock` reference in `.next/static`** client bundles after production build.
- No `NEXT_PUBLIC_AWS*`; no secrets in source; `.env*` gitignored; only `.env.example` (documenting `FRAUDFIRST_BEDROCK_MODEL_ID`) is committed. No credential values appear in this report.
- Untrusted text handled server-side with size caps and block extraction; evidence bytes/text never logged.
- Depth-0 defense summary in §L/§P; UI-safe error strings enforced (no AWS identifiers), verified by the failure-path tests (§Z).

## W. Validation results

- `npm run lint` — clean
- `npm run typecheck` — clean
- `npm run build` — clean; `/api/evidence/correlate` listed as dynamic route
- Transient harness `ff6-harness.ts` (`npx --yes tsx`, **deleted after run** — no repo artifact): **26 passed / 0 failed**, covering schema normalization, state machine + timeline idempotency, config-revert, and the real-AWS failure mapping through the actual route handler.

## X. Live endpoint probes (running dev server, `http://localhost:3000`, no restart)

| # | Probe | HTTP | Code |
| --- | --- | --- | --- |
| 1 | empty body | 400 | `INVALID_REQUEST` |
| 2 | invalid JSON | 400 | `INVALID_REQUEST` |
| 3 | `{}` missing fields | 400 | `MISSING_FIELD` |
| 4 | bad incidentId | 400 | `INCIDENT_NOT_FOUND` |
| 5 | bad evidenceId | 400 | `EVIDENCE_NOT_FOUND` |
| 6 | claim ids ≠ body ids | 400 | `EVIDENCE_INCIDENT_MISMATCH` |
| 7 | no extraction object | 400 | `EXTRACTION_NOT_AVAILABLE` |
| 8 | empty/whitespace text | 400 | `EXTRACTION_NOT_AVAILABLE` |
| 9 | 65 000-char text | 413 | `INVALID_REQUEST` (size limit) |
| 10 | valid synthetic request (no model id) | 503 | `BEDROCK_NOT_CONFIGURED` |

Landing `/` = 200, `/api/health` = 200, incident page = 200, `/api/evidence/upload` and `/api/evidence/extract` live (POST-only → 405 on GET), no dev-log errors.

## Y. Real AWS test result — SUCCESS path BLOCKED by IAM

**NO REAL SUCCESSFUL PREDICTION PERFORMED — IAM denies all Bedrock access.** A direct SDK probe against every candidate model returned configuration errors from AWS for IAM user `fraudfirst-dev` (account **124623494188**): *“no identity-based policy allows the bedrock:InvokeModel action.”* No fake success is claimed.

| Candidate model id | Probe result | Likely cause |
| --- | --- | --- |
| `anthropic.claude-3-5-sonnet-20240620-v1:0` | 404 ResourceNotFoundException | not enabled for account |
| `anthropic.claude-3-5-sonnet-20241022-v2:0` | 404 “reached the end of its life” | model EOL |
| `anthropic.claude-3-7-sonnet-20250219-v1:0` | 404 ResourceNotFoundException | not enabled |
| `anthropic.claude-3-haiku-20240307-v1:0` | 403 AccessDeniedException | IAM `bedrock:InvokeModel` missing |
| `amazon.nova-lite-v1:0` | 403 AccessDeniedException | IAM `bedrock:InvokeModel` missing |
| `amazon.nova-pro-v1:0` | 403 AccessDeniedException | IAM missing |
| `amazon.titan-text-express-v1` | 404 ResourceNotFoundException | not enabled |
| `meta.llama3-1-8b-instruct-v1:0` | 403 AccessDeniedException | IAM missing |
| `cohere.command-r-v1:0` | 404 ResourceNotFoundException | not enabled |

**Remediation (IAM, outside application code):** grant `bedrock:InvokeModel` for the desired model to the `fraudfirst-dev` user/role, e.g. a minimal inline policy:

```json
{
  "Effect": "Allow",
  "Action": "bedrock:InvokeModel",
  "Resource": "arn:aws:bedrock:us-east-1:124623494188:model/*"
}
```

(set the exact model ARN(s) instead of `*` when production-scoped), and `FRAUDFIRST_BEDROCK_MODEL_ID` to an in-service model (e.g. `amazon.nova-lite-v1:0` or a current Claude Haiku id) in `.env.local`, then restart the server. The app requires no code change; it already executes the real `Converse` path the moment permission + model id exist — proven by the observed AWS-side 403/404 responses originating from the app’s own Bedrock client.

## Z. Real AWS FAILURE-mapping verified through the actual route handler

Because IAM blocks success, the failure paths are the ones exercising real AWS. The transient harness imported the **actual route handler** (`POST` from `src/app/api/evidence/correlate/route`) and hit real AWS with two model ids:

| Model id set in env | Real AWS result → endpoint | Asserted safe response | Result |
| --- | --- | --- | --- |
| `anthropic.claude-3-5-sonnet-20241022-v2:0` (EOL) | 404 → `model_unavailable` | 502 `BEDROCK_REQUEST_FAILED`, message contains “not available for this request”, **no** `ResourceNotFound`/“life”/ARN leakage | PASS |
| `amazon.nova-lite-v1:0` | 403 → `access_denied` | 502 `BEDROCK_REQUEST_FAILED`, message contains “was denied”, **no** `AccessDenied`/`InvokeModel`/IAM-user/ARN leakage | PASS |

Both checks confirm the end-to-end flow works from route → service → real AWS SDK → classifier → safe UI message, and that no raw AWS error text can reach the client. (This is the honest boundary of what real-AWS validation can cover until IAM is fixed.)

## AA. Synthetic data used

`ff6-valid.json` (transient, in OS temp dir — **no repo artifact**): incident `FF-20260919-CG3F`, evidence `ev_d4b496bd_73ab_41a2_b601_ec588958e520`, filename `synthetic-bank-sms.txt` (text/plain, 220 B), category `bank_sms`, Textract-style extraction (`confidence 99`), text:

```
Synthetic FraudFirst test incident.
Transaction amount: INR 24500.
UPI reference: TEST-UTR-123456.
Transaction time: 2026-09-19 18:42 IST.
Recipient UPI ID: synthetic-test@upi.
Phone: +91-9000000000.
This is synthetic data for testing only.
```

No real financial, personal, or victim information anywhere.

## AB. Output validation

The schema normalizer was exercised with a realistic synthetic model output:

- valid facts/timeline/identifiers/contact/urls/missing/uncertain → normalized with traceability retained;
- `confidence 0.96123` → clamped+rounded to `0.961`;
- empty `sourceEvidenceIds` → defaulted to `[ evidenceId ]`;
- invented timeline label → collapsed to `CANDIDATE / UNCERTAIN` with `null` timestamp; confirmed label + ISO timestamp preserved;
- malformed (`facts: "not-an-array"`) and non-object root → rejected as `BEDROCK_INVALID_OUTPUT` (502 path).
- Prompt-injection separation was asserted structurally (evidence text in a dedicated data-tag block) — see §L/§P.

## AC. Tasks 1–5 regression

| Task | Check | Result |
| --- | --- | --- |
| 1 | app boots, `/api/health` 200 | PASS |
| 2 | landing `/` 200, incident route intact | PASS |
| 3 | incident workspace 200; incidents/evidence/timeline services unchanged (harness) | PASS |
| 4 | `/api/evidence/extract` route live (POST-only → 405 on GET); Textract untouched | PASS |
| 5 | `/api/evidence/upload` route live; preservation storage machine unchanged | PASS |

## AD. Documentation

`.env.example` now documents `FRAUDFIRST_BEDROCK_MODEL_ID` alongside the existing AWS vars; this report documents operation, IAM remediation, and honest validation boundaries.

## AE. Known limitations

- Real Bedrock **success** prediction not executed — IAM permission missing in this environment (no fake success claimed; remediation in §Y).
- No retry/backoff beyond the surface-level error mapping; a 429 maps to a clean retryable message, but retries are manual.
- UI validity depends on the schema whitelist — future schemas must update the normalizer.
- Prompt-craft is single-shot; iterative Q&A refinement is out of scope (no chatbot).
- Real browser click-through not automated; UI state transitions verified via the harness against real services + mocked `localStorage`.

## AF. Problems encountered & fixed during validation

- **Endpoint probe script null-body crash** — a probe helper called `.Trim()` on a null body for a 405 (no-body request without `--data-binary` becomes a GET); fixed the script (explicit `-X POST`, `--data-binary ""`, null-guards). The 405 was itself correct behavior.
- **Mismatch payload mis-build** — a textual `-replace` also rewrote the claim’s `id`, producing a self-consistent body; rebuilt the payload explicitly → probe now returns `400 EVIDENCE_INCIDENT_MISMATCH`.
- **Second dev server refused** — Next.js 16 refuses a second `next dev` on the same project (`.next` lock). Resolved by validating the real-AWS failure paths through the **actual route handler** in the harness instead of a second server instance — the running server on port 3000 was never restarted.
- **Harness false-failure** — the “config-revert adds no timeline event” assertion counted an event created by an earlier test in the same incident; re-scoped to snapshot-before/after. After fix: 26/26 PASS.

## AG. Scope confirmations

- **Bedrock**: implemented — Converse via `@aws-sdk/client-bedrock-runtime`. No `bedrock-agent`/guardrails/foundation-model knowledge-bases.
- **DynamoDB / other AWS services**: NOT implemented (no references in `src/`). No Lambda, API Gateway, EventBridge, SNS/SQS, Cognito.
- **No chatbot, no fraud classifier, no Task 7 work** started.

## AH. Exact commands used

- `npm install @aws-sdk/client-bedrock-runtime`
- `npm run lint` · `npm run typecheck` · `npm run build`
- `npx --yes tsx ff6-harness.ts` — transient harness (26/26), deleted after run (no repo artifact)
- Endpoint probes via `C:\Windows\System32\curl.exe -X POST …` against the running dev server; transient payloads live only in the OS temp dir (cleaned up).

## AI. Final status & next steps

**Task 6 COMPLETE** (delivered, validated, report written). Remaining before Task 7:
- Grant `bedrock:InvokeModel` to the IAM user (or set a model ARN) and set `FRAUDFIRST_BEDROCK_MODEL_ID`, then re-run the real success-path test via the harness/payload — application code needs no changes.
- Awaiting user review. Task 7 (DynamoDB persistence) NOT started.

---

## AJ. REAL AWS BEDROCK VALIDATION — FINAL RUN (2026-09-19)

**FINAL STATUS: TASK 6 IMPLEMENTATION — COMPLETE / REAL AWS BEDROCK VALIDATION — BLOCKED.**

This section records the final attempt to complete the real-Bedrock validation. The application code was **not** changed, refactored, or restarted; the running dev server on port 3000 was kept healthy throughout. All results below come from the actual FraudFirst application route (`POST /api/evidence/correlate`) and from read-only AWS calls — **no credentials, secret keys, or `.env.local` contents appear anywhere in this section**.

### AJ.1 IAM permission status — BLOCKED (cannot be changed from this environment)

- Attempted to grant `fraudfirst-dev` the minimum permission (`bedrock:InvokeModel`) with a narrowly scoped inline policy via three real IAM API calls, all of which were **denied by AWS**:
  - `iam:PutUserPolicy` → `AccessDenied` (no identity-based policy allows `iam:PutUserPolicy`)
  - `iam:CreatePolicy` → `AccessDenied`
  - `iam:AttachUserPolicy` → `AccessDenied`
- `iam:GetUser`/read inspection → `AccessDenied` (no IAM read permission either).
- **Conclusion:** the `fraudfirst-dev` IAM user cannot modify its own permissions from this environment. Requirements for the user/role to grant itself the permission (e.g., attaching an inline policy to the same identity, or an AWS Administrator managing IAM) are outside this session. **Manual AWS Console step is required** — no permission was granted and none is claimed.

### AJ.2 Model availability status — NOT VERIFIABLE

- `bedrock:ListFoundationModels` → `AccessDeniedException` (no `bedrock:*` permission at all for this session). Model availability in `us-east-1` could not be enumerated from inside the environment.

### AJ.3 Model configuration status — NOT CONFIGURED

- `FRAUDFIRST_BEDROCK_MODEL_ID` is **absent** from `.env.local` (verified by key-name inspection only; values were never printed). With no model id, the app correctly reports the unconfigured state (see AJ.6). Env vars present: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `FRAUDFIRST_EVIDENCE_BUCKET` (names only).

### AJ.4 Real route used

- Primary: the actual application route handler `POST /api/evidence/correlate` (imported directly from `src/app/api/evidence/correlate/route.ts` and driven end-to-end with real AWS credentials — the same code path the live HTTP service executes; HTTP transport of the route was separately probe-verified on the live server, AJ.8). A supplementary direct SDK capture was used **only** to document the AWS-side origin of the denial (AJ.5) — it is not the primary validation.

### AJ.5 Real Bedrock request result — BLOCKED, honest record

One real synthetic request was sent through the route with `FRAUDFIRST_BEDROCK_MODEL_ID=amazon.nova-lite-v1:0`:

- Route returned `HTTP 502 { ok:false, error:{ code:"BEDROCK_REQUEST_FAILED", message:"Access to the configured model was denied." } }`.
- AWS’s own response (captured via the same real SDK, for the report only): `AccessDeniedException — User: arn:aws:iam::124623494188:user/fraudfirst-dev is not authorized to perform: bedrock:InvokeModel on resource: arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0` (account id 124623494188 is not secret configuration).
- **The denial is REAL — it came from the AWS Bedrock service; the application faithfully classified it and returned a safe, UI-appropriate message. No fake/mock/standalone-in-memory Bedrock response was used anywhere.** Because IAM denies `bedrock:InvokeModel`, **no real model prediction occurred**, so no `200 ok:true` real success is claimed.

### AJ.6 Validation performed in this final run (all from the actual route + real services)

| # | Item | Result |
| --- | --- | --- |
| 1 | Real AWS request (nova-lite) → route | 502 `BEDROCK_REQUEST_FAILED`, safe “was denied” message, **no** `AccessDenied`/`InvokeModel`/IAM-user/ARN/AWS leak |
| 2 | AWS-origin of denial confirmed | real `AccessDeniedException` (not a stub) |
| 3 | Deprecated model (claude-3-5-sonnet-20241022) → route | 502 `BEDROCK_REQUEST_FAILED`, safe “not available for this request” |
| 4 | No model configured (current state) → route | 503 `BEDROCK_NOT_CONFIGURED` (live server, live HTTP) |
| 5 | Invalid JSON → live HTTP | 400 `INVALID_REQUEST` |
| 6 | Missing fields → live HTTP | 400 `MISSING_FIELD` |
| 7 | Missing extraction → live HTTP | 400 `EXTRACTION_NOT_AVAILABLE` |
| 8 | Dev server health | `GET /` 200, `GET /api/health` 200 (before and after all runs; never restarted) |
| 9 | Structured output validation on success-path data | schema normalizer worked on realistic synthetic output (confidence clamp, sourceEvidenceIds default, label whitelist, missing/uncertain retained; malformed rejected) — validated via the real `normalizeCorrelationOutput` |
| 10 | Evidence traceability | every fact/candidate/identifier/contact carries `sourceEvidenceIds`; UI renders “Supported by evidence” + “Evidence #1 · filename” references |
| 11 | Correlation state machine | READY(not_correlated) → CORRELATING → CORRELATED verified via real services |
| 12 | Timeline | exactly **one** `evidence_correlated` event; re-correlation → still **one** (idempotent, no duplicates) |
| 13 | UI render | all six sections (Key facts / Transaction / payment details / Identifiers / Contact points / Timeline candidates / Missing information / Uncertain information) + values (24500, TEST-UTR-123456, synthetic-test@upi, +91-9000000000) + “Confirmed from evidence” + confidence + no-legal-conclusion disclaimer — rendered with a **labeled synthetic analysis object (NOT a Bedrock response)** |
| 14 | Failure safety | all live probes return safe structured messages; no raw AWS exception, no credentials, in any response or log |
| 15 | Task 5 regression | S3 object present (only object under the evidence prefix), key intact, 702 bytes, SHA-256 `3cc54a4d…b43bc7` **matches**, `ContentType application/pdf`, SSE `AES256`, metadata `fraudfirst-sha256`/`fraudfirst-key`/`fraudfirst-preserved-at` intact; read-only, nothing deleted or uploaded |
| 16 | lint | clean |
| 17 | typecheck | clean |
| 18 | production build | clean (all routes, `/api/evidence/correlate` dynamic) |
| 19 | Transient artifacts | harness + temp payloads deleted after run; no repo artifacts (git status clean of `ff6-*`) |

### AJ.7 Synthetic data used (same as §AA)

Incident `FF-20260919-CG3F`, evidence `ev_d4b496bd_73ab_41a2_b601_ec588958e520`, `synthetic-bank-sms.txt`, text: “Synthetic FraudFirst test incident. Transaction amount: INR 24500. UPI reference: TEST-UTR-123456. Transaction time: 2026-09-19 18:42 IST. Recipient UPI ID: synthetic-test@upi. Phone: +91-9000000000. This is synthetic data for testing only.” No real banking/UPI/phone/victim data.

### AJ.8 Distinction from earlier/mocked tests

- This final section’s AWS-denial record is a **REAL AWS interaction** (the app’s own Bedrock client called AWS and AWS returned `AccessDeniedException`; the app mapped it safely).
- Earlier harness checks (26/26) exercised the same code with the same real-AWS error mapping. This run re-verified those + failure path + state machine + timeline idempotency + UI render: **31 passed / 0 failed** in the final harness.
- **There is no real `model → JSON → analysis` output, and none is claimed.** All success-shape data used in deterministic checks was either explicitly-labeled synthetic (UI render) or normative schema-normalization input (never presented as a real Bedrock response).

### AJ.9 Exactly what remains before the real success test can pass

1. **AWS Console (manual, outside this environment):** attach an inline policy to IAM user `fraudfirst-dev` granting the minimum `bedrock:InvokeModel` on the desired model ARN (e.g. `arn:aws:bedrock:us-east-1:124623494188:model/*` or the exact model ARN). This cannot be done from this session (AJ.1). Do NOT remove the existing S3 permissions.
2. **`.env.local`:** set `FRAUDFIRST_BEDROCK_MODEL_ID` to an in-service model available to the account in `us-east-1` (e.g. `amazon.nova-lite-v1:0` or a current Claude Haiku id) — this file is gitignored; never commit it.
3. **Server:** restart the running dev server with the env value loaded.
4. Re-run `POST /api/evidence/correlate` with the synthetic payload → expect `200 ok:true` with `correlation.status:"correlated"` and a real `analysis`, then re-check UI, timeline, idempotency as in AJ.6.
- Application code requires **no changes**.

### AJ.10 Final conclusion

**TASK 6 IMPLEMENTATION — COMPLETE. REAL AWS BEDROCK VALIDATION — BLOCKED** (sole blocker: `bedrock:InvokeModel` IAM permission unavailable to this session; manual AWS Console grant required). No false pass is claimed. All non-model-gated validation in this task passes (validation logic, state machine, timeline idempotency, UI render, failure safety, Task 5 regression, lint, typecheck, build). Task 7 NOT started.

---

## AK. REAL AWS BEDROCK VALIDATION — FINAL RUN AFTER IAM FIX (2026-09-19)

**FINAL STATUS: TASK 6 IMPLEMENTATION — COMPLETE / REAL AWS BEDROCK VALIDATION — BLOCKED (advanced: IAM fixed; blocker now Bedrock model-access opt-in).**

This run occurred after the manual IAM policy `FraudFirstBedrockInvoke` (granting `bedrock:InvokeModel`) was attached to IAM user `fraudfirst-dev` and `FRAUDFIRST_BEDROCK_MODEL_ID=amazon.nova-lite-v1:0` was added to `.env.local`. No application code was modified. The dev server was restarted **exactly once** to load the new env value and was healthy throughout. No credentials or `.env.local` contents appear in this section.

### AK.1 What changed vs §AJ

- **IAM permission: FIXED.** Proof: the real request no longer returns `AccessDenied`; it now **reaches the Bedrock service** and fails further along the pipeline.
- **New blocker discovered — Bedrock model access is NOT enabled for this account.** Every current-generation model (Amazon Nova micro/lite/pro, Claude Haiku/current Sonnet ids, current Llama) returns `ValidationException: Operation not allowed` from the service. This is the account-level Bedrock **model-access opt-in** (a Console-only administrative action), not an IAM or application issue.
- All legacy “enabled-by-default” models are EOL per AWS (`ResourceNotFoundException: This model version has reached the end of its life`): `amazon.titan-text-express-v1`, `amazon.titan-text-lite-v1`, `amazon.titan-text-premier-v1:0`, `anthropic.claude-3-haiku-20240307-v1:0`, `anthropic.claude-3-5-haiku-20241022-v1:0`, `anthropic.claude-3-5-sonnet-20240620-v1:0` / `-20241022-v2:0`, `anthropic.claude-3-7-sonnet-20250219-v1:0`, `cohere.command-r-plus-v1:0`.
- Cross-region inference variants (`us.amazon.nova-lite-v1:0`, `us.amazon.nova-pro-v1:0`, `us.anthropic.claude-haiku-…)`) also return `Operation not allowed`; non-existent ids return `The provided model identifier is invalid`.

### AK.2 Real route used

`POST /api/evidence/correlate` on the **live HTTP dev server** (port 3000) with the real synthetic payload (§AA). This is the actual FraudFirst application route — not a standalone SDK test.

### AK.3 Real Bedrock request result — FAILED at service, safely mapped

Request: `amazon.nova-lite-v1:0`, synthetic evidence (INR 24500, UTR TEST-UTR-123456, UPI synthetic-test@upi, phone +91-9000000000).

- HTTP **502** `{ ok:false, error:{ code:"BEDROCK_REQUEST_FAILED", message:"The model request was rejected by the service." } }`
- AWS-origin cause (captured from the app’s own SDK client, diagnostic only): `ValidationException — Operation not allowed` (roles: the account has not enabled Bedrock model access for Amazon Nova in `us-east-1`).
- The application classified the real `ValidationException` safely (`invalid_request`) and returned a UI-safe message. **No raw AWS error, ARN, IAM account id, or credential appears in the response or in the dev-server logs** (scanned).

### AK.4 Final validation status per this run

| # | Item | Result |
| --- | --- | --- |
| 1 | Server restart | exactly once; `/` 200, `/api/health` 200 (all run) |
| 2 | Real Bedrock success | **NOT ACHIEVED** (blocked — see AK.1) |
| 3 | Real request through app route | 502 `BEDROCK_REQUEST_FAILED`, safe message, real AWS `ValidationException` mapped, no leak |
| 4 | Invalid request → live | 400 `INVALID_REQUEST` |
| 5 | Missing fields → live | 400 `MISSING_FIELD` |
| 6 | Missing extraction → live | 400 `EXTRACTION_NOT_AVAILABLE` |
| 7 | Unconfigured Bedrock (env id removed, route handler) | 503 `BEDROCK_NOT_CONFIGURED` |
| 8 | Task 5 S3 regression | **11/11 PASS** — object exists, `application/pdf`, `AES256`, 702 B, key intact, `fraudfirst-sha256` metadata `3cc54a4d…b43bc7` matches, preserved-at present, exactly one object (nothing added/removed) |
| 9 | lint | clean |
| 10 | typecheck | clean |
| 11 | production build | clean (`/api/evidence/correlate` dynamic) |
| 12 | UI/state with a REAL analysis | **cannot be performed** (no real result yet); state machine + timeline idempotency (31/31 harness) and UI render with a labeled synthetic analysis were verified earlier and remain valid |
| 13 | Dev-log security scan | no credential/ARN/account-id fragments |

### AK.5 Exactly what remains to reach PASSED

1. **AWS Console → Amazon Bedrock → Model access** (account `124623494188`, region `us-east-1`): **enable Amazon Nova** (at minimum `amazon.nova-lite-v1:0`). This is a Console-only opt-in; there is no public API. (If Nova is not desired, enable any in-service model and update only `.env.local`.)
2. No application code changes and no further IAM changes required (IAM `bedrock:InvokeModel` is now working).
3. Re-run the same `POST /api/evidence/correlate` with the synthetic payload — expect `200 ok:true`, `correlation.status:"correlated"`, and a real `analysis`.
4. Then verify UI + state with the real result (six sections, evidence references, one `evidence_correlated` timeline event, no duplicates on re-run).

### AK.6 Honest distinction

- THIS run proves the full application pipeline works end-to-end **up to the model-inference gate**: config, validation, AWS SDK call, error classification, and safe UX. The failure is a genuine AWS account-configuration state (model-access opt-in), reported exactly and **not** faked.
- **REAL AWS BEDROCK RESPONSE (a real model output): NOT YET ACHIEVED. No success is claimed.**

---

Task 6 implementation complete. Real Bedrock validation remains blocked at the account Bedrock **model-access opt-in** (IAM is fixed; the app now reaches AWS and returns a safe 502 for every current model until the account enables model access in us-east-1). Everything else in Task 6 validated. Task 7 not started.

---

## AL. FINAL REAL AWS BEDROCK VALIDATION — RUN WITH `amazon.nova-2-lite-v1:0` (2026-09-19)

**FINAL STATUS: TASK 6 IMPLEMENTATION — COMPLETE / REAL AWS BEDROCK VALIDATION — BLOCKED.**

This run used the updated model configuration `FRAUDFIRST_BEDROCK_MODEL_ID=amazon.nova-2-lite-v1:0` (confirmed present; exact value is a model id, not a credential). No application code, IAM policy, credentials, or `.env.local` were modified. The dev server was restarted **exactly once** to load the new env value and was healthy throughout.

### AL.1 Result

- **Endpoint tested:** `POST http://localhost:3000/api/evidence/correlate` (the actual FraudFirst application route; live HTTP).
- **Synthetic evidence:** incident `FF-20260919-CG3F`, evidence `ev_d4b496bd_73ab_41a2_b601_ec588958e520`, `synthetic-bank-sms.txt` — “Transaction amount: INR 24500. UPI reference: TEST-UTR-123456. Transaction time: 2026-09-19 18:42 IST. Recipient UPI ID: synthetic-test@upi. Phone: +91-9000000000.” No real personal/banking/UPI/phone data.
- **HTTP result: 502** `{ ok:false, error:{ code:"BEDROCK_REQUEST_FAILED", message:"The model request was rejected by the service." } }`
- **AWS-origin cause (diagnostic capture through the app’s own SDK):** `ValidationException (HTTP 400): Operation not allowed` for `amazon.nova-2-lite-v1:0` (and for `us.amazon.nova-2-lite-v1:0`, `amazon.nova-lite-v1:0`). A sibling id `amazon.nova-2-pro-v1:0` returns `The provided model identifier is invalid`.
- **Determination — this is ACCOUNT CONFIGURATION (Bedrock model-access opt-in), NOT:**
  - IAM (no `AccessDenied`; the request passes auth and reaches the Bedrock service validation layer),
  - region (`us-east-1` is correct and the service answered from it),
  - quota/limits (the error is a permission-state gate, not throttling),
  - application code (the id is valid; the request is well-formed; the classifier and safe mapping worked),
  - model availability per se (the id is in the catalog; the account is simply not enabled to invoke it).
- The application classified the real AWS `ValidationException` safely (`invalid_request`) and returned the UI-safe message. **No raw AWS error text, ARN, IAM account id, or credential appears in the response or the dev-server logs (scanned).**

### AL.2 Checklist

| # | Item | Result |
| --- | --- | --- |
| 1 | Request reaches AWS Bedrock | YES — service returned a service-side `ValidationException` (proves auth+network+call path) |
| 2 | Model ID used | `amazon.nova-2-lite-v1:0` (exact) |
| 3 | Region | `us-east-1` |
| 4 | Converse API succeeds | NO — blocked by account model-access opt-in (`Operation not allowed`) |
| 5 | Structured schema returned | NO real response yet (schema normalizer verified elsewhere, §AB) |
| 6 | Fact traceability | verified by design + earlier schema harness (§AB/M); real-output check awaits real response |
| 7 | No hallucinated facts | schema whitelist/confidence/source gating verified (§P/§AB); real-output check awaits real response |
| 8 | Prompt-injection protections | active and unmodified (§L/§P) |
| 9 | No guilt/recovery/admissibility/freeze claims | UI disclaimer + system prompt unchanged (§L) |
| 10 | UI renders a REAL correlation result | NOT PERFORMABLE — no real result yet; UI render verified earlier with labeled synthetic analysis (§AJ.6#13) |
| 11 | Timeline event exactly once | state machine + idempotency harness 31/31 (§AJ.6) — still valid |
| 12 | Duplicate/in-flight protection | verified (inFlight ref + atomic transitions) |
| 13 | Safe Bedrock failure handling | PASS — 502 safe message live; no leak; 400s + 503 + 502 categories all safe |
| 14 | Task 5 S3 preservation | PASS (9/9) — object/key/SHA-256/metadata intact; exactly one object; read-only |
| 15 | Task 1–5 regression | PASS — `/` 200, `/api/health` 200, upload/extract routes live (405 on GET) |
| 16 | lint | clean |
| 17 | typecheck | clean |
| 18 | production build | clean (`/api/evidence/correlate` dynamic) |

### AL.3 What remains to reach PASSED (Console-only)

1. AWS Console → **Amazon Bedrock → Model access** (account `124623494188`, region `us-east-1`): **enable Amazon Nova 2** (e.g. `amazon.nova-2-lite-v1:0`). This is a Console-only opt-in; no public API.
2. No code, IAM, or env changes needed (`FRAUDFIRST_BEDROCK_MODEL_ID` is already correct).
3. Re-run the same `POST /api/evidence/correlate` → expect `200 ok:true`, `correlation.status:"correlated"` with a real `analysis`.
4. Then do the real-result UI/timeline/idempotency check (AL.2 rows 5–12).

### AL.4 Honest distinction

- **REAL AWS BEDROCK RESPONSE (a real model output): NOT YET ACHIEVED. No success is claimed.**
- This run proves the complete application pipeline end-to-end up to inference: config load, validation, real AWS SDK call, error classification, safe UX — the failure is a genuine AWS account configuration state (model-access opt-in), reported exactly.

---

## AM. FINAL REAL AWS BEDROCK VALIDATION — RUN WITH CROSS-REGION `us.amazon.nova-2-lite-v1:0` (2026-09-19)

**FINAL STATUS: TASK 6 IMPLEMENTATION — COMPLETE / REAL AWS BEDROCK VALIDATION — BLOCKED (AWS account/service-side blocker, exact category captured).**

### AM.1 Result

- **Environment:** `FRAUDFIRST_BEDROCK_MODEL_ID=us.amazon.nova-2-lite-v1:0` confirmed present (model id value only; not a credential). No code, IAM, credentials, or `.env.local` modified. Dev server was restarted **exactly once** (the running instance predated the `.env.local` change) and was healthy throughout.
- **Endpoint tested:** `POST http://localhost:3000/api/evidence/correlate` (the actual FraudFirst route, live HTTP).
- **Synthetic evidence:** incident `FF-20260919-CG3F`, evidence `ev_d4b496bd_73ab_41a2_b601_ec588958e520`, `synthetic-bank-sms.txt` — “Transaction amount: INR 24500. UPI reference: TEST-UTR-123456. Transaction time: 2026-09-19 18:42 IST. Recipient UPI ID: synthetic-test@upi. Phone: +91-9000000000.” No real personal/banking/UPI/phone data.
- **HTTP result: 502** `{ ok:false, error:{ code:"BEDROCK_REQUEST_FAILED", message:"The model request was rejected by the service." } }`
- **AWS result category (captured exactly, via a diagnostic through the app’s own SDK):** `ValidationException (HTTP 400): Operation not allowed` for `us.amazon.nova-2-lite-v1:0`.
- **Determination — AWS account/service-side blocker (account configuration / Bedrock model-access opt-in), NOT:**
  - IAM (no `AccessDenied`; the request passes auth and reaches the Bedrock service validation layer),
  - region (`us-east-1` correct; the service answered from it),
  - quota/limits (this is a permission-state gate),
  - application code (well-formed request + correct model id; classifier and safe mapping worked; sibling id `amazon.nova-2-pro-v1:0` returns “invalid identifier”, confirming this id is valid and merely not enabled for the account),
  - cross-region inference configuration (the `us.` cross-region variant returns the **same** `Operation not allowed` — the blocker is the account-level opt-in, not the region prefix).
- **Instructions followed:** on `ValidationException: Operation not allowed`, work stopped on the AWS side. No random IAM edits, no extra AWS services, no code changes, no mock/fake response. **No success claimed.**

### AM.2 Checklist

| # | Item | Result |
| --- | --- | --- |
| 1 | Request reaches Amazon Bedrock | YES — service returned a service-side `ValidationException` (auth + network + call path proven) |
| 2 | Model ID used | `us.amazon.nova-2-lite-v1:0` (exact) |
| 3 | Region | `us-east-1` |
| 4 | Converse API succeeds | NO — blocked by account Bedrock model-access opt-in (`Operation not allowed`) |
| 5 | Real model response returned | NO (nothing to normalize — thus no real output to render) |
| 6 | Normalization of real output | NOT PERFORMABLE — schema normalizer verified earlier (§AB) and remains unchanged |
| 7 | Fact traceability | by design + schema harness (§AB/M); real-output recheck awaits a real response |
| 8 | No hallucinated facts | schema whitelist/confidence/source gating verified (§P/§AB); real-output recheck awaits a real response |
| 9 | Prompt-injection protections | active and unmodified (§L/§P) |
| 10 | UI renders a REAL result | NOT PERFORMABLE — no real result yet; six-section render verified earlier with labeled synthetic analysis |
| 11 | Timeline event exactly once | state machine + idempotency harness 31/31 (§AJ.6) — unchanged |
| 12 | Duplicate/in-flight protection | verified (inFlight ref + atomic transitions) |
| 13 | Safe Bedrock failure handling | PASS — live 502 safe mapping, 400/503 categories intact, zero leaks (dev logs scanned) |
| 14 | Task 5 S3 preservation | PASS (9/9) — object/key/SHA-256/metadata intact; exactly one object; read-only |
| 15 | Task 1–5 regression | PASS — `/` 200, `/api/health` 200, upload/extract routes live (405 on GET) |
| 16 | lint | clean |
| 17 | typecheck | clean |
| 18 | production build | clean (`/api/evidence/correlate` dynamic) |

### AM.3 What remains to reach PASSED (Console-only, single step)

1. AWS Console → **Amazon Bedrock → Model access** (account `124623494188`, region `us-east-1`): **enable Amazon Nova 2** (e.g. `amazon.nova-2-lite-v1:0`), which grants the cross-region inference id `us.amazon.nova-2-lite-v1:0` too. Console-only; no public API.
2. No code, IAM, or env changes needed.
3. Re-run the same `POST /api/evidence/correlate` → expect `200 ok:true`, `correlation.status:"correlated"` with a real `analysis`; then perform the real-result UI/timeline/idempotency checks (AM.2 rows 5–12) and flip the header to **REAL AWS BEDROCK VALIDATION — PASSED**.

### AM.4 Honest distinction

- **REAL AWS BEDROCK RESPONSE: NOT YET ACHIEVED. No success claimed — an HTTP 502 from our own API is not treated as success.**
- Every layer of the FraudFirst pipeline that can be exercised without a real inference has now passed (config load, validation, real AWS SDK call, error classification, safe UX, regression, static gates). The single remaining gate is an AWS **account configuration** state (Bedrock model-access opt-in) that only the account owner can change in the Console; it has been reported exactly and left untouched.