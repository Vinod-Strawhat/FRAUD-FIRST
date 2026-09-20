# FRAUDFIRST — TASK 9A REPORT

Step Functions response-workflow **foundation** for FraudFirst: the five-action wait-for-human Step Functions workflow, its minimal IAM grant, the application-side Step Functions abstraction (StartExecution / DescribeExecution / SendTaskSuccess / SendTaskFailure), token-handling security, protected error mapping, and a persistent offline test suite.

Status: **TASK 9A — COMPLETE** · **300 SECONDS** · **NO REAL AWS DEPLOYMENT/EXECUTION PERFORMED** (by instruction — real deployment/validation is Task 9B's scope) · **55/55 OFFLINE TESTS PASS** · **lint clean** · **typecheck clean** · **production build clean**. No Lambda, IAM role, state machine, or service configuration was created, changed, or broadened in AWS for this task. No claim of a real Step Functions execution validation is made.

> **Retained blocker (unchanged by Task 9A):** Real Bedrock validation remains blocked by the AWS account/service-side `ValidationException: Operation not allowed` for Nova 2 Lite in us-east-1. Task 9A does not modify or claim to resolve this blocker.

---

## 1. Decision recorded (action taxonomy)

Task 9A requires the five response actions `contact_1930`, `contact_bank`, `report_cybercrime`, `preserve_evidence`, `follow_up`. The pre-existing Task 8 implementation used `call_1930` and `report_online` for two of the five (same order, same meaning). Per the confirmed decision, the state machine **and** the application action types were aligned to the Task 9A taxonomy (`contact_1930`, `report_cybercrime`). The Task 8B validation of the deployed bridge already used `contact_1930` in its synthetic token payload, so this aligns everything to one consistent set of `actionType` strings. The fixed-sequence architecture and step order from Task 8 were preserved unchanged.

## 2. Files inspected (source of truth)

- `aws/response-workflow/state-machine.json` — existing ASL (5-task fixed sequence, `waitForTaskToken`, `ResultPath: null`, `TimeoutSeconds: 1209600`).
- `aws/response-workflow/lambda/bridge.mjs` — deployed `FraudFirstResponseBridge` reference (writes `sf-token-<incidentId>` items; **not modified**).
- `aws/response-workflow/FraudFirstResponseBridge.zip` — packaged Lambda artifact (untouched).
- `src/services/server/step-functions.ts` — Step Functions service abstraction (lazy `SFNClient`, ARN validation, config detection, error mapping).
- `src/services/response/server.ts` — orchestration service (`startIncidentResponse`, `getIncidentResponse`, `completeIncidentResponseAction`, `advanceStepFunctionsBestEffort`).
- `src/services/response/sequence.ts`, `src/services/response/orchestrator.ts` — five-action definitions + pure transitions.
- `src/services/incident-persistence.ts` — workspace-record canonicalization incl. response/action allowlist.
- `src/services/server/dynamodb.ts` — single-table access incl. `readResponseTaskToken` / `clearResponseTaskToken`.
- `src/types/*` — response, persistence, timeline types.
- `src/app/api/incidents/[id]/response/**` — GET / POST start / POST complete routes (sanitized error mapping).
- `src/hooks/use-response-plan.ts`, `src/components/incident/response-plan.tsx` — client layer (no AWS SDK).
- `.env.example`, `.env.local`, `next.config.ts`, `package.json` — configuration surface.
- `FRAUDFIRST-TASK-*` reports (Tasks 3–8, 8B) — prior scope, validations, and the retained Bedrock blocker.

## 3. Files changed (Task 9A only)

| File | Change |
|---|---|
| `aws/response-workflow/state-machine.json` | Repaired → state names `CONTACT_1930`, `REPORT_CYBERCRIME`; `actionType` payloads `contact_1930`, `report_cybercrime`; comments updated. All `waitForTaskToken` / `ResultPath: null` / `TimeoutSeconds: 1209600` preserved. |
| `aws/response-workflow/state-machine-role-trust-policy.json` | **New** — `states.amazonaws.com` assume-role policy for the execution role. |
| `aws/response-workflow/state-machine-role-policy.json` | **New** — `lambda:InvokeFunction` scoped to the single bridge ARN only. |
| `src/types/response.ts` | `ResponseActionType` renamed to `contact_1930`, `report_cybercrime`. |
| `src/services/response/sequence.ts` | Action types + titles/descriptions aligned (`Contact 1930`, `Report cybercrime`). |
| `src/services/incident-persistence.ts` | Response action allowlist updated to the five aligned types. |
| `src/components/incident/response-plan.tsx` | Un-started copy updated ("contact 1930", "report cybercrime"). |
| `.env.example` | Sequence comment updated to `CONTACT_1930` / `REPORT_CYBERCRIME`. |
| `src/services/server/step-functions.ts` | Added `SendTaskFailureCommand` + `sendTaskFailure(taskToken, {error, cause})`; added safe mappings for `InvalidToken`, `TaskDoesNotExist`, `TaskTimedOut`. |
| `package.json` | Added `"test": "tsx --test \"test/*.test.ts\""`; devDependency `tsx` for the offline suite. |
| `test/**` | **New** persistent offline suite (7 files + helpers, 55 tests). |

## 4. Final workflow architecture

A fixed, ordered Standard Workflow — preserved from Task 8's documented sequence (no redesign):

```
INCIDENT_STARTED (Pass)
  → PRESERVE_EVIDENCE (Task, waitForTaskToken)
  → CONTACT_BANK      (Task, waitForTaskToken)
  → CONTACT_1930      (Task, waitForTaskToken)
  → REPORT_CYBERCRIME (Task, waitForTaskToken)
  → FOLLOW_UP         (Task, waitForTaskToken)
  → RESPONSE_COMPLETE (Pass, End)
FAILED (Fail) — terminal error boundary, unreachable by a pending human action.
```

Human completion model (unchanged and correct for Task 9A):

```
User clicks response action
 → app POST /response/start → StartExecution (safe metadata only, never auto-succeeds)
 → state machine enters waitForTaskToken state
 → bridge Lambda receives { incidentId, actionType, TaskToken }
 → Lambda stores the token in DynamoDB under sf-token-<incidentId>
 → workflow waits (14 days, no auto-advance)
 → user marks the action complete (opaque resp_<type> id)
 → app reads the stored token server-side and sends SendTaskSuccess
 → workflow resumes to the next state
```

No `SendTaskSuccess` is issued immediately after `StartExecution`; completion is only ever user-initiated.

## 5. The five supported actions

| Order | `actionType` (state) | Title | Priority |
|---|---|---|---|
| 1 | `preserve_evidence` | Preserve evidence | critical |
| 2 | `contact_bank` | Contact the bank or payment provider | high |
| 3 | `contact_1930` | Contact 1930 | critical |
| 4 | `report_cybercrime` | Report cybercrime | normal |
| 5 | `follow_up` | Follow up | normal |

All five are typed in `ResponseActionType`, defined in `sequence.ts`, allow-listed in `incident-persistence.ts`, and present as five `waitForTaskToken` Task states in the ASL (verified by tests).

## 6. Exact Lambda integration

Each Task state uses the Step Functions native Lambda integration with a callback token:

- `Resource: "arn:aws:states:::lambda:invoke.waitForTaskToken"`
- `Parameters.FunctionName: "FraudFirstResponseBridge"` (referenced by the function **name**, resolved in the same account/region; the IAM grant is scoped to its exact ARN `arn:aws:lambda:us-east-1:124623494188:function:FraudFirstResponseBridge`)
- `Parameters.Payload.incidentId.$: "$.incidentId"`
- `Parameters.Payload.actionType: "<one of the five>"`
- `Parameters.Payload.TaskToken.$: "$$.Task.Token"`
- `ResultPath: null` (the Lambda result is discarded; the workflow state output is not mutated)
- `TimeoutSeconds: 1209600` (14 days — the human-action wait, deliberately **not** the Lambda's 30s execution timeout)

No other Lambda and no other AWS resource is referenced anywhere in the ASL (test-verified).

## 7. waitForTaskToken behavior

The bridge Lambda writes the TaskToken (a callback credential) to a scoped `sf-token-<incidentId>` item in the single `fraudfirst-incidents` table with `expiresAt = now + 1209600`, mirroring the ASL timeout. The state does **not** auto-claim completion; it stays `RUNNING` until the app (server-side, using the stored token) calls `SendTaskSuccess`, or until AWS reports `TaskTimedOut` after 14 days. Each state's Lambda invocation is idempotent-per-write; the app re-reads the latest token item per incident and clears it after a successful send.

## 8. Required Step Functions IAM permissions (prepared for Task 9B)

Execution role for the state machine (artifacts committed):

- **Trust policy** (`state-machine-role-trust-policy.json`): `sts:AssumeRole` for `states.amazonaws.com`.
- **Permissions policy** (`state-machine-role-policy.json`): **only** `lambda:InvokeFunction` on `arn:aws:lambda:us-east-1:124623494188:function:FraudFirstResponseBridge`.

Explicitly **not** granted: `lambda:*`, `AdministratorAccess`, any other service actions. The role cannot invoke any other Lambda and cannot touch DynamoDB (the bridge Lambda's own deployed role, unchanged from Task 8B, is what writes the token item).

The application IAM identity (e.g. `fraudfirst-dev`) still needs the existing Task 8 grants — `states:StartExecution` / `states:DescribeExecution` / `states:SendTaskSuccess` (and now `states:SendTaskFailure` for the failure API) scoped to the provisioned state machine ARN. These are **requirements for Task 9B**, not applied here.

## 9. Application-side APIs supported

`src/services/server/step-functions.ts` (server-only, env var `FRAUDFIRST_STEP_FUNCTIONS_STATE_MACHINE_ARN`, ARN regex-validated, lazy client):

- `startResponseExecution(input)` → StartExecution, returns `executionArn`
- `describeResponseExecution(executionArn)` → DescribeExecution, returns status
- `sendTaskSuccess(taskToken, output)` → SendTaskSuccess (used by `advanceStepFunctionsBestEffort` on user completion)
- `sendTaskFailure(taskToken, {error, cause})` → SendTaskFailure (**new in 9A**; no app route triggers it yet — see Limitations)
- `configuredStateMachineArn()` / `hasStepFunctionsConfiguration()` → honest config detection (ARN + region + static creds or profile)

The app's client `responseService` (browser) never imports AWS SDK; it only calls the HTTP routes (`/api/incidents/[id]/response`, `/response/start`, `/response/actions/:actionId/complete`).

## 10. Security handling of TaskTokens

- TaskToken is stored **server-side only** in DynamoDB (`sf-token-<incidentId>`), read server-side, and cleared after use.
- Raw TaskTokens are **never** sent to the browser, stored in localStorage, placed in URLs, logged, or returned from API responses. The complete-route path uses the opaque `resp_<type>` action id (route regex `^resp_[a-z0-9_]+$`).
- `IncidentResponseView` / persisted `response` metadata contain no token fields (test-verified by shape, by serialization, and by source-level scans of client service/types/routes/components).
- Error mapping (see next section) strips all AWS identifiers/ARNs/request-ids/credentials.

## 11. Error handling

Covered by `mapStepFunctionsFailure` in `step-functions.ts` and the route-level gateway:

| Condition | Result |
|---|---|
| State machine ARN missing/empty/invalid | `STEP_FUNCTIONS_NOT_CONFIGURED` (503) — fails before any AWS call |
| Credentials/region/profile absent | `STEP_FUNCTIONS_NOT_CONFIGURED` (503) |
| StartExecution / DescribeExecution / SendTaskSuccess / SendTaskFailure failure | Mapped to fixed safe sentences (AccessDenied/ExecutionAlreadyExists/StateMachineDoesNotExist/InvalidArn/Validation/Throttling/TaskTimedOut/InvalidToken/TaskDoesNotExist + generic fallback) → `STEP_FUNCTIONS_REQUEST_FAILED` (502) |
| Unknown/unexpected error | Generic sentence, no exception text, no ARNs, no raw AWS message |

Responses are structured `{ ok, response | error: { code, message } }`; no raw AWS authorization text is ever returned.

## 12. Tests executed

Persistent offline suite — `npm test` (tsx + `node:test`), **55/55 PASS**:

- `test/state-machine.test.ts` — StartAt/Pass boundary; exactly five Task states; every Task uses `arn:aws:states:::lambda:invoke.waitForTaskToken`; `FunctionName=FraudFirstResponseBridge`; per-state `actionType` matches the five required values in sequence order; `TaskToken.$ = $$.Task.Token`; `ResultPath: null`; `TimeoutSeconds: 1209600`; fixed Next-chain order; `FAILED` unreferenced; **no** other AWS ARN anywhere in the ASL; input reads only `incidentId` (permissively accepts `{incidentId, actionType}`).
- `test/sequence.test.ts` — five required types/order; definitions; titles (`Contact 1930`, `Report cybercrime`); `isResponseActionType` rejects legacy `call_1930`/`report_online`; `responseActionDefinition`.
- `test/orchestrator.test.ts` — plan build; `resp_<type>` opaque ids; pointer advance; `ACTION_NOT_FOUND` / `ACTION_NOT_CURRENT` / `ACTION_ALREADY_COMPLETED`; full 5-step completion; progress; compacted whitelist (no token) — Task 8 regression.
- `test/step-functions-config.test.ts` — ARN validation matrix; `hasStepFunctionsConfiguration` matrix (ARN/region/static creds/profile; missing config → false); unconfigured `startResponseExecution` → `STEP_FUNCTIONS_NOT_CONFIGURED` with no AWS call.
- `test/step-functions-errors.test.ts` — with a mocked `SFNClient` (node:test `mock.method` on the real SDK prototype): StartExecution success payload is **only** safe metadata (`{incidentId, startedAt, currentAction, amount, currency}`) with no token/secret keys; DescribeExecution; SendTaskSuccess forwards the opaque token + serialized output; SendTaskFailure forwards token + error/cause; missing executionArn rejection; all known AWS exceptions map to fixed safe sentences with no ARN/user/request-id leak; unknown errors degrade to the generic sentence; SendTaskSuccess/SendTaskFailure failures sanitized.
- `test/token-exposure.test.ts` — running/completed plans and the API view never serialize a token; `@aws-sdk`/taskToken absent from the client service, response types, API routes, hook and component (source scans).
- `test/persistence-regression.test.ts` — incident record canonicalizes with the new five-action plan (running + completed); legacy `call_1930`/`report_online` rejected; invalid status/duplicate actions rejected (Tasks 7–8 persistence regression).

**No fake "real AWS" assertions:** the suite is entirely offline; AWS interaction is mocked only to prove the service's request/response/error-path behavior.

## 13. lint / typecheck / build / bundle scan

- `npm run lint` — **0 errors, 0 warnings**.
- `npm run typecheck` (`tsc --noEmit`) — **clean**.
- `npm run build` (`next build`, Next.js 16.3.5 / Turbopack) — **success**; all routes present incl. the response API routes and `/incident/[id]`.
- Client-bundle leak scan on the fresh build: **zero** matches for `SFNClient`, `SendTaskSuccess`, `SendTaskFailure`, `StartExecutionCommand`, `client-sfn`, `AWSCredentials`, `AWS_ACCESS_KEY_ID`, `SecretAccessKey`, or an `AKIA…` credential in `.next/static` or `.next/server` output chunks. The real access key appears only in local Turbopack **cache** files (never shipped); the only server-chunk `AKIA…`-shaped match is coincidental base64 content, not a credential.
- Live smoke test (dev server): `GET /` 200, `GET /api/health` 200.

## 14. Known limitations

- **No real AWS deployment/execution** was performed (per instructions). Real Step Functions validation, creation of the state machine + execution role, and end-to-end token round-trip are **Task 9B** scope.
- `sendTaskFailure` is implemented and error-safe in the abstraction, but no application route currently invokes it (no inventoried "fail/abort" UX exists). It is available for the future failure path — documented, not invented.
- The Step Functions input is the safe metadata superset `{incidentId, startedAt, currentAction, amount, currency}` already shipped by Task 8; the machine reads only `incidentId` and permissively accepts extra keys (it would equally accept an `actionType` key, which sits unused because the machine is a preserved fixed sequence).
- The deployed bridge Lambda timeout remains 3 s (Task 8B note); the single `PutCommand` completes far below that — unchanged, non-blocking.
- Full browser-render e2e of the RESPONSE PLAN panel was not run in this environment (consistent with Task 8); REST + offline coverage is in place.
- **Bedrock blocker retained verbatim** (see top of report).

## 15. Exact AWS deployment steps / requirements for Task 9B

Prerequisites (no source changes required):
- Standard Workflow ASL from `aws/response-workflow/state-machine.json`.
- Execution role for the machine with the two committed policies:
  - IAM role trust policy: `aws/response-workflow/state-machine-role-trust-policy.json`
  - Inline permissions: `aws/response-workflow/state-machine-role-policy.json` (`lambda:InvokeFunction` on `arn:aws:lambda:us-east-1:124623494188:function:FraudFirstResponseBridge` only).
- The app IAM identity (`fraudfirst-dev`) must hold, scoped to the new machine's ARN: `states:StartExecution`, `states:DescribeExecution`, `states:SendTaskSuccess`, `states:SendTaskFailure` (and optionally `states:ListStateMachines`).
- `FRAUDFIRST_STEP_FUNCTIONS_STATE_MACHINE_ARN` set in the runtime env (currently deliberately empty in `.env.local`/`.env.example`).

Example commands (for Task 9B to run with the app's scoped identity):

```
aws iam create-role --role-name FraudFirstResponseWorkflowRole \
  --assume-role-policy-document file://aws/response-workflow/state-machine-role-trust-policy.json
aws iam put-role-policy --role-name FraudFirstResponseWorkflowRole \
  --policy-name FraudFirstResponseBridgeInvoke \
  --policy-document file://aws/response-workflow/state-machine-role-policy.json

aws stepfunctions create-state-machine --name FraudFirstResponseWorkflow \
  --definition file://aws/response-workflow/state-machine.json \
  --role-arn arn:aws:iam::124623494188:role/FraudFirstResponseWorkflowRole \
  --type STANDARD --region us-east-1

# record the returned state machine ARN, then:
aws stepfunctions start-execution --state-machine-arn <SM-ARN> \
  --input '{"incidentId":"FF-<date>-<id>","startedAt":"...","currentAction":"preserve_evidence","amount":null,"currency":"INR"}'
```

Then set `FRAUDFIRST_STEP_FUNCTIONS_STATE_MACHINE_ARN=<SM-ARN>`, restart the app, and validate: `POST /response/start` → 200 with `executionArn`; bridge writes `sf-token-<incidentId>`; the machine stays `RUNNING` until `POST /response/actions/resp_<type>/complete` triggers `SendTaskSuccess`; re-invocation of the completed action returns the sanitized guardrail errors.

**Stop condition honored:** Task 9A complete and reported. Task 9B / Task 10 not started; no real AWS state machine created, no IAM broadened, Bridge Lambda and its role untouched, Bedrock code untouched.