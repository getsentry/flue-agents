// Owns the issue-triage agent runtime: Flue creates the Durable Object,
// Cloudflare Sandbox provides the workspace, and the module-local extension
// wraps the generated class with Sentry without changing agent behavior.
import { getSandbox, type Sandbox } from "@cloudflare/sandbox";
import { createAgent, type AgentRouteHandler } from "@flue/runtime";
import { cfSandboxToSessionEnv, extend } from "@flue/runtime/cloudflare";
import * as Sentry from "@sentry/cloudflare";

import { getSentryOptions, type SentryEnv } from "../lib/sentry";
import issueTriage from "../skills/issue-triage/SKILL.md" with { type: "skill" };

type Env = SentryEnv & {
  FLUE_TRIAGE_MODEL?: string;
  Sandbox: DurableObjectNamespace<Sandbox>;
};

export const route: AgentRouteHandler = async (_c, next) => next();

export default createAgent<unknown, Env>(({ id, env }) => ({
  model: env.FLUE_TRIAGE_MODEL ?? "cloudflare/@cf/moonshotai/kimi-k2.6",
  cwd: "/workspace",
  sandbox: {
    createSessionEnv: () =>
      cfSandboxToSessionEnv(getSandbox(env.Sandbox, id), "/workspace"),
  },
  skills: [issueTriage],
  instructions:
    "Triage Sentry GitHub issues carefully. Use the issue-triage skill for duplicate search, diagnosis, validation, concise issue updates, and safe closure decisions.",
}));

export const cloudflare = extend({
  wrap: (Final) =>
    Sentry.instrumentDurableObjectWithSentry(
      (env: Env) => getSentryOptions(env),
      Final,
    ),
});
