import issueTriage from "../skills/issue-triage/SKILL.md" with { type: "skill" };

import { DEFAULT_ISSUE_TRIAGE_MODEL } from "./issue-triage-model.ts";
import { PIERRE_PERSONALITY } from "./pierre.ts";

type IssueTriageModelEnv = {
  FLUE_TRIAGE_EVAL_MODEL?: string;
  FLUE_TRIAGE_MODEL?: string;
};

export const issueTriageAgentConfig = {
  thinkingLevel: "low" as const,
  cwd: "/workspace",
  skills: [issueTriage],
  instructions: `Triage Sentry GitHub issues carefully. ${PIERRE_PERSONALITY} Use the issue-triage skill for duplicate search, diagnosis, validation, concise additive follow-up comments, and safe closure decisions. Never rewrite reporter-authored issue content.`,
};

export function getIssueTriageModel(env: IssueTriageModelEnv) {
  return (
    env.FLUE_TRIAGE_EVAL_MODEL ??
    env.FLUE_TRIAGE_MODEL ??
    DEFAULT_ISSUE_TRIAGE_MODEL
  );
}
