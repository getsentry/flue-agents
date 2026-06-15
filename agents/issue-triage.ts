import { getSandbox, type Sandbox } from "@cloudflare/sandbox";
import { createAgent, type AgentRouteHandler } from "@flue/runtime";
import { cfSandboxToSessionEnv } from "@flue/runtime/cloudflare";

import issueTriage from "../skills/issue-triage/SKILL.md" with { type: "skill" };

type Env = {
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
