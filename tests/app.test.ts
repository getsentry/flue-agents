import assert from "node:assert/strict";
import test, { mock } from "node:test";

type FlueCall = {
  body: string;
  env: unknown;
  method: string;
  pathname: string;
  search: string;
};

const flueCalls: FlueCall[] = [];

mock.module("@flue/runtime/routing", {
  namedExports: {
    flue: () => ({
      fetch: async (request: Request, env: unknown) => {
        const url = new URL(request.url);
        flueCalls.push({
          body: request.method === "GET" ? "" : await request.clone().text(),
          env,
          method: request.method,
          pathname: url.pathname,
          search: url.search,
        });

        return Response.json(
          {
            accepted: true,
            runId: "workflow:issue-triage:test",
          },
          { status: url.pathname.startsWith("/workflows/") ? 202 : 200 },
        );
      },
    }),
  },
});

const { default: app } = await import("../src/app.ts");

function createDeliveryClaimsNamespace() {
  const claimed = new Set<string>();

  return {
    idFromName: (name: string) => name,
    get: (id: string) => ({
      fetch: async () => {
        if (claimed.has(id)) {
          return new Response(null, { status: 409 });
        }

        claimed.add(id);
        return new Response(null, { status: 201 });
      },
    }),
  };
}

function resetFlueCalls() {
  flueCalls.length = 0;
}

function appFetch(
  pathname: string,
  init?: RequestInit,
  env?: Record<string, unknown>,
) {
  return app.fetch(
    new Request(`https://example.com${pathname}`, init),
    env,
    undefined,
  );
}

async function parseJson(response: Response) {
  return JSON.parse(await response.text());
}

function bytesToHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function signGitHubWebhook(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return `sha256=${bytesToHex(signature)}`;
}

function issueWebhookPayload(overrides: Record<string, unknown> = {}) {
  return {
    action: "opened",
    installation: { id: 12345 },
    issue: { number: 1059 },
    repository: { full_name: "getsentry/sentry-mcp" },
    ...overrides,
  };
}

async function signedWebhookRequest(
  payload: unknown,
  options: {
    event?: string;
    secret?: string;
    signature?: string;
  } = {},
) {
  const secret = options.secret ?? "webhook-secret";
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Delivery": "delivery-id-1",
      "X-GitHub-Event": options.event ?? "issues",
      "X-Hub-Signature-256":
        options.signature ?? (await signGitHubWebhook(secret, body)),
    },
    body,
  };
}

test("serves robots.txt without Flue authorization", async () => {
  resetFlueCalls();

  const getResponse = await appFetch("/robots.txt", { method: "GET" });
  assert.equal(getResponse.status, 200);
  assert.equal(await getResponse.text(), "User-agent: *\nDisallow: /\n");

  const headResponse = await appFetch("/robots.txt", { method: "HEAD" });
  assert.equal(headResponse.status, 200);
  assert.equal(await headResponse.text(), "");
  assert.equal(flueCalls.length, 0);
});

test("rejects unauthenticated direct Flue routes", async () => {
  resetFlueCalls();

  for (const [method, pathname] of [
    ["POST", "/workflows/issue-triage"],
    ["GET", "/agents/issue-triage/session-1"],
    ["GET", "/runs/workflow%3Aissue-triage%3Atest"],
    ["GET", "/openapi.json"],
  ] as const) {
    const response = await appFetch(pathname, { method });
    assert.equal(response.status, 401, `${method} ${pathname}`);
    assert.deepEqual(await parseJson(response), { error: "unauthorized" });
  }

  assert.equal(flueCalls.length, 0);
});

test("allows direct Flue routes with internal authorization", async () => {
  resetFlueCalls();

  const response = await appFetch(
    "/workflows/issue-triage",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer internal-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ repository: "getsentry/sentry-mcp", issueNumber: 1 }),
    },
    { FLUE_HTTP_TOKEN: "internal-token" },
  );
  assert.equal(response.status, 202);

  assert.equal(flueCalls.length, 1);
  assert.equal(flueCalls[0]?.pathname, "/workflows/issue-triage");
});

test("rejects webhook requests before admission when secret or signature is invalid", async () => {
  resetFlueCalls();

  const missingSecret = await appFetch(
    "/channels/github/webhook",
    await signedWebhookRequest(issueWebhookPayload()),
    { GITHUB_APP_INSTALLATION_ID: "12345" },
  );
  assert.equal(missingSecret.status, 503);
  assert.deepEqual(await parseJson(missingSecret), {
    error: "github_webhook_secret_not_configured",
  });

  const invalidSignature = await appFetch(
    "/channels/github/webhook",
    await signedWebhookRequest("{invalid-json", {
      signature: "sha256=not-valid",
    }),
    {
      GITHUB_APP_INSTALLATION_ID: "12345",
      GITHUB_WEBHOOK_SECRET: "webhook-secret",
    },
  );
  assert.equal(invalidSignature.status, 401);
  assert.equal(await invalidSignature.text(), "");
  assert.equal(flueCalls.length, 0);
});

test("rejects invalid webhook JSON after signature verification", async () => {
  resetFlueCalls();

  const response = await appFetch(
    "/channels/github/webhook",
    await signedWebhookRequest("{invalid-json"),
    {
      GITHUB_APP_INSTALLATION_ID: "12345",
      GITHUB_WEBHOOK_SECRET: "webhook-secret",
    },
  );

  assert.equal(response.status, 400);
  assert.equal(await response.text(), "");
  assert.equal(flueCalls.length, 0);
});

test("rejects non-object signed webhook JSON as malformed payload", async () => {
  resetFlueCalls();

  const response = await appFetch(
    "/channels/github/webhook",
    await signedWebhookRequest("null"),
    {
      GITHUB_APP_INSTALLATION_ID: "12345",
      GITHUB_WEBHOOK_SECRET: "webhook-secret",
    },
  );

  assert.equal(response.status, 400);
  assert.equal(await response.text(), "");
  assert.equal(flueCalls.length, 0);
});

test("accepts GitHub ping internally without admitting workflow runs", async () => {
  resetFlueCalls();

  const response = await appFetch(
    "/channels/github/webhook",
    await signedWebhookRequest({ zen: "Keep it logically awesome." }, { event: "ping" }),
    {
      GITHUB_APP_INSTALLATION_ID: "12345",
      GITHUB_WEBHOOK_SECRET: "webhook-secret",
    },
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
  assert.equal(flueCalls.length, 0);
});

test("ignores unsupported signed webhook events without admitting workflow runs", async () => {
  resetFlueCalls();

  const unsupportedEvent = await appFetch(
    "/channels/github/webhook",
    await signedWebhookRequest(issueWebhookPayload(), { event: "pull_request" }),
    {
      GITHUB_APP_INSTALLATION_ID: "12345",
      GITHUB_WEBHOOK_SECRET: "webhook-secret",
    },
  );
  assert.equal(unsupportedEvent.status, 202);
  assert.deepEqual(await parseJson(unsupportedEvent), {
    ok: true,
    ignored: "unsupported_event",
  });

  const unsupportedAction = await appFetch(
    "/channels/github/webhook",
    await signedWebhookRequest(issueWebhookPayload({ action: "edited" })),
    {
      GITHUB_APP_INSTALLATION_ID: "12345",
      GITHUB_WEBHOOK_SECRET: "webhook-secret",
    },
  );
  assert.equal(unsupportedAction.status, 202);
  assert.deepEqual(await parseJson(unsupportedAction), {
    ok: true,
    ignored: "unsupported_issue_action",
  });

  const pullRequestIssue = await appFetch(
    "/channels/github/webhook",
    await signedWebhookRequest(
      issueWebhookPayload({
        issue: {
          number: 1059,
          pull_request: {},
        },
      }),
    ),
    {
      GITHUB_APP_INSTALLATION_ID: "12345",
      GITHUB_WEBHOOK_SECRET: "webhook-secret",
    },
  );
  assert.equal(pullRequestIssue.status, 202);
  assert.deepEqual(await parseJson(pullRequestIssue), {
    ok: true,
    ignored: "pull_request_issue",
  });

  assert.equal(flueCalls.length, 0);
});

test("rejects malformed or unexpected-installation issue webhooks", async () => {
  resetFlueCalls();

  const malformed = await appFetch(
    "/channels/github/webhook",
    await signedWebhookRequest(issueWebhookPayload({ issue: {} })),
    {
      GITHUB_APP_INSTALLATION_ID: "12345",
      GITHUB_WEBHOOK_SECRET: "webhook-secret",
    },
  );
  assert.equal(malformed.status, 400);
  assert.deepEqual(await parseJson(malformed), { error: "invalid_issue_payload" });

  const invalidIssueNumber = await appFetch(
    "/channels/github/webhook",
    await signedWebhookRequest(issueWebhookPayload({ issue: { number: 1.5 } })),
    {
      GITHUB_APP_INSTALLATION_ID: "12345",
      GITHUB_WEBHOOK_SECRET: "webhook-secret",
    },
  );
  assert.equal(invalidIssueNumber.status, 400);
  assert.deepEqual(await parseJson(invalidIssueNumber), {
    error: "invalid_issue_payload",
  });

  const unexpectedInstallation = await appFetch(
    "/channels/github/webhook",
    await signedWebhookRequest(
      issueWebhookPayload({ installation: { id: 99999 } }),
    ),
    {
      GITHUB_APP_INSTALLATION_ID: "12345",
      GITHUB_WEBHOOK_SECRET: "webhook-secret",
    },
  );
  assert.equal(unexpectedInstallation.status, 403);
  assert.deepEqual(await parseJson(unexpectedInstallation), {
    error: "unexpected_github_installation",
  });

  assert.equal(flueCalls.length, 0);
});

test("admits signed issues.opened webhooks to the issue-triage workflow", async () => {
  resetFlueCalls();
  const env = {
    GITHUB_APP_INSTALLATION_ID: "12345",
    GITHUB_WEBHOOK_DELIVERY_CLAIMS: createDeliveryClaimsNamespace(),
    GITHUB_WEBHOOK_SECRET: "webhook-secret",
  };

  const response = await appFetch(
    "/channels/github/webhook",
    await signedWebhookRequest(issueWebhookPayload()),
    env,
  );

  assert.equal(response.status, 202);
  assert.deepEqual(await parseJson(response), {
    accepted: true,
    runId: "workflow:issue-triage:test",
  });
  assert.equal(flueCalls.length, 1);
  assert.equal(flueCalls[0]?.body, JSON.stringify({
    issueNumber: 1059,
    repository: "getsentry/sentry-mcp",
  }));
  const workflowEnv = flueCalls[0]?.env as Record<string, unknown>;
  assert.equal(workflowEnv.GITHUB_APP_INSTALLATION_ID, "12345");
  assert.equal(workflowEnv.GITHUB_WEBHOOK_SECRET, "webhook-secret");
  assert.equal(typeof workflowEnv.GITHUB_WEBHOOK_DELIVERY_CLAIMS, "object");
  assert.equal(flueCalls[0]?.method, "POST");
  assert.equal(flueCalls[0]?.pathname, "/workflows/issue-triage");
  assert.equal(flueCalls[0]?.search, "");
});

test("deduplicates GitHub redeliveries before admitting workflow runs", async () => {
  resetFlueCalls();
  const claims = createDeliveryClaimsNamespace();
  const request = await signedWebhookRequest(issueWebhookPayload());
  const env = {
    GITHUB_APP_INSTALLATION_ID: "12345",
    GITHUB_WEBHOOK_DELIVERY_CLAIMS: claims,
    GITHUB_WEBHOOK_SECRET: "webhook-secret",
  };

  const first = await appFetch("/channels/github/webhook", request, env);
  assert.equal(first.status, 202);

  const second = await appFetch("/channels/github/webhook", request, env);
  assert.equal(second.status, 202);
  assert.deepEqual(await parseJson(second), {
    ok: true,
    ignored: "duplicate_delivery",
  });
  assert.equal(flueCalls.length, 1);
});
