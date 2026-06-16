import type { FlueContext } from "@flue/runtime";

import issueTriageAgent from "../agents/issue-triage.ts";
import { runIssueTriageEval } from "../lib/issue-triage-eval.ts";

type Env = {
  FLUE_TRIAGE_EVAL_MODEL?: string;
  FLUE_TRIAGE_MODEL?: string;
};

export async function run({ init, payload }: FlueContext<unknown, Env>) {
  return runIssueTriageEval(init, payload, issueTriageAgent);
}
