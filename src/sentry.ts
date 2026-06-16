// Bridges selected Flue runtime activity to Sentry. The bridge captures fatal
// workflow results and explicit error logs with correlation tags only; it does
// not forward arbitrary Flue event payloads or log attributes.
import { observe, type FlueEvent } from "@flue/runtime";
import * as Sentry from "@sentry/cloudflare";

function toError(value: unknown, fallback: string): Error {
  if (value instanceof Error) {
    return value;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const message =
      typeof record.message === "string" && record.message
        ? record.message
        : fallback;
    const error = new Error(message);

    if (typeof record.name === "string" && record.name) {
      error.name = record.name;
    }

    return error;
  }

  return new Error(value === undefined ? fallback : String(value));
}

function setTag(scope: Sentry.Scope, key: string, value: unknown) {
  if (value === undefined || value === null || value === "") {
    return;
  }

  scope.setTag(`flue.${key}`, String(value));
}

function captureWithFlueTags(event: FlueEvent, capture: () => void) {
  Sentry.withScope((scope) => {
    setTag(scope, "type", event.type);
    setTag(scope, "run.id", event.runId);
    setTag(scope, "instance.id", event.instanceId);
    setTag(scope, "dispatch.id", event.dispatchId);
    setTag(scope, "event.index", event.eventIndex);
    setTag(scope, "session", event.session);
    setTag(scope, "parent_session", event.parentSession);
    setTag(scope, "harness", event.harness);
    setTag(scope, "operation.id", event.operationId);
    setTag(scope, "turn.id", event.turnId);
    setTag(scope, "task.id", event.taskId);

    if ("workflowName" in event) {
      setTag(scope, "workflow.name", event.workflowName);
    }

    if ("operationKind" in event) {
      setTag(scope, "operation.kind", event.operationKind);
    }

    capture();
  });
}

observe((event) => {
  if (event.type === "run_end" && event.isError) {
    captureWithFlueTags(event, () => {
      Sentry.captureException(toError(event.error, "Flue workflow failed"));
    });
  }

  if (event.type === "log" && event.level === "error") {
    captureWithFlueTags(event, () => {
      if (Object.hasOwn(event.attributes ?? {}, "error")) {
        Sentry.captureException(
          toError(event.attributes?.error, event.message || "Flue error log"),
        );
      } else {
        Sentry.captureMessage(event.message || "Flue error log", "error");
      }
    });
  }
});
