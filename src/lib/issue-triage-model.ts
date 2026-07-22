const ISSUE_TRIAGE_MODEL_ID = "moonshotai/kimi-k2.6";

// Production uses the Worker AI binding. Node-based evals use OpenRouter, but
// keep the underlying model and version identical to production.
export const DEFAULT_ISSUE_TRIAGE_MODEL =
  `cloudflare/@cf/${ISSUE_TRIAGE_MODEL_ID}`;
export const DEFAULT_ISSUE_TRIAGE_EVAL_MODEL =
  `openrouter/${ISSUE_TRIAGE_MODEL_ID}`;
