const ISSUE_TRIAGE_MODEL = "openrouter/anthropic/claude-sonnet-4.6";

// Keep production and evals on the same provider and exact model version so
// integration results reflect the deployed agent's behavior.
export const DEFAULT_ISSUE_TRIAGE_MODEL = ISSUE_TRIAGE_MODEL;
export const DEFAULT_ISSUE_TRIAGE_EVAL_MODEL = ISSUE_TRIAGE_MODEL;
