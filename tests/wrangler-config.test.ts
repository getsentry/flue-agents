import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("exports Cloudflare Worker logs to the Sentry observability destination", async () => {
  const config = JSON.parse(await readFile("wrangler.jsonc", "utf8"));

  assert.equal(config.observability?.logs?.enabled, true);
  assert.ok(
    config.observability?.logs?.destinations?.includes("sentry-pierre-logs"),
  );
});
