# FRAUDFIRST — TASK 9B REPORT

Real AWS Step Functions deployment + validation for the five-action `FraudFirstResponseWorkflow`.

Result: **TASK 9B — PASS (real AWS).** A STANDARD Step Functions workflow was created, the app was configured with its real ARN, and a real execution of the synthetic incident `FF-20260919-TEST` was started, ran through three real `waitForTaskToken` states with three real Lambda → DynamoDB → `SendTaskSuccess` transitions (`preserve_evidence → contact_bank → contact_1930`), and was cleanly terminated; the only synthetic token record was deleted. No production data touched. No permissions broadened beyond the attached minimal policy.

> **Retained blocker (verbatim):** "Real Bedrock validation remains blocked by the AWS account/service-side ValidationException: Operation not allowed for Nova 2 Lite in us-east-1."

---

## 1. Phase 1 — Identity + permissions verification (REAL AWS)

- Identity confirmed via `sts:GetCallerIdentity`: `arn:aws:iam::124623494188:user/fraudfirst-dev` (Account `124623494188`, Region `us-east-1`).
- Required permission probes (performed with non-existing resources so an ALLOWED result surfaces as a benign Not-Found / Invalid-Token / Execution-Does-Not-Exist error — never AccessDenied):

| Operation | Result |
|---|---|
| `iam:GetRole` | ALLOWED (role did not exist yet → `NoSuchEntityException`) |
| `iam:CreateRole` | ALLOWED (exercised Phase 2) |
| `iam:PutRolePolicy` | ALLOWED (exercised Phase 2) |
| `iam:GetRolePolicy` | ALLOWED |
| `iam:PassRole` | ALLOWED (proven by successful `CreateStateMachine`) |
| `states:ListStateMachines` | ALLOWED (empty list pre-deploy) |
| `states:CreateStateMachine` | ALLOWED (Phase 3) |
| `states:DescribeStateMachine` | ALLOWED |
| `states:StartExecution` | ALLOWED (Phase 5) |
| `states:DescribeExecution` | ALLOWED (Phase 5) |
| `states:SendTaskSuccess` | ALLOWED (Phase 5, 3×) |
| `states:SendTaskFailure` | ALLOWED (fake token → `InvalidToken`, not AccessDenied) |
| `states:StopExecution` | ALLOWED (fake execution → `ExecutionDoesNotExist`; then real stop in Phase 5) |

Note: `iam:ListRolePolicies` / `iam:ListAttachedRolePolicies` are intentionally NOT part of the deployment policy, so managed-policy enumeration is not performed. The execution role was created fresh by this task, so it has no managed policies; its trust + inline policy were verified exactly.

## 2. Phase 2 — Execution role (created, then verified exact)

- Role: `arn:aws:iam::124623494188:role/FraudFirstResponseStateMachineRole` (created during the first 9B run; this run **reused** it because it exactly matches the artifacts).
- Trust policy verification (`iam:GetRole`, decoded): matches `state-machine-role-trust-policy.json` exactly — **only** `sts:AssumeRole` for `states.amazonaws.com` (**`trustMatch: true`**).
- Permissions policy verification (`iam:GetRolePolicy` on `InvokeFraudFirstResponseBridge`): matches `state-machine-role-policy.json` exactly — only `lambda:InvokeFunction` on `arn:aws:lambda:us-east-1:124623494188:function:FraudFirstResponseBridge` (**`permMatch: true`**).
- Lambda execution role was NOT modified: `arn:aws:iam::124623494188:role/service-role/FraudFirstResponseBridge-role-fkm9a0rd` (unchanged).

## 3. Phase 3 — State machine (created + verified)

- ARN: `arn:aws:states:us-east-1:124623494188:stateMachine:FraudFirstResponseWorkflow`
- Type: **STANDARD** · Status: **ACTIVE** · Created: 2026-09-20T04:19:18Z
- Execution role bound: `arn:aws:iam::124623494188:role/FraudFirstResponseStateMachineRole`
- Deployed definition (`DescribeStateMachine`, canonical compare): **byte-identical to `aws/response-workflow/state-machine.json`** (`definitionMatchesArtifact: true`).
- Structure: `INCIDENT_STARTED` (Pass) → 5 `lambda:invoke.waitForTaskToken` Tasks → `RESPONSE_COMPLETE` (Pass, End).

| State | `actionType` | `FunctionName` | `TaskToken.$` | `incidentId.$` | `ResultPath` | `TimeoutSeconds` | Task state resource |
|---|---|---|---|---|---|---|---|
| PRESERVE_EVIDENCE | `preserve_evidence` | FraudFirstResponseBridge | `$$.Task.Token` | `$.incidentId` | `null` | 1209600 | `…:::lambda:invoke.waitForTaskToken` |
| CONTACT_BANK | `contact_bank` | FraudFirstResponseBridge | `$$.Task.Token` | `$.incidentId` | `null` | 1209600 | `…:::lambda:invoke.waitForTaskToken` |
| CONTACT_1930 | `contact_1930` | FraudFirstResponseBridge | `$$.Task.Token` | `$.incidentId` | `null` | 1209600 | `…:::lambda:invoke.waitForTaskToken` |
| REPORT_CYBERCRIME | `report_cybercrime` | FraudFirstResponseBridge | `$$.Task.Token` | `$.incidentId` | `null` | 1209600 | `…:::lambda:invoke.waitForTaskToken` |
| FOLLOW_UP | `follow_up` | FraudFirstResponseBridge | `$$.Task.Token` | `$.incidentId` | `null` | 1209600 | `…:::lambda:invoke.waitForTaskToken` |

**Deployment-driven ASL fix (required, minimal).** `CreateStateMachine` was rejected the first time with a real AWS validation error: `Invalid State Machine Definition: 'MISSING_TRANSITION_TARGET: State "FAILED" is not reachable.'`. Step Functions refuses to create a machine containing an unreachable `Fail` state. The dead, unreachable `FAILED` state was removed from `aws/response-workflow/state-machine.json` (the canonical five-action fixed sequence, all transitions, `waitForTaskToken` integration, timeouts, and `RESPONSE_COMPLETE` are unchanged). The offline suite's `FAILED` assertion was updated to assert the state is absent and documents why. After the fix the definition deployed and verified clean.

## 4. Phase 4 — Application ARN configuration

- Set (local configuration mechanism, git-ignored `.env.local`): `FRAUDFIRST_STEP_FUNCTIONS_STATE_MACHINE_ARN=arn:aws:states:us-east-1:124623494188:stateMachine:FraudFirstResponseWorkflow`
- Not hard-coded anywhere in source.
- Verified via the app's own module (`src/services/server/step-functions.ts`): `configuredStateMachineArn()` returns the real ARN and `hasStepFunctionsConfiguration() === true`.
- The ARN is a resource identifier, not a secret; it lives only in the git-ignored local env file.

## 5. Phase 5 — REAL AWS execution test (the proof)

Synthetic incident `FF-20260919-TEST`, input `{"incidentId":"FF-20260919-TEST","actionType":"preserve_evidence"}` (safe metadata only).

- **Execution ID / ARN:** `9b-1789878081346` / `arn:aws:states:us-east-1:124623494188:execution:FraudFirstResponseWorkflow:9b-1789878081346`
- `StartExecution` → success; execution entered **RUNNING**.

| Step | Result |
|---|---|
| State 1 reached + bridge invoked | Token record `sf-token-FF-20260919-TEST` written with `actionType=preserve_evidence`; execution remained RUNNING/waiting; `expiresAt = now + 1209597 s` (≈ 14 days) |
| `SendTaskSuccess` (real stored token) | OK |
| State 2 reached + bridge invoked | Token record rewritten with `actionType=contact_bank`; RUNNING; `expiresAt = now + 1209595 s` |
| `SendTaskSuccess` (real stored token) | OK |
| State 3 reached + bridge invoked | Token record rewritten with `actionType=contact_1930`; RUNNING; `expiresAt = now + 1209596 s` |
| Safe termination | `StopExecution` (error `TASK9B_CLEANUP`) → execution **ABORTED** (verified terminal) |
| Cleanup | Deleted ONLY `sf-token-FF-20260919-TEST`; re-`GetItem` confirms **token no longer present** |

That is the full required real chain three times over: **waitForTaskToken state entered → `FraudFirstResponseBridge` invoked → DynamoDB `sf-token-*` write with correct `actionType`/`incidentId`/14-day `expiresAt` → app-side `SendTaskSuccess` with the actual stored token → workflow advances to the next state.**

Raw TaskTokens were never printed, logged, or exposed: the execution log captured only `taskTokenSha256` (6b77dcf9…, 94561a7a…, 7f069124…) and a 6+4-character sample marker (`AQCEAA…YlJD`, `AQCEAA…dgMo`, `AQCEAA…L5Wv`). The tokens were consumed and the record deleted; nothing live remains.

## 6. Phase 6 — Security validation

| Check | Result |
|---|---|
| State machine role can invoke ONLY the bridge | PASS — inline policy is exactly `lambda:InvokeFunction` on the single bridge ARN (verified); trust = `states.amazonaws.com` only |
| Lambda role still only `PutItem` + `sf-token-*` LeadingKeys | PASS / not re-readable — role ARN unchanged (`…/FraudFirstResponseBridge-role-fkm9a0rd`); policy proven in Task 8B; untouched by this task (no IAM write performed) |
| Step Functions input contains only safe metadata | PASS — actual start input was `{"incidentId":"FF-20260919-TEST","actionType":"preserve_evidence"}` |
| No credentials in state-machine definition | PASS — 0 matches for `AKIA|SECRET|AWS_ACCESS` in the ASL |
| No credentials in environment committed to git | PASS — `.env.local` git-ignored; real key absent from all tracked files |
| No raw TaskToken logged | PASS — bridge has zero logging statements; this task logged only SHA-256 + truncated sample |
| No raw TaskToken returned to browser | PASS — unchanged (offline-tested); only opaque `resp_<type>` IDs ever reach the client |
| No production incident data modified | PASS — writes limited to the single synthetic token key + the synthetic execution |
| No S3 objects modified | PASS — zero S3 calls |
| Bedrock untouched | PASS — zero Bedrock calls |

## 7. Phase 7 — Regression

| Area | Command / check | Result |
|---|---|---|
| Unit/integration suite (Tasks 7/8/9A + updated ASL test) | `npm test` | **55 tests, 55 pass, 0 fail** |
| Lint | `npm run lint` | clean |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | clean |
| Build | `npm run build` (Next.js 16.3.5, Turbopack) | success, 11 routes |
| Smoke `/` | 200 |
| Smoke `/api/health` | 200 |
| Smoke `/incident/FF-20260919-TEST` | 200 |

## 8. Deployment summary (real AWS resources)

| Resource | ARN |
|---|---|
| Step Functions execution role | `arn:aws:iam::124623494188:role/FraudFirstResponseStateMachineRole` |
| State machine (STANDARD, ACTIVE) | `arn:aws:states:us-east-1:124623494188:stateMachine:FraudFirstResponseWorkflow` |
| Lambda (unchanged) | `arn:aws:lambda:us-east-1:124623494188:function:FraudFirstResponseBridge` |
| Execution (synthetic, ABORTED) | `arn:aws:states:us-east-1:124623494188:execution:FraudFirstResponseWorkflow:9b-1789878081346` |
| DynamoDB token records | `sf-token-FF-20260919-TEST` (written 3×, deleted; verified gone) |

## 9. Limitations / notes

- No raw TaskTokens in this report or any output (by design and by the deleted record).
- The minimal deployment policy intentionally excludes `iam:ListRolePolicies` / `iam:ListAttachedRolePolicies` / `states:ListExecutions` / `states:GetExecutionHistory`; "states reached" is proven by the bridge token writes at each state plus `RUNNING`/final status (each token can only be written by its own state's Lambda invocation).
- The ASL change (removal of the unreachable `FAILED` state) was the only definition change and was forced by a real AWS `CreateStateMachine` validation error; the canonical action sequence and semantics are unchanged and the deployed definition matches the artifact byte-for-byte.
- New devDependencies (scripts only, never bundled): `@aws-sdk/client-iam`, `@aws-sdk/client-lambda`, `@aws-sdk/client-sts`.
- Retained blocker, verbatim: "Real Bedrock validation remains blocked by the AWS account/service-side ValidationException: Operation not allowed for Nova 2 Lite in us-east-1."

**Stop condition honored:** Task 9B complete (real deployment + real execution validation through `contact_1930`, cleanup verified). Task 10 not started. No permissions broadened; no managed broad-access policy attached; app code modified only where a real deployment issue required it (the unreachable `FAILED` state) plus the aligned regression test.