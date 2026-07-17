import * as v from "valibot";

export const severitySchema = v.picklist(["low", "medium", "high", "critical"]);
export const categorySchema = v.picklist([
  "bug",
  "documentation",
  "feature_request",
  "support",
  "security",
  "maintenance",
  "unknown",
]);
export const dispositionSchema = v.picklist([
  "actionable",
  "needs_more_info",
  "low_actionability",
  "impractical_scope",
  "spam",
  "unclear",
]);
export const followupKindSchema = v.picklist([
  "technical_diagnosis",
  "scope_clarification",
  "missing_info_request",
]);
export const closeReasonSchema = v.picklist(["not planned"]);

const sourceReferenceSchema = v.object({
  path: v.string(),
  line: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  symbol: v.optional(v.string()),
});

const analysisEvidenceSchema = v.object({
  source: v.picklist(["reporter", "source", "command", "history", "inference"]),
  claim: v.string(),
  reference: v.optional(v.string()),
});

export const bugAnalysisSchema = v.object({
  observed: v.string(),
  expected: v.string(),
  reproduction: v.object({
    status: v.picklist(["reproduced", "not_reproduced", "not_attempted"]),
    details: v.string(),
  }),
  trigger: v.nullable(v.string()),
  affected_locations: v.array(sourceReferenceSchema),
  causal_chain: v.array(v.string()),
  root_cause: v.nullable(v.string()),
  evidence: v.array(analysisEvidenceSchema),
  alternatives_considered: v.array(v.string()),
  fix_direction: v.nullable(v.string()),
  validation: v.array(v.string()),
  confidence: v.picklist(["low", "medium", "high"]),
});

export const gapAnalysisSchema = v.object({
  current_capability: v.string(),
  desired_outcome: v.string(),
  gap: v.string(),
  affected_users: v.nullable(v.array(v.string())),
  workaround: v.nullable(v.string()),
  acceptance_criteria: v.array(v.string()),
  constraints: v.array(v.string()),
  smallest_viable_slice: v.nullable(v.string()),
  decision_type: v.picklist([
    "implementation",
    "documentation",
    "product",
    "support",
    "non_goal",
  ]),
  evidence: v.array(analysisEvidenceSchema),
});

export const issueTriageDiagnosisSchema = v.pipe(
  v.intersect([
    v.object({
      severity: severitySchema,
      category: categorySchema,
      disposition: dispositionSchema,
      validity: v.picklist([
        "confirmed",
        "likely",
        "not_reproducible",
        "unclear",
      ]),
      summary: v.string(),
      evidence: v.array(v.string()),
      bug_analysis: v.optional(bugAnalysisSchema),
      gap_analysis: v.optional(gapAnalysisSchema),
      labels_to_apply: v.array(v.string()),
      followup_kind: v.optional(followupKindSchema),
      followup_rationale: v.optional(v.pipe(v.string(), v.trim())),
      followup_comment: v.optional(v.pipe(v.string(), v.trim())),
      close_comment: v.optional(v.string()),
      needs_human_review: v.boolean(),
    }),
    v.variant("should_close", [
      v.object({
        should_close: v.literal(true),
        close_reason: closeReasonSchema,
      }),
      v.object({
        should_close: v.literal(false),
        close_reason: v.optional(closeReasonSchema),
      }),
    ]),
  ]),
  v.transform((diagnosis) => {
    if (
      diagnosis.followup_kind !== undefined &&
      diagnosis.followup_rationale &&
      diagnosis.followup_comment
    ) {
      return diagnosis;
    }

    const normalized = { ...diagnosis };
    delete normalized.followup_kind;
    delete normalized.followup_rationale;
    delete normalized.followup_comment;
    return normalized;
  }),
);

export type IssueTriageDiagnosis = v.InferOutput<typeof issueTriageDiagnosisSchema>;

const GAP_CATEGORIES = new Set([
  "documentation",
  "feature_request",
  "support",
  "maintenance",
]);

export function assertDiagnosisAnalysis(diagnosis: IssueTriageDiagnosis) {
  if (
    ["confirmed", "likely"].includes(diagnosis.validity) &&
    diagnosis.evidence.filter((item) => item.trim()).length === 0
  ) {
    throw new Error(`${diagnosis.validity} diagnoses require evidence.`);
  }

  if (diagnosis.category === "bug" && !diagnosis.bug_analysis) {
    throw new Error("Bug diagnoses require bug_analysis.");
  }

  if (
    diagnosis.category === "bug" &&
    diagnosis.validity === "confirmed" &&
    (!diagnosis.bug_analysis?.root_cause?.trim() ||
      diagnosis.bug_analysis.causal_chain.length === 0 ||
      diagnosis.bug_analysis.evidence.length === 0)
  ) {
    throw new Error(
      "Confirmed bugs require a root cause, causal chain, and structured evidence.",
    );
  }

  if (
    GAP_CATEGORIES.has(diagnosis.category) &&
    ["actionable", "needs_more_info"].includes(diagnosis.disposition) &&
    !diagnosis.gap_analysis
  ) {
    throw new Error("Actionable non-bug diagnoses require gap_analysis.");
  }

  if (diagnosis.should_close && diagnosis.close_reason !== "not planned") {
    throw new Error("Issue closure requires close_reason: not planned.");
  }
}
