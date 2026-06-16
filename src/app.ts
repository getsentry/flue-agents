import {
  createGitHubChannel,
  type GitHubWebhookDelivery,
} from "@flue/github";
import { flue, type Fetchable } from "@flue/runtime/routing";
import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";

import "./sentry.ts";
import { getSentryOptions, type SentryEnv } from "./lib/sentry.ts";

// Owns public Worker ingress: robots.txt, signed GitHub webhook admission,
// and operator-only access to Flue's generated routes.
const flueApp = flue();
const robotsTxt = "User-agent: *\nDisallow: /\n";
const githubWebhookPaths = new Set([
  "/channels/github/webhook",
  "/github/webhook",
]);

type Env = SentryEnv & {
  FLUE_HTTP_TOKEN?: string;
  GITHUB_APP_INSTALLATION_ID?: string;
  GITHUB_WEBHOOK_DELIVERY_CLAIMS?: DurableObjectNamespace;
  GITHUB_WEBHOOK_SECRET?: string;
};

type GithubChannelEnv = {
  Bindings: Env;
};

type GitHubIssuesDelivery = Extract<GitHubWebhookDelivery, { name: "issues" }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Reads string Worker bindings while treating absent values as unconfigured. */
function readEnvString(env: unknown, key: keyof Env) {
  if (!isRecord(env)) {
    return "";
  }

  const value = env[key];
  return typeof value === "string" ? value.trim() : "";
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

/** Constant-time comparison for internal bearer tokens. */
function constantTimeEqual(a: string, b: string) {
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);

  for (let i = 0; i < length; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }

  return diff === 0;
}

/** Flue-generated HTTP routes are operator-only in this Worker. */
function protectedFlueRoute(pathname: string) {
  return (
    pathname === "/openapi.json" ||
    pathname.startsWith("/agents/") ||
    pathname.startsWith("/workflows/") ||
    pathname.startsWith("/runs/")
  );
}

/** Authorizes manual/operator calls into Flue's generated route surface. */
function authorizedFlueRequest(request: Request, env: Env) {
  const token = readEnvString(env, "FLUE_HTTP_TOKEN");
  if (!token) {
    return false;
  }

  const authorization = request.headers.get("Authorization")?.trim() ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";

  return constantTimeEqual(token, bearer);
}

/** Converts a verified GitHub issues delivery into workflow input. */
function parseIssueWebhookPayload(payload: GitHubIssuesDelivery["payload"]) {
  const repositoryPayload = payload.repository;
  const issuePayload = payload.issue;
  const installationPayload = payload.installation;
  const action = typeof payload.action === "string" ? payload.action : "";
  const repository =
    isRecord(repositoryPayload) && typeof repositoryPayload.full_name === "string"
      ? repositoryPayload.full_name
      : "";
  const issueNumber =
    isRecord(issuePayload) &&
    typeof issuePayload.number === "number" &&
    Number.isSafeInteger(issuePayload.number) &&
    issuePayload.number > 0
      ? issuePayload.number
      : 0;
  const installationId =
    isRecord(installationPayload) &&
    (typeof installationPayload.id === "number" ||
      typeof installationPayload.id === "string")
      ? String(installationPayload.id)
      : "";

  if (!action || !repository || !issueNumber || !installationId) {
    return null;
  }

  return {
    action,
    installationId,
    isPullRequest:
      isRecord(issuePayload) && issuePayload.pull_request !== undefined,
    issueNumber,
    repository,
  };
}

/** Claims a GitHub delivery id before admitting retryable workflow work. */
async function claimGitHubDelivery(env: Env, deliveryId: string) {
  const namespace = env.GITHUB_WEBHOOK_DELIVERY_CLAIMS;
  if (!namespace) {
    return "unconfigured";
  }

  const id = namespace.idFromName(deliveryId);
  const response = await namespace.get(id).fetch("https://internal/claim", {
    method: "PUT",
  });

  if (response.status === 201) {
    return "claimed";
  }

  if (response.status === 409) {
    return "duplicate";
  }

  return "failed";
}

/** Dispatches issue triage through Flue's durable workflow route. */
async function invokeIssueTriageWorkflow(
  request: Request,
  env: Env,
  ctx: ExecutionContext | undefined,
  payload: { issueNumber: number; repository: string },
) {
  const url = new URL("/workflows/issue-triage", request.url);
  return flueApp.fetch(
    new Request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }),
    env,
    ctx,
  );
}

/** Applies app policy after @flue/github verifies the delivery. */
async function handleGitHubDelivery(
  request: Request,
  env: Env,
  ctx: ExecutionContext | undefined,
  delivery: GitHubWebhookDelivery,
) {
  if (delivery.name !== "issues") {
    return json({ ok: true, ignored: "unsupported_event" }, 202);
  }

  const issueEvent = parseIssueWebhookPayload(delivery.payload);
  if (!issueEvent) {
    return json({ error: "invalid_issue_payload" }, 400);
  }

  const expectedInstallationId = readEnvString(env, "GITHUB_APP_INSTALLATION_ID");
  if (!expectedInstallationId) {
    return json({ error: "github_app_installation_not_configured" }, 503);
  }

  if (issueEvent.installationId !== expectedInstallationId) {
    return json({ error: "unexpected_github_installation" }, 403);
  }

  if (issueEvent.isPullRequest) {
    return json({ ok: true, ignored: "pull_request_issue" }, 202);
  }

  if (issueEvent.action !== "opened") {
    return json({ ok: true, ignored: "unsupported_issue_action" }, 202);
  }

  const claim = await claimGitHubDelivery(env, delivery.deliveryId);
  if (claim === "duplicate") {
    return json({ ok: true, ignored: "duplicate_delivery" }, 202);
  }

  if (claim === "unconfigured") {
    return json({ error: "github_delivery_claims_not_configured" }, 503);
  }

  if (claim === "failed") {
    return json({ error: "github_delivery_claim_failed" }, 503);
  }

  return invokeIssueTriageWorkflow(request, env, ctx, {
    issueNumber: issueEvent.issueNumber,
    repository: issueEvent.repository,
  });
}

/**
 * Mounts the documented Flue GitHub channel route under app-owned auth policy.
 * The compatibility `/github/webhook` URL is accepted while setup docs move to
 * `/channels/github/webhook`.
 */
async function handleGitHubWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext | undefined,
) {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const secret = readEnvString(env, "GITHUB_WEBHOOK_SECRET");
  if (!secret) {
    return json({ error: "github_webhook_secret_not_configured" }, 503);
  }

  const channel = createGitHubChannel<GithubChannelEnv>({
    webhookSecret: secret,
    webhook: ({ delivery }) => handleGitHubDelivery(request, env, ctx, delivery),
  });

  const route = channel.routes[0];
  const channelApp = new Hono<GithubChannelEnv>();
  channelApp.on("POST", route.path, route.handler);

  return channelApp.fetch(
    new Request(new URL("/webhook", request.url), request),
    env,
  );
}

const app: Fetchable = {
  fetch(request, env, ctx) {
    const url = new URL(request.url);
    const workerEnv = (env ?? {}) as Env;
    const executionCtx = ctx as ExecutionContext | undefined;

    if (
      url.pathname === "/robots.txt" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      return new Response(request.method === "HEAD" ? null : robotsTxt, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }

    if (githubWebhookPaths.has(url.pathname)) {
      return handleGitHubWebhook(request, workerEnv, executionCtx);
    }

    if (
      protectedFlueRoute(url.pathname) &&
      !authorizedFlueRequest(request, workerEnv)
    ) {
      return json({ error: "unauthorized" }, 401);
    }

    return flueApp.fetch(request, workerEnv, executionCtx);
  },
};

export default Sentry.withSentry((env: Env) => getSentryOptions(env), app);
