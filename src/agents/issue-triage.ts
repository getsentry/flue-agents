// Owns the issue-triage agent runtime: Flue creates the Durable Object,
// Cloudflare Sandbox provides the workspace, and the module-local extension
// wraps the generated class with Sentry without changing agent behavior.
import type { Sandbox } from "@cloudflare/sandbox";
import { createAgent } from "@flue/runtime";
import { cfSandboxToSessionEnv, extend } from "@flue/runtime/cloudflare";
import * as Sentry from "@sentry/cloudflare";

import { PIERRE_PERSONALITY } from "../lib/pierre.ts";
import { DEFAULT_ISSUE_TRIAGE_MODEL } from "../lib/issue-triage-model.ts";
import { getSentryOptions, type SentryEnv } from "../lib/sentry";
import issueTriage from "../skills/issue-triage/SKILL.md" with { type: "skill" };

type Env = SentryEnv & {
  FLUE_TRIAGE_EVAL_MODEL?: string;
  FLUE_TRIAGE_MODEL?: string;
  Sandbox?: DurableObjectNamespace<Sandbox>;
};

export default createAgent<unknown, Env>(({ id, env }) => {
  const sandboxNamespace = env.Sandbox;

  return {
    model:
      env.FLUE_TRIAGE_EVAL_MODEL ??
      env.FLUE_TRIAGE_MODEL ??
      DEFAULT_ISSUE_TRIAGE_MODEL,
    thinkingLevel: "low",
    cwd: "/workspace",
    sandbox: sandboxNamespace
      ? {
          createSessionEnv: async () => {
            const { getSandbox } = await import("@cloudflare/sandbox");
            return cfSandboxToSessionEnv(
              getSandbox(sandboxNamespace, id),
              "/workspace",
            );
          },
        }
      : undefined,
    skills: [issueTriage],
    instructions: `Triage Sentry GitHub issues carefully. ${PIERRE_PERSONALITY} Use the issue-triage skill for duplicate search, diagnosis, validation, concise additive follow-up comments, and safe closure decisions. Never rewrite reporter-authored issue content.`,
  };
});

export const cloudflare = extend({
  wrap: (Final) =>
    Sentry.instrumentDurableObjectWithSentry(
      (env: Env) => getSentryOptions(env),
      Final,
    ),
});
