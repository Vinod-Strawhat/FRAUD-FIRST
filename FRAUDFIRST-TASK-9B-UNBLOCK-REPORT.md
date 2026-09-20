# FRAUDFIRST — TASK 9B BLOCKER UNBLOCK REPORT

Deliverable: the **exact minimal IAM policy** that lets `fraudfirst-dev` complete Task 9B (deploy and validate `FraudFirstResponseWorkflow`), determined against the live account/region configuration. No app code modified. No role/state machine created. No execution started. No permissions broadened. Nothing was attached automatically because the current identity cannot attach policies.

Result: **POLICY PRODUCED — AUTO-ATTACH NOT POSSIBLE** (`iam:CreatePolicy` / `iam:GetUser` denied under `fraudfirst-dev`). Final JSON below, ready for manual attach.

---

## 1. Account / region configuration (verified live)

- Account ID: `124623494188` (partition `aws`)
- Region: `us-east-1` (all Step Functions artifacts are region-scoped — the account's Step Functions deployment region)
- Lambda (verified): `arn:aws:lambda:us-east-1:124623494188:function:FraudFirstResponseBridge` (Active, `nodejs22.x`, handler `index.handler`)
- DynamoDB (verified): `fraudfirst-incidents` (ACTIVE)
- Identity: IAM user `fraudfirst-dev` (the `.env.local` credential mechanism) — **no IAM-management permission** (probed live: `iam:GetRole`, `iam:CreateRole`, `iam:PutRolePolicy`, `iam:GetUser`, `iam:CreatePolicy` all AccessDenied; `states:CreateStateMachine`, `states:ListStateMachines` AccessDeniedException)

## 2. Exact AWS resource ARNs used

| Resource | ARN |
|---|---|
| Step Functions execution role (target) | `arn:aws:iam::124623494188:role/FraudFirstResponseStateMachineRole` |
| State machine (target) | `arn:aws:states:us-east-1:124623494188:stateMachine:FraudFirstResponseWorkflow` |
| Executions of that machine (target) | `arn:aws:states:us-east-1:124623494188:execution:FraudFirstResponseWorkflow:*` |

Execution ARNs cannot be predicted in advance (they carry a runtime-generated name), so the executed-scoped statements use the workflow-name-prefixed wildcard — the narrowest scoping AWS permits for them.

## 3. Which permissions can be resource-scoped vs must use `*`

| Action | Resource scoping | Exact resource in this policy |
|---|---|---|
| `iam:GetRole` | Role ARN | `…:role/FraudFirstResponseStateMachineRole` |
| `iam:CreateRole` | Role ARN (narrowest practical; role does not exist yet, scope to its intended final ARN) | `…:role/FraudFirstResponseStateMachineRole` |
| `iam:PutRolePolicy` | Role ARN | `…:role/FraudFirstResponseStateMachineRole` |
| `iam:GetRolePolicy` | Role ARN | `…:role/FraudFirstResponseStateMachineRole` |
| `iam:PassRole` | Role ARN + `iam:PassedToService` condition (required by `CreateStateMachine`) | `…:role/FraudFirstResponseStateMachineRole` with `Condition: iam:PassedToService = states.amazonaws.com` |
| `states:CreateStateMachine` | stateMachine ARN | `…:stateMachine:FraudFirstResponseWorkflow` |
| `states:DescribeStateMachine` | stateMachine ARN | `…:stateMachine:FraudFirstResponseWorkflow` |
| `states:StartExecution` | stateMachine ARN | `…:stateMachine:FraudFirstResponseWorkflow` |
| `states:DescribeExecution` | execution ARN | `…:execution:FraudFirstResponseWorkflow:*` |
| `states:StopExecution` | execution ARN | `…:execution:FraudFirstResponseWorkflow:*` |
| `states:SendTaskSuccess` | **Not supported — must be `*`** (resource column empty per AWS Service Authorization Reference; the task token is an opaque capability, not an ARN) | `*` |
| `states:SendTaskFailure` | **Not supported — must be `*`** (same) | `*` |
| `states:ListStateMachines` | **Not supported — must be `*`** (list-type action, resource column empty) | `*` |

The three `*` statements are the documented, unavoidable minimum from the AWS Service Authorization Reference and do not resemble broad managed policies (`AdministratorAccess`, `PowerUserAccess`, `AWSStepFunctionsFullAccess`, `IAMFullAccess`, `AmazonDynamoDBFullAccess` — none granted). `SendTaskSuccess`/`SendTaskFailure` on `*` are harmless because they succeed only with a valid TaskToken for a currently-waiting task.

## 4. Final policy JSON

Committed artifact: `aws/response-workflow/fraudfirst-dev-task9b-deploy-policy.json`

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ManageFraudFirstResponseExecutionRole",
      "Effect": "Allow",
      "Action": [
        "iam:GetRole",
        "iam:CreateRole",
        "iam:PutRolePolicy",
        "iam:GetRolePolicy"
      ],
      "Resource": "arn:aws:iam::124623494188:role/FraudFirstResponseStateMachineRole"
    },
    {
      "Sid": "PassExecutionRoleToStepFunctions",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::124623494188:role/FraudFirstResponseStateMachineRole",
      "Condition": {
        "StringEquals": {
          "iam:PassedToService": "states.amazonaws.com"
        }
      }
    },
    {
      "Sid": "ManageFraudFirstResponseWorkflow",
      "Effect": "Allow",
      "Action": [
        "states:CreateStateMachine",
        "states:DescribeStateMachine",
        "states:StartExecution"
      ],
      "Resource": "arn:aws:states:us-east-1:124623494188:stateMachine:FraudFirstResponseWorkflow"
    },
    {
      "Sid": "DescribeAndStopWorkflowExecutions",
      "Effect": "Allow",
      "Action": [
        "states:DescribeExecution",
        "states:StopExecution"
      ],
      "Resource": "arn:aws:states:us-east-1:124623494188:execution:FraudFirstResponseWorkflow:*"
    },
    {
      "Sid": "SendTaskSuccessAndFailureNoResourceLevel",
      "Effect": "Allow",
      "Action": [
        "states:SendTaskSuccess",
        "states:SendTaskFailure"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ListStateMachinesNoResourceLevel",
      "Effect": "Allow",
      "Action": "states:ListStateMachines",
      "Resource": "*"
    }
  ]
}
```

## 5. Attempt result (exact AWS denial — nothing was applied, nothing left behind)

| Operation (current identity) | Exact result |
|---|---|
| `iam:GetUser` (attach-target discovery) | `AccessDenied: User: arn:aws:iam::124623494188:user/fraudfirst-dev is not authorized to perform: iam:GetUser on resource: user fraudfirst-dev` |
| `iam:CreatePolicy` (`FraudFirstStepFunctionsDeploy`) | `AccessDenied: … not authorized to perform: iam:CreatePolicy on resource: policy FraudFirstStepFunctionsDeploy` |

Because `iam:CreatePolicy` was denied, no policy was created and no attachment was attempted, so there is nothing to clean up. Per requirement 7, the policy is delivered for manual attachment.

## 6. Exact manual AWS Console steps (attach the policy)

1. **Log in** to the AWS Console as an IAM user/role with IAM management permission (e.g. an account admin). Region does not matter for IAM.
2. **IAM console** → **Policies** → **Create policy** → tab **JSON**.
3. Paste the **final policy JSON** from section 4 exactly → **Next** → **Next**.
4. Name: `FraudFirstStepFunctionsDeploy` → (optional) description → **Create policy**.
5. **IAM console** → **Users** → `fraudfirst-dev` → **Permissions** → **Add permissions** → **Attach policies directly**.
6. Search `FraudFirstStepFunctionsDeploy` → select it → **Add permissions**.
7. (Optional) verify: `iam:GetCallerIdentity` returns `fraudfirst-dev`, then a shell `aws iam get-role --role-name FraudFirstResponseStateMachineRole` returns `NoSuchEntity` (allowed now, role simply not created yet).

After attachment, Task 9B can be re-run **as-is** (scripts in `C:\Users\vinod\AppData\Local\Temp\opencode\fraudfirst-task9b\`): it will create the role, attach the exact bridge-only grant, create the STANDARD machine from `aws/response-workflow/state-machine.json`, set `FRAUDFIRST_STEP_FUNCTIONS_STATE_MACHINE_ARN` in `.env.local`, and run the synthetic `FF-20260919-TEST` chain.

## 7. Notes / limitations

- Policy name `FraudFirstStepFunctionsDeploy` is a suggestion; any name works.
- The exact Task 9B role-verification script also calls `iam:ListRolePolicies` for a zero-diff reuse check. If you want that exact step too, add `"iam:ListRolePolicies"` to the `ManageFraudFirstResponseExecutionRole` statement (same role resource). It is omitted here because the task's defined minimal requirement set is `GetRole`/`CreateRole`/`PutRolePolicy`/`GetRolePolicy`, which is sufficient for the create-fresh flow (we already know the inline policy name `InvokeFraudFirstResponseBridge`).
- Retained blocker, verbatim: "Real Bedrock validation remains blocked by the AWS account/service-side ValidationException: Operation not allowed for Nova 2 Lite in us-east-1."

**Stop condition honored:** no transfer or creation of AWS resources, no destructive operations, Task 9B deployment not run, Task 10 not started.