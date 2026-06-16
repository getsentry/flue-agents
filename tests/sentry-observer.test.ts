import assert from "node:assert/strict";
import test, { mock } from "node:test";

type ObservedEvent = {
  attributes?: Record<string, unknown>;
  dispatchId?: string;
  eventIndex?: number;
  error?: unknown;
  instanceId?: string;
  isError?: boolean;
  level?: string;
  message?: string;
  operationId?: string;
  runId?: string;
  session?: string;
  type: string;
  workflowName?: string;
};

type SentryCapture = {
  error?: Error;
  message?: string;
  scope: Record<string, string>;
};

let observed:
  | ((event: ObservedEvent, ctx?: unknown) => void | Promise<void>)
  | undefined;
const exceptions: SentryCapture[] = [];
const messages: SentryCapture[] = [];
let activeScope: Record<string, string> | undefined;

mock.module("@flue/runtime", {
  namedExports: {
    observe: (
      subscriber: (event: ObservedEvent, ctx?: unknown) => void | Promise<void>,
    ) => {
      observed = subscriber;
      return () => {
        observed = undefined;
      };
    },
  },
});

mock.module("@sentry/cloudflare", {
  namedExports: {
    captureException: (error: Error) => {
      exceptions.push({ error, scope: { ...(activeScope ?? {}) } });
    },
    captureMessage: (message: string) => {
      messages.push({ message, scope: { ...(activeScope ?? {}) } });
    },
    withScope: (callback: (scope: { setTag: (key: string, value: string) => void }) => void) => {
      const previousScope = activeScope;
      activeScope = {};
      callback({
        setTag: (key, value) => {
          activeScope![key] = value;
        },
      });
      activeScope = previousScope;
    },
  },
});

await import("../src/sentry.ts");

function resetCaptures() {
  exceptions.length = 0;
  messages.length = 0;
}

test("captures failed workflow run_end events with Flue tags", () => {
  resetCaptures();

  observed?.({
    error: { message: "workflow exploded", name: "WorkflowError" },
    eventIndex: 7,
    instanceId: "workflow-instance",
    isError: true,
    runId: "workflow:issue-triage:abc",
    type: "run_end",
  });

  assert.equal(exceptions.length, 1);
  assert.equal(exceptions[0].error?.name, "WorkflowError");
  assert.equal(exceptions[0].error?.message, "workflow exploded");
  assert.deepEqual(exceptions[0].scope, {
    "flue.event.index": "7",
    "flue.instance.id": "workflow-instance",
    "flue.run.id": "workflow:issue-triage:abc",
    "flue.type": "run_end",
  });
  assert.equal(messages.length, 0);
});

test("captures explicit Flue error logs without forwarding arbitrary attributes", () => {
  resetCaptures();
  const error = new Error("log failure");

  observed?.({
    attributes: {
      error,
      token: "do-not-forward",
    },
    dispatchId: "delivery-1",
    instanceId: "agent-instance",
    level: "error",
    message: "Issue triage failed",
    operationId: "operation-1",
    session: "default",
    type: "log",
  });

  assert.equal(exceptions.length, 1);
  assert.equal(exceptions[0].error, error);
  assert.deepEqual(exceptions[0].scope, {
    "flue.dispatch.id": "delivery-1",
    "flue.instance.id": "agent-instance",
    "flue.operation.id": "operation-1",
    "flue.session": "default",
    "flue.type": "log",
  });
  assert.equal(messages.length, 0);
});

test("captures Flue error logs without error attributes as messages", () => {
  resetCaptures();

  observed?.({
    attributes: {
      reason: "still-not-forwarded",
    },
    level: "error",
    message: "Manual operator error",
    runId: "workflow:issue-triage:def",
    type: "log",
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].message, "Manual operator error");
  assert.deepEqual(messages[0].scope, {
    "flue.run.id": "workflow:issue-triage:def",
    "flue.type": "log",
  });
  assert.equal(exceptions.length, 0);
});
