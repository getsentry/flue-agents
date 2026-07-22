// Owns the issue-triage agent runtime: Flue creates the Durable Object,
// Cloudflare Sandbox provides the workspace, and the module-local extension
// wraps the generated class with Sentry without changing agent behavior.
import type { Sandbox } from "@cloudflare/sandbox";
import { createAgent } from "@flue/runtime";
import { cfSandboxToSessionEnv, extend } from "@flue/runtime/cloudflare";
import * as Sentry from "@sentry/cloudflare";

import {
  getIssueTriageModel,
  issueTriageAgentConfig,
} from "../lib/issue-triage-agent.ts";
import { getSentryOptions, type SentryEnv } from "../lib/sentry";

type Env = SentryEnv & {
  FLUE_TRIAGE_EVAL_MODEL?: string;
  FLUE_TRIAGE_MODEL?: string;
  Sandbox?: DurableObjectNamespace<Sandbox>;
};

export default createAgent<unknown, Env>(({ id, env }) => {
  const sandboxNamespace = env.Sandbox;

  return {
    ...issueTriageAgentConfig,
    model: getIssueTriageModel(env),
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
  };
});

export const cloudflare = extend({
  wrap: (Final) =>
    Sentry.instrumentDurableObjectWithSentry(
      (env: Env) => getSentryOptions(env),
      Final,
    ),
});
