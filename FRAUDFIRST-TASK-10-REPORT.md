# FRAUDFIRST — TASK 10 REPORT

Connect the existing incident workspace (response-plan UI + response APIs) to the **real deployed** `FraudFirstResponseWorkflow` state machine so a user can start and step through a real fraud response workflow from the app.

Result: **TASK 10 — IMPLEMENTED.** The existing Task 8/9A response orchestration was connected to the real deployed Step Functions workflow (Task 9B, already PASSED). Response-plan start is now duplicate-proof (returns the safe status of an existing plan instead of starting a second execution), response reads reconcile the plan against the live execution (`DescribeExecution`), terminal workflow states (SUCCEEDED / FAILED / ABORTED / TIMED_OUT) are mapped to safe UI states and persisted idempotently, TaskTokens stay strictly server-side, and the response-plan UI now shows live workflow state, reconciles after refresh, and supports restarting a failed plan. Mocked-SFN integration tests pass, all existing regression tests pass, and lint/typecheck/production build are clean.

> Retained blocker (verbatim, from Task 9B — not introduced by Task 10): "Real Bedrock validation remains blocked by the AWS account/service-side ValidationException: Operation not allowed for Nova 2 Lite in us-east-1."
>
> No new blocker found in Task 10.

**Verification scoping.** Per instructions, a full browser → real Step Functions end-to-end was **NOT claimed**. Task 9B independently verified the real workflow (real `StartExecution` → 3× real `waitForTaskToken` → `SendTaskSuccess` → `StopExecution`) and the app's real ARN configuration. Task 10 runtime validation used the already-running production server on `http://localhost:3000` for smoke checks, with the AWS-facing behavior (start, reconcile, complete) covered by deterministic tests that mock the SFN and DynamoDB clients. No new executions of the real state machine were created by this task, and no production incident data was touched.

---

## 1. Implementation changes

### `src/types/response.ts`
- Added `ResponseExecutionState` (`NOT_STARTED | STARTING | RUNNING | COMPLETED | FAILED | STOPPED`).
- Added optional `executionStatus?: ResponseExecutionState` to `IncidentResponseView` (safe, read-only view data — no token material is possible on this type by construction).

### `src/services/response/server.ts` (all server-side; no client exposure)
- **`toExecutionState`** maps SFN `DescribeExecution` status to a safe state: `SUCCEEDED→COMPLETED`, `FAILED→FAILED`, `ABORTED→STOPPED`, `TIMED_OUT→FAILED`, default `RUNNING`. `executionStateFromMeta` derives a state from the persisted plan when Step Functions is not configured or no execution ARN is present.
- **`startIncidentResponse` — duplicate-start prevention (claim-first).**
  - If a plan already exists with status `running` or `completed`, it **returns the safe view of the existing plan** (no new execution, no `StartExecution` call). Only a `failed` plan can be restarted.
  - The response plan is claimed (persisted as `running`) **before** `StartExecution`, so a concurrent second start detects the already-running plan via the conditional-write conflict retry and converges to the existing plan instead of launching a second execution.
  - On `StartExecution` failure the just-claimed plan is best-effort marked `failed` so the UI can offer restart (no stuck "running" plan without an execution).
  - The execution ARN is persisted onto the plan best-effort; the SFN start payload stays `{incidentId, startedAt, currentAction, amount, currency}` (no token).
- **`getIncidentResponse` / `resolveIncidentResponse` — live reconciliation.**
  - Every read, when a plan with an `executionArn` exists and Step Functions is configured, calls `DescribeExecution` (one call per read) and maps the live status.
  - Terminal discrepancy is reconciled and persisted: `SUCCEEDED` → plan `completed`, all pending actions marked complete; `FAILED` → plan `failed`; `ABORTED` → plan `failed` with view state `STOPPED`; `TIMED_OUT` → plan `failed`. Reconciliation is idempotent (only runs once per transition, timeline events are fixed-id and de-duplicated).
  - `DescribeExecution` failure is **best-effort**: the read still returns the plan safely derived from persisted state (never a 5xx for a transient/denied describe).
- **`completeIncidentResponseAction`** — unchanged contract; still the only path that touches a TaskToken: after persisting the local action completion + timeline it calls `advanceStepFunctionsBestEffort`.
- **`advanceStepFunctionsBestEffort` — token-first ordering.** Reads the server-side token record (`sf-token-<incidentId>`) and calls `SendTaskSuccess` with `{incidentId, actionType}`; clears the token after the attempt. Falls back to `DescribeExecution` only when no token exists. No execution ARN is required to advance (token is the source of truth), which makes completion robust even if the ARN persistence was best-effort.

### `src/hooks/use-response-plan.ts`
- Added polling of `GET /response` every **8 s** while the plan status is `running` (stops automatically on `completed`/`failed`, and never polls when no plan exists).
- In-flight guard (`useRef`) prevents overlapping polls; reconcile-on-read means each poll may reconcile terminal state.

### `src/components/incident/response-plan.tsx`
- Status pill now shows a `failed` state ("Response failed", red).
- New workflow status line: `Step Functions · <Workflow running|complete|failed|stopped> · reconciled with live execution status` (shown when the server supplies `executionStatus`).
- New failed/stopped card under the action list: explains the workflow stopped/failed, and offers **Restart response plan** (re-uses the existing `start()` path, which is now allowed only for `failed` plans).
- Canonical action sequence is unchanged (Preserve Evidence → Contact Bank → Contact 1930 → Report Cybercrime → Follow Up), grouped as *What happened / What to do now / What comes next*, with progress bar and "Only after YOU have done this" guard text. No redesign.

## 2. API changes (shape-compatible)
- `GET /api/incidents/[id]/response` — same 200 shape, now with optional `executionStatus`; reconciles with the live workflow before returning.
- `POST /api/incidents/[id]/response/start` — same 200/4xx/5xx codes. Behavior change: if a `running`/`completed` plan already exists it returns **200 with the existing safe view** instead of a conflict, so duplicate starts are prevented without a second execution (safe lifecycle: NO_WORKFLOW → claim → RUNNING → … → COMPLETED/FAILED/STOPPED).
- `POST /api/incidents/[id]/response/actions/[actionId]/complete` — unchanged: browser sends only `incidentId` + opaque `resp_*` action id; the server retrieves the pending token, calls `SendTaskSuccess`, clears it, and updates the plan + timeline.
- Error mapping preserved: 400 invalid action/id, 404 incident/plan/action missing, 409 duplicate/out-of-order completion, 503 Step Functions/DynamoDB not configured, 502 AWS failure. `RESPONSE_ALREADY_STARTED` remains in the error union for backward compatibility but is no longer emitted by `start` (converges instead).

## 3. TaskToken security
- Tokens are read from DynamoDB **only inside `src/services/response/server.ts`** (`readResponseTaskToken`) and passed directly to `SendTaskSuccess`; never written into any response payload.
- `IncidentResponseView` / `ResponseExecutionState` expose no token-capable fields; the browser-facing deployable view is `{status, startedAt, updatedAt, currentActionType, executionArn, executionStatus, actions(whitelisted)}`.
- Source scan: `taskToken`/`TaskToken` appears **only** in server-only modules (`src/services/response/server.ts`, `src/services/server/dynamodb.ts`, `src/services/server/step-functions.ts`). No occurrences in `src/types/response.ts`, client service (`src/services/response/index.ts`), hooks, components, or API routes.
- Client-bundle scan of `.next/static` (production build): **CLEAN** — no `taskToken`, `TaskToken`, `sf-token-`, `AWS_ACCESS_KEY`, or `NEXT_PUBLIC_*`.
- No `NEXT_PUBLIC_AWS`/`NEXT_PUBLIC_STEP_FUNCTIONS` variables exist in `src`. SDK usage remains server-only via `next.config.ts` `serverExternalPackages` (`@aws-sdk/client-sfn`, `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, …).
- Timeline text never contains a token (only short execution-name detail from `summaryDetail`).

## 4. Persistence / reconciliation
- Plan record is unchanged in schema (`response.status` ∈ `running|completed|failed`, five actions, `executionArn`). Reconcile only mutates plan status/action statuses, never evidence/incident fields.
- Writes use the existing conditional update (`updatedAt` equality) + single conflict-retry pattern; reconciliation is a read-modify-write with the same retry.
- De-duplication: `appendTimelineEvent` skips events that already exist by id (or type+detail+occurredAt), so repeated reconciles/polls never duplicate timeline events.
- If the plan is created but `StartExecution` fails, the claim is best-effort flipped to `failed` (restartable); if the ARN persistence fails afterward, completion still advances via the token-first path.

## 5. Timeline behavior (idempotent)
- `response_started` (fixed id `tl_<id>_response_start`) — on start.
- `response_action_completed` (fixed id `tl_<id>_action_<type>`) — on each user-completed action.
- `response_completed` (fixed id `tl_<id>_response_complete`) — emitted once, either by the last action completion or by reconciliation with a SUCCEEDED execution (same id ⇒ no duplicate).
- `response_failed` (fixed id `tl_<id>_response_failed`) — emitted once on reconcile of FAILED/TIMED_OUT/ABORTED, with stopped vs failed wording.

## 6. Tests
- New suite **`test/response-server.test.ts`** (12 tests) — DDB (`DynamoDBDocumentClient.prototype.send`) and SFN (`SFNClient.prototype.send`) mocked with an in-memory store; env = real ARN + credentials + table:
  - start starts **exactly one** execution and persists a running plan + ARN + `response_started`, view JSON contains no token;
  - start with an existing running plan returns safe status and makes **no** `StartExecution` call;
  - start with a completed plan returns safe completed status, no new execution;
  - start refuses (`STEP_FUNCTIONS_NOT_CONFIGURED`) when the ARN env is missing, no AWS call;
  - get reconciles SUCCEEDED → completed (all actions completed, `response_completed` timeline exactly once across two reads);
  - get maps ABORTED → `failed`/`STOPPED` with a single `response_failed` event;
  - get maps FAILED → `failed`/`FAILED`;
  - get survives describe failure (AccessDenied) and still returns the plan (running, best-effort);
  - get reports `RESPONSE_NOT_FOUND` when no plan exists;
  - complete advances the real workflow with the stored token, returns the next action, clears the token, adds one `response_action_completed` event, and never leaks a token;
  - complete falls back to `DescribeExecution` when no token is stored.
- Existing regression suites (orchestrator, sequence, state-machine, step-functions config/errors, persistence-regression, token-exposure) all still pass.

**Result: `npm test` → 66/66 pass.**

## 7. lint / typecheck / build
- `npm run lint` → clean.
- `npm run typecheck` (`tsc --noEmit`) → clean.
- `npm run build` (Next.js 16.3.5, Turbopack) → compiled successfully; 11 routes; no warnings.

## 8. Runtime checks (against the already-running production server on port 3000, Task-10 build)
| Check | Method | Result |
|---|---|---|
| `/` | GET | 200 |
| `/api/health` | GET | 200 |
| `/incident/FF-20260919-TEST` | GET | 200 (page render) |
| `/api/incidents/FF-20260919-TEST` | GET | 404 (safe) |
| `/api/incidents/FF-20260919-TEST/response` | GET | 404 `INCIDENT_NOT_FOUND` (incident validated before any AWS call) |
| `/api/incidents/FF-20260919-TEST/response/start` | POST | 404 `INCIDENT_NOT_FOUND` |
| `/api/incidents/.../response/actions/resp_.../complete` | POST | 404 `INCIDENT_NOT_FOUND` |

These confirm the unconfigured/missing-incident and validation-before-AWS behaviors are safe (no AWS execution created, no token touched).

## 9. Files changed
- `src/types/response.ts`
- `src/services/response/server.ts`
- `src/hooks/use-response-plan.ts`
- `src/components/incident/response-plan.tsx`
- `test/response-server.test.ts` (new)

## 10. Blocker
- None for Task 10. Retained (not caused by this task): Bedrock Nova 2 Lite ValidationException in `us-east-1` (see Task 9B). No IAM permissions broadened; neither the bridge Lambda role nor the Step Functions execution role was modified.