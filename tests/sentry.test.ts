import assert from "node:assert/strict";
import test from "node:test";

import { getSentryOptions } from "../src/lib/sentry.ts";

test("disables Sentry when DSN is empty", () => {
  const options = getSentryOptions({ SENTRY_DSN: " " });

  assert.equal(options.dsn, undefined);
  assert.equal(options.enabled, false);
  assert.equal(options.tracesSampleRate, 0.1);
});

test("enables Sentry and forwards metadata when DSN is configured", () => {
  const options = getSentryOptions({
    SENTRY_DSN: "https://public@example.com/1",
    SENTRY_ENVIRONMENT: "production",
    SENTRY_RELEASE: "abc123",
    SENTRY_TRACES_SAMPLE_RATE: "0.25",
  });

  assert.equal(options.dsn, "https://public@example.com/1");
  assert.equal(options.enabled, true);
  assert.equal(options.environment, "production");
  assert.equal(options.release, "abc123");
  assert.equal(options.tracesSampleRate, 0.25);
  assert.equal(options.enableLogs, true);
  assert.equal(options.enableRpcTracePropagation, true);
});

test("defaults and clamps invalid sample rates", () => {
  assert.equal(
    getSentryOptions({ SENTRY_TRACES_SAMPLE_RATE: "not-a-number" })
      .tracesSampleRate,
    0.1,
  );
  assert.equal(
    getSentryOptions({ SENTRY_TRACES_SAMPLE_RATE: "-1" }).tracesSampleRate,
    0,
  );
  assert.equal(
    getSentryOptions({ SENTRY_TRACES_SAMPLE_RATE: "2" }).tracesSampleRate,
    1,
  );
});
