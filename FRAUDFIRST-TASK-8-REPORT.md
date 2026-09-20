# FRAUDFIRST — TASK 8 REPORT

Time-aware fraud response orchestration with AWS Step Functions (Standard Workflows): a durable, ordered response plan (INCIDENT_STARTED → PRESERVE_EVIDENCE → CONTACT_BANK → CALL_1930 → REPORT_ONLINE → FOLLOW_UP → RESPONSE_COMPLETE) whose states advance ONLY when the user explicitly marks each external action complete.

Status: **TASK 8 IMPLEMENTATION — COMPLETE** · **OFFLINE + DYNAMODB DURABILITY VALIDATION — PASSED** · **REAL STEP FUNCTIONS VALIDATION — BLOCKED (IAM, reported honestly; NOT faked)** — The orchestration layer, the five-action transition model, the live API lifecycle, and the DynamoDB-durable response metadata were all implemented and validated against the running server and the real `fraudfirst-incidents` table (a locally-seeded plan, explicitly without a real execution — see §P). A real Step Functions execution could NOT be started because the scoped IAM user `fraudfirst-dev` is denied `states:ListStateMachines` (exact message in §Q). Per instructions, no IAM was broadened, no state machine/Lambda was created by this agent, and no claim of a real AWS execution is made. The workflow requires the state machine to be provisioned and `FRAUDFIRST_STEP_FUNCTIONS_STATE_MACHINE_ARN` to be set; until then `POST …/response/start` correctly returns `STEP_FUNCTIONS_NOT_CONFIGURED` (503).

> **Retained blocker (unchanged by Task 8):** Real Bedrock validation remains blocked by the AWS account/service-side `ValidationException: Operation not allowed` for Nova 2 Lite in us-east-1. Task 8 does not modify or claim to resolve this blocker.

---

## A. Task 8 status

**COMPLETE / IMPLEMENTED.** Everything below is type-checked, lint-clean, production-build-clean, and validated by:
1. an offline orchestration regression (34/34) rerun twice through the actual pure transition libs,
2. live endpoint probes against the running dev server (`http://localhost:3000`) covering every guardrail and the full five-step human-completion lifecycle,
3. a **DynamoDB durability validation** (real table, real response-service code, realistically seeded plan, live completion, server-authoritative preservation, exactly-once timeline events, cleanup of the synthetic incident),
4. an **honest real-AWS Step Functions attempt** that was denied by IAM (`states:ListStateMachines` → `AccessDeniedException`, exact message recorded in §Q) — validation stopped there, nothing fabricated,
5. full Task 1–7 regression (S3 round-trip + cleanup, Bedrock safe-block reconfirmed, pages, persistence, client-bundle leak scan).

## B. Objective recap

- Durable, time-aware guided response plan for a fraud incident, aligned to the Step Functions Standard Workflow path: `INCIDENT_STARTED → PRESERVE_EVIDENCE → CONTACT_BANK → CALL_1930 → REPORT_ONLINE → FOLLOW_UP → RESPONSE_COMPLETE`.
- Explicit human completion only — the workflow and the app **never** auto-complete an external action (bank contact, 1930 call, online report, freeze, recovery). The app issues `SendTaskSuccess` only after the user presses **Mark complete**.
- Response metadata is stored in the app's single DynamoDB table (`fraudfirst-incidents`, plain `IncidentWorkspaceRecord.response`), surviving refresh/devices; Step Functions is the durable external orchestrator, not a box of raw data.
- Step Functions input carries **only safe metadata** `{incidentId, startedAt, currentAction, amount, currency:"INR"}` — no raw evidence, no OCR text, no credentials, no gratuitous PII.
- No EventBridge/SQS/SNS/Cognito and no Task-9 machinery were introduced.
- Bedrock/S3/Textract left untouched; Bedrock blocker retained verbatim.
- Honest AWS validation: report the exact missing permission and stop; never claim a real SFN execution that did not run.

## C. Architecture overview

```
Browser (RESPONSE PLAN panel in the incident workspace)
  │  client responseService.getResponse / startResponse / completeAction (HTTP only, no AWS SDK)
  ▼
src/hooks/use-response-plan.ts
  │  GET …/response, POST …/response/start, POST …/response/actions/:actionId/complete
  ▼
src/app/api/incidents/[id]/response/**            (Next.js 16 dynamic routes, force-dynamic)
  │  id/action validation + gateway error mapping (sanitized)
  ▼
src/services/response/server.ts    ── orchestration service ──
  │  startIncidentResponse / getIncidentResponse / completeIncidentResponseAction
  │   read-modify-write the response meta, conditional Put (optimistic concurrency, one retry)
  │   append deterministic timeline events (exactly-one), advance Step Functions best-effort
  ├── src/services/response/sequence.ts            (the 5-action definition)
  ├── src/services/response/orchestrator.ts        (pure transitions + guardrails, offline-tested)
  ▼
src/services/server/dynamodb.ts     ── single table ──
  │  incident record (status/…/response)  +  sf-token-<incidentId> task-token items
  ▼
DynamoDB fraudfirst-incidents
```

- On `start`: build the 5-action plan, persist `response` (status `running`, `currentActionType=preserve_evidence`), append `response_started` event, and call `StartExecution` with the safe metadata payload. If the state machine isn't configured, middleware returns `STEP_FUNCTIONS_NOT_CONFIGURED` (no record is written, no execution attempted) — verified live.
- On `complete` for the current action: advance the plan in memory, conditional-write (retry once on conflict), append a deterministic `response_action_completed` event, then **best-effort** advance of the real execution (`sendTaskSuccess` with the stored task token if present, clearing the token; else `describe` the execution). The DynamoDB record is the authoritative gating layer; SFN progress is never allowed to block or gate the user's durable record.
- On completing the fifth action: `response.status=completed`, `currentActionType` cleared, `response_completed` event appended.

## D. Response action model (sequence.ts / orchestrator.ts)

Five actions, ordered, typed, each a **human** step:

| Order | type | Title | Priority | What the user does |
|---|---|---|---|---|
| 1 | `preserve_evidence` | Preserve evidence | critical | Keep the exact messages, screenshots and transaction details safe before anything changes |
| 2 | `contact_bank` | Contact the bank or payment provider | high | Ask about freezing/flagging the account via the provider's official channel |
| 3 | `call_1930` | Call 1930 | critical | Report to the national cybercrime helpline; note any complaint reference |
| 4 | `report_online` | Report online | normal | File a report through the official online cybercrime channel |
| 5 | `follow_up` | Follow up | normal | Keep monitoring the case and account until the response is complete |

- `ResponseActionStatus ∈ pending | completed`; workflow `ResponseWorkflowStatus ∈ running | completed`.
- Pure transition (`completeResponseAction`, orchestrator.ts) enforces: unknown action → `ACTION_NOT_FOUND`; not-current action → `ACTION_NOT_CURRENT`; already-completed action → `ACTION_ALREADY_COMPLETED`; plan already complete → `INVALID_REQUEST`. Only the **current** action completes; the pointer advances in order; the fifth completion flips the workflow to `completed`.
- Deterministic action ids: `resp_<type>` (e.g. `resp_call_1930`).

## E. State machine + bridge Lambda (deployable artifacts, NOT bundled)

`aws/response-workflow/state-machine.json` (ASL, Standard Workflow):

- `INCIDENT_STARTED` (Pass) → five `Task` states using `arn:aws:states:::lambda:invoke.waitForTaskToken` → `RESPONSE_COMPLETE` (Pass, End). A `FAILED` (Fail) state exists as a terminal error boundary; it is unreachable by a pending human action.
- Each task state sends `{incidentId, actionType, TaskToken}` to Lambda `FraudFirstResponseBridge`, `ResultPath: null`, `TimeoutSeconds: 1209600` (14 days).
- The machine never polls, never schedules, never calls external services; it only blocks on the human completion token. No EventBridge/SQS/SNS/Cognito.

`aws/response-workflow/lambda/bridge.mjs` (Node 22, one `PutCommand`):

- Writes a scoped token item `incidentId = "sf-token-<incidentId>"` carrying `executionArn`, `actionType`, `taskToken`, `expiresAt` (now + 1209600) into the SAME table (`FRAUDFIRST_DYNAMODB_TABLE`) used by the app.
- Contains no secrets, reads no evidence, is not part of the Next.js runtime.

## F. DynamoDB changes (single table `fraudfirst-incidents`)

- New optional field `IncidentWorkspaceRecord.response` (`IncidentResponseMeta`): `status`, `startedAt`, `updatedAt`, `currentActionType`, `actions[]` (5), optional `executionArn`. Metadata only.
- New item family `sf-token-<incidentId>` storing the waitForTaskToken task token (a callback credential) scoped to one incident, with `expiresAt`.
- **Server-authoritative response**: `saveIncident` re-reads the existing item and always re-attaches `existing.response`, ignoring any client-supplied value. Verified live: a client `PUT` with no `response` leaves the durable response plan untouched.
- **Timeline preservation fix**: `saveIncident` now also merges pre-existing server-side timeline events (dedupe by `id` or `(type, detail, occurredAt)`, matching `appendTimelineEvent`) so a client push can never wipe the server-authored `response_*` story. Verified live (see §P.5).
- Response timeline events use **deterministic ids** (`tl_<incidentId>_response_start`, `tl_<incidentId>_action_<type>`, `tl_<incidentId>_response_complete`), guaranteeing exactly-one event per transition even across retries.

## G. Environment configuration

- `.env.local`: added `FRAUDFIRST_STEP_FUNCTIONS_STATE_MACHINE_ARN=` — deliberately **empty** so the environment reports `STEP_FUNCTIONS_NOT_CONFIGURED` honestly until a machine is provisioned.
- `.env.example`: new Step Functions section (variable format, ARN example, standard credential chain note, no `NEXT_PUBLIC_*`).
- `next.config.ts`: `@aws-sdk/client-sfn` added to `serverExternalPackages`; dependency installed as `@aws-sdk/client-sfn@^3.1136.0`.

## H. Files changed (Task 8)

- `src/types/response.ts` — `ResponseActionType`, `ResponseActionStatus`, `ResponseWorkflowStatus`, `ResponseActionPriority`, `ResponseAction`, `PersistentResponseAction`, `IncidentResponseMeta`, `IncidentResponseView` (incl. per-action `guidance` for the UI), `ResponseErrorCode`/`ResponseError`, Start/Get/Complete DTOs
- `src/types/index.ts` — exports the response types
- `src/types/timeline.ts` — new event types `response_started`, `response_action_completed`, `response_completed`, `response_failed`
- `src/types/persistence.ts` — `response?: IncidentResponseMeta` on the workspace record
- `src/services/response/sequence.ts` — the five-action definitions + order
- `src/services/response/orchestrator.ts` — pure `buildResponsePlan`, `compactResponseActions`, `completeResponseAction`, `responseProgress`, `responseActionId`
- `src/services/response/server.ts` — `ResponseServiceError`, `startIncidentResponse`, `getIncidentResponse`, `completeIncidentResponseAction`, `writeWithRetry` (one conflict retry), `buildResponseView`, `advanceStepFunctionsBestEffort`, deterministic server-side timeline appends
- `src/services/response/index.ts` — client `responseService` (no AWS SDK); re-exported from `src/services/index.ts`
- `src/services/server/step-functions.ts` — lazy `SFNClient`, `configuredStateMachineArn` (regex-validated ARN, empty→null), `hasStepFunctionsConfiguration`, `startResponseExecution`, `describeResponseExecution`, `sendTaskSuccess`, `listAccessibleStateMachines`, sanitized error mapping (`AccessDeniedException`/`StateMachineDoesNotExist`/`ExecutionAlreadyExists`/`ValidationException`/`ThrottlingException` → fixed safe sentences)
- `src/services/server/dynamodb.ts` — `readResponseTaskToken` / `clearResponseTaskToken` for `sf-token-<incidentId>` items
- `src/services/incident-persistence.ts` — response canonicalization (whitelisted statuses/action types, 5-action ordering, dedupe), response wired into `canonicalizeWorkspaceRecord` as server-authoritative, new timeline types, `saveIncident` response + timeline preservation (§F)
- `src/app/api/incidents/[id]/response/start/route.ts` — POST
- `src/app/api/incidents/[id]/response/route.ts` — GET
- `src/app/api/incidents/[id]/response/actions/[actionId]/complete/route.ts` — POST
- `src/hooks/use-response-plan.ts` — load/start/complete/reload hook
- `src/components/incident/response-plan.tsx` — RESPONSE PLAN panel (status pill, clock since incident started, progress bar, grouped "What happened / What to do now / What comes next", dominant current action with **Mark complete**, honest un-started + not-configured states, completion banner, non-overclaim wording)
- `src/components/incident/incident-workspace.tsx` — RESPONSE PLAN panel is the first panel of the left column
- `next.config.ts`, `package.json`, `package-lock.json`, `.env.local`, `.env.example`
- `aws/response-workflow/state-machine.json`, `aws/response-workflow/lambda/bridge.mjs`

## I. Service layer notes

- **Lazy client + honest config**: `hasStepFunctionsConfiguration()` requires a valid ARN env var AND region AND (static creds or profile). Empty ARN → `STEP_FUNCTIONS_NOT_CONFIGURED` (verified live).
- **Conflict safety**: completions do a read-modify-write with one retry on `DynamoDbConflictError`; the state machine advance is strictly best-effort (token present → `sendTaskSuccess` then clear token; else `describe`). The DDB record always decides.
- **Dedupe**: deterministic event ids make every response lifecycle event exactly-once regardless of client retries; combined `(type,detail,occurredAt)` fallback guards older event shapes.
- No AWS SDK imports reach the client (`responseService` is plain fetch-based); the harness ships zero SDK code to the browser (verified §R).

## J. API layer

`GET /api/incidents/[id]/response`, `POST /api/incidents/[id]/response/start`, `POST /api/incidents/[id]/response/actions/[actionId]/complete`. Error mapping:

| Condition | HTTP | `error.code` |
|---|---|---|
| Invalid `[id]` / actionId | 400 | `INVALID_INCIDENT` / `INVALID_REQUEST` |
| No incident | 404 | `INCIDENT_NOT_FOUND` |
| No plan started | 404 | `RESPONSE_NOT_FOUND` |
| Unknown action | 404 | `ACTION_NOT_FOUND` |
| Already started | 409 | `RESPONSE_ALREADY_STARTED` |
| Completing a non-current action | 409 | `ACTION_NOT_CURRENT` |
| Completing an already-completed action | 409 | `ACTION_ALREADY_COMPLETED` |
| Plan already complete | 400 | `INVALID_REQUEST` |
| SFN not configured | 503 | `STEP_FUNCTIONS_NOT_CONFIGURED` |
| DDB not configured | 503 | `DYNAMODB_NOT_CONFIGURED` |
| Any SFN/DDB request failure | 502 | `STEP_FUNCTIONS_REQUEST_FAILED` / `DYNAMODB_REQUEST_FAILED` |

All AWS failures are sanitized to fixed sentences; raw AWS/ARN/credential text never reaches the client.

## K. UI layer (RESPONSE PLAN panel)

- **Not started**: honest copy + **Start response plan** button (POST start).
- **Running**: five actions grouped into What happened / What to do now / What comes next; the single current action is emphasized with **Mark complete**; clock shows time since the incident started; progress bar `completed/5`.
- **Completed**: banner ("You have completed the guided response plan") and a summary action list.
- No overclaiming: the panel says the app *supports you through* the steps and does not claim the bank/1930/online report were actually done — only that the user marked them complete.
- With SFN unconfigured, starting returns `STEP_FUNCTIONS_NOT_CONFIGURED` and the panel surfaces the honest message.

## L. Validation — offline orchestration regression (34/34 PASS, rerun)

Transient `tsx` script (deleted after the run) against the real pure libs: sequence order; `isResponseActionType`; `responseActionId` prefix/format; `buildResponsePlan` (5 actions, all pending, current=pick_… preserve_evidence, running); safe input shape (`{incidentId, startedAt, currentAction, amount, currency:"INR"}`, no evidence/text/credentials); `completeResponseAction` happy path; dedupe; `ACTION_ALREADY_COMPLETED`; `ACTION_NOT_FOUND`; `ACTION_NOT_CURRENT`; **progress accounting** (2-of-5 → `call_1930` current); `response_status=completed` on the 5th; canonicalization of response/actions; `compactResponseActions`.

## M. Validation — live endpoint probes (running dev server, :3000)

With the synthetic incident `FF-20260919-TEST` live (real table):

```
GET  /api/incidents/FF-20260919-TEST/response                    404 {"ok":false,"error":{"code":"RESPONSE_NOT_FOUND",…}}   [honest: incident exists, no plan yet]
POST /api/incidents/FF-20260919-TEST/response/start              503 {"code":"STEP_FUNCTIONS_NOT_CONFIGURED",…}   [ARN env unset → never fakes a start]
POST …/response/actions/bad/complete                             400 {"code":"INVALID_REQUEST",…}
GET  /api/incidents/FF-20260919-TEST                            200 full record
GET  /incident/FF-20260919-TEST (page)                          200
```

- `start` is gated on `hasStepFunctionsConfiguration()` — with the empty ARN it returns 503 before any AWS call; this is the correct, honest behavior until a machine exists.
- No raw AWS text in any of these responses.

## N. Validation — DynamoDB durability layer (PASSED, honest about scope)

A realistic plan was seeded through the app's real services (`buildResponsePlan` → `canonicalizeWorkspaceRecord` → `writeIncidentRecord` → `appendTimelineEvent`) — **deliberately with no `executionArn`**, so no Step Functions call could ever occur; this validates the durable metadata/transition layer only. Then every completion went through the **live HTTP API**.

| # | Check | Result |
|---|---|---|
| 1 | Response persisted to real DynamoDB | `response.status=running`, `currentActionType=preserve_evidence`, 5 actions all `pending`, no `executionArn`; re-read raw from table | PASS |
| 2 | `response_started` timeline event = exactly 1 | appended via real `appendTimelineEvent` | PASS |
| 3 | Timeline idempotency | same deterministic event id appended again → length unchanged | PASS |
| 4 | Out-of-order completion blocked | `POST …/resp_contact_bank/complete` before preserve_evidence → **409 ACTION_NOT_CURRENT** | PASS |
| 5 | Full lifecycle via live API | preserve_evidence → contact_bank → call_1930 → report_online → follow_up, each 200, pointer advancing (contact_bank → call_1930 → report_online → follow_up → null) | PASS |
| 6 | Workflow completes | `status=completed`, 5/5 completed | PASS |
| 7 | Duplicate completion rejected | `resp_follow_up` again → **400 INVALID_REQUEST "The response plan is already complete."** | PASS |
| 8 | Timeline exactly-once end-to-end | 7 events total: 1× response_started, 5× response_action_completed, 1× response_completed — no duplicates | PASS |
| 9 | Server-authoritative response | client `PUT` with a stale/empty `response` → durable response plan unchanged (status completed, 5 actions) | PASS |
| 10 | Timeline survives client pushes | client `PUT` with empty `timeline` → both `response_started` + `response_action_completed` still present (§F fix) | PASS |
| 11 | Refresh/reconciliation | every `GET …/response` re-reads the durable record (source of the plan state); guarded completion reads DDB fresh | PASS |
| 12 | Cleanup | synthetic `FF-20260919-TEST` deleted; live `GET` → 404 `INCIDENT_NOT_FOUND` | PASS |

## P. Validation — REAL Step Functions execution: NOT PERFORMED (honest)

- `POST …/start` correctly refuses with `STEP_FUNCTIONS_NOT_CONFIGURED` because `FRAUDFIRST_STEP_FUNCTIONS_STATE_MACHINE_ARN` is empty (no machine provisioned). No `StartExecution` was made against real AWS for Task 8.
- A read-only probe (`ListStateMachines`, the minimal read) returned the exact denial below. Per instructions, IAM was **not** broadened and no machine/Lambda/role was created by this agent.
- Requirements #2 ("verify a real Step Functions execution starts…") and #4 ("verify the execution state reflects the completion…") therefore remain **blocked on AWS IAM/infra** until the account provisions the machine + role + bridge Lambda and grants the app role the states permissions. This is reported, not papered over.

## Q. Exact IAM denial recorded (real AWS, read-only probe)

```
name=AccessDeniedException httpStatusCode=400
message=User: arn:aws:iam::124623494188:user/fraudfirst-dev is not authorized to perform:
        states:ListStateMachines on resource: arn:aws:states:us-east-1:124623494188:stateMachine:*
        because no identity-based policy allows the states:ListStateMachines action
```

The scoped user currently has **no `states:*` permissions** (verified by the probe). To actually run Task 8's real AWS validation, the account would need: a Standard Workflow matching the shipped ASL, the `FraudFirstResponseBridge` Lambda + its token PutItem role, and for the app role `states:ListStateMachines` / `states:StartExecution` / `states:DescribeExecution` / `states:SendTaskSuccess` (scoped to that machine's ARN). Task 8 deliberately does not broaden IAM.

## R. Bedrock / S3 regression

- Bedrock: re-probed real AWS `Converse` (`us.amazon.nova-lite-v1:0`) → `ValidationException` http 400, message begins "Operation not allowed" — **still service-side blocked**, exactly as reported since Task 4. Task 8 does not modify or claim to resolve it. The correlate endpoint still surfaces the sanitized 502 path.
- S3: synthetic PDF preserved to the evidence bucket (`incidents/FF-20260919-TEST/evidence/ff8-regression/original`) through the app's real `preserveEvidenceToS3`, byte/sha verified via `GetObject`, then deleted (`GetObject` → gone). **No residue left.** Task 5 preservation untouched.

## S. lint / typecheck / build / client-bundle scan

- `npm run lint` — **0 errors, 0 warnings**.
- `npm run typecheck` (`tsc --noEmit`) — **clean**.
- `npm run build` (`next build`, Next.js 16.3.5 / Turbopack) — **success**, all task routes present: `/`, `/_not-found`, `/api/evidence/{correlate,extract,upload}`, `/api/health`, `/api/incidents/[id]`, `/api/incidents/[id]/response`, `/api/incidents/[id]/response/start`, `/api/incidents/[id]/response/actions/[actionId]/complete`, `/incident/[id]` (ƒ dynamic).
- Client-bundle leak scan on `.next/static` (fresh build): **no** `SFNClient`, `SendTaskSuccess`, `StartExecution`, `client-sfn`, `AWS_ACCESS_KEY_ID`, `SecretAccessKey`, or `AKIA…` credential strings. Step Functions/DynamoDB SDK code appears only in `.next/server` chunks (server-only).

## T. Task 1–7 regression

| Area | Result |
|---|---|
| Landing `/`, `/api/health`, `/incident/<id>` | 200 / 200 / 200 |
| Incident persistence (real DynamoDB) | PUT→200, GET→200, delete→404 `INCIDENT_NOT_FOUND`, updatedAt progression, optimistic concurrency — unchanged |
| Evidence extract no-file guard | 400 `INVALID_REQUEST` |
| Bedrock correlate | still sanitized 502/safe (service-side blocked, re-probed) |
| S3 preservation | round-trip + cleanup PASS (§R) |
| Local fallback / no client AWS SDK | unchanged (verified in built bundles) |

## U. Known limitations & notes

- **Real Step Functions execution = BLOCKED by IAM** (§P/§Q). The app's orchestration, DDB durability, and API surface are fully built and validated; the actual execution/token advance requires the machine + Lambda + `states:*` grants that this task was instructed not to create/broaden. When provisioned, set `FRAUDFIRST_STEP_FUNCTIONS_STATE_MACHINE_ARN` and `start` will attempt a real `StartExecution`.
- The response panel's "Start" is correctly unavailable until SFN is configured (`STEP_FUNCTIONS_NOT_CONFIGURED`), matching the honest-configuration principle; the durability layer (`response`) still works for a seeded plan, so the feature is safe to ship in that state.
- Task token items (`sf-token-*`) use a 14-day `expiresAt` mirroring the ASL `TimeoutSeconds`; a completed token is cleared unconditionally via `clearResponseTaskToken`.
- `amount`/`currency` in the SFN input reuse the user-entered amount string; conversion/formatting is not performed on the way in.
- UI is server-verified at the REST level; a full browser-render e2e of the RESPONSE PLAN panel was not run in this environment.
- Transient scripts used for validation here were deleted; the repository contains only application code and the shipped deployable artifacts under `aws/response-workflow/`.
- No credentials, secrets, `.env.local`, raw evidence bytes, or raw OCR text were committed or written anywhere new (verified in the DDB item shapes and the client-bundle scan).
- **Bedrock blocker retained verbatim:** Real Bedrock validation remains blocked by the AWS account/service-side `ValidationException: Operation not allowed` for Nova 2 Lite in us-east-1. Task 8 does not modify or claim to resolve this blocker.

---

**Stop condition honored:** Task 8 is complete and reported above. No Task 9 work was implemented.