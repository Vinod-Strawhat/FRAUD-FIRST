import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  buildResponsePlan,
  completeResponseAction,
} from "../src/services/response/orchestrator";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

function readSource(rel: string): string {
  return readFileSync(path.join(repoRoot, rel), "utf8");
}

const STARTED_AT = "2026-09-20T10:00:00.000Z";

test("a persisted/running response plan never contains a TaskToken", () => {
  const plan = buildResponsePlan("FF-20260920-TEST", STARTED_AT);
  const serialized = JSON.stringify(plan);
  assert.ok(!serialized.includes("taskToken"));
  assert.ok(!serialized.includes("TaskToken"));
});

test("a completed response plan never contains a TaskToken", () => {
  let plan = buildResponsePlan("FF-20260920-TEST", STARTED_AT);
  for (const action of plan.actions) {
    const result = completeResponseAction(plan, action.id, "2026-09-20T11:00:00.000Z");
    assert.equal(result.ok, true);
    if (result.ok) plan = result.next;
  }
  const serialized = JSON.stringify(plan);
  assert.ok(!serialized.includes("taskToken"));
  assert.ok(!serialized.includes("TaskToken"));
});

test("the enriched API view exposes only incident/action metadata (no token)", () => {
  const plan = buildResponsePlan("FF-20260920-TEST", STARTED_AT);
  const view = {
    status: plan.status,
    startedAt: plan.startedAt,
    updatedAt: plan.updatedAt,
    currentActionType: plan.currentActionType,
    executionArn: plan.executionArn,
    actions: plan.actions,
  };
  const serialized = JSON.stringify(view);
  assert.ok(!serialized.includes("taskToken"));
  assert.ok(!serialized.includes("TaskToken"));
  assert.ok(!serialized.includes("sf-token-"));
});

test("the browser-facing client service never touches a task token", async () => {
  const clientService = readSource("src/services/response/index.ts");
  assert.ok(!clientService.includes("taskToken"));
  assert.ok(!clientService.includes("TaskToken"));
  assert.ok(!clientService.includes("@aws-sdk"));
});

test("the response type surfaces no task token field to the client", () => {
  const typesSource = readSource("src/types/response.ts");
  assert.ok(!typesSource.includes("taskToken"));
  assert.ok(!typesSource.includes("TaskToken"));
});

test("no API route returns a task token in its response body", () => {
  const routes = [
    "src/app/api/incidents/[id]/response/route.ts",
    "src/app/api/incidents/[id]/response/start/route.ts",
    "src/app/api/incidents/[id]/response/actions/[actionId]/complete/route.ts",
  ];
  for (const route of routes) {
    const source = readSource(route);
    assert.ok(!source.includes("taskToken"), `${route} must not expose a task token`);
    assert.ok(!source.includes("TaskToken"), `${route} must not expose a TaskToken`);
  }
});

test("the response view component never references a raw task token", () => {
  for (const rel of [
    "src/components/incident/response-plan.tsx",
    "src/hooks/use-response-plan.ts",
  ]) {
    const source = readSource(rel);
    assert.ok(!source.includes("taskToken"), `${rel} must not reference a task token`);
    assert.ok(!source.includes("TaskToken"), `${rel} must not reference a TaskToken`);
  }
});