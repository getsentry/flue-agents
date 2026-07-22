import * as v from "valibot";

import {
  type IssueTriageDiagnosis,
  issueTriageDiagnosisSchema,
} from "./issue-triage-analysis.ts";
import {
  shouldCloseAsInvalidLowSignal,
  shouldCloseAsSpam,
} from "./issue-triage-close-decision.ts";
import {
  buildInvalidCloseComment,
  buildSpamCloseComment,
  type IssueContext,
  normalizePierreComment,
  resolveLabelsToApply,
} from "./issue-triage-github.ts";
import { PIERRE_COMMENT_OPENER } from "./pierre.ts";

export const issueTriageOutcomeSchema = v.strictObject({
  action: v.picklist(["none", "label", "comment", "close"]),
  labels: v.array(v.string()),
  comment: v.optional(v.string()),
  close_reason: v.optional(v.picklist(["not planned", "duplicate"])),
  closure_kind: v.optional(v.picklist(["spam", "invalid", "duplicate"])),
  needs_human_review: v.boolean(),
});

export type IssueTriageOutcome = v.InferOutput<
  typeof issueTriageOutcomeSchema
>;

export function resolveDuplicateOutcome(
  context: IssueContext,
  duplicateNumber: number,
): IssueTriageOutcome {
  const comment = [
    PIERRE_COMMENT_OPENER,
    "",
    `This is the same issue as #${duplicateNumber}, so I'm closing this one to keep the investigation in one place. Follow #${duplicateNumber} for updates.`,
  ].join("\n");

  return {
    action: "close",
    labels: resolveLabelsToApply(context, ["duplicate"]),
    comment: normalizePierreComment(comment, context),
    close_reason: "duplicate",
    closure_kind: "duplicate",
    needs_human_review: false,
  };
}

function isTrustedReporter(context: IssueContext) {
  const association = context.reporter?.association?.trim().toUpperCase();
  return (
    context.reporter?.trusted === true ||
    association === "OWNER" ||
    association === "MEMBER" ||
    association === "COLLABORATOR"
  );
}

function shouldSuppressComment(
  context: IssueContext,
  diagnosis: IssueTriageDiagnosis,
) {
  const analysisEvidence = [
    ...(diagnosis.bug_analysis?.evidence ?? []),
    ...(diagnosis.gap_analysis?.evidence ?? []),
  ];
  const hasIndependentEvidence = analysisEvidence.some(({ source }) =>
    ["source", "command", "history"].includes(source),
  );

  // An actionable report already gives maintainers enough to proceed. Only a
  // technical finding from outside the report can justify adding public text.
  if (
    diagnosis.disposition === "actionable" &&
    (diagnosis.followup_kind !== "technical_diagnosis" ||
      !hasIndependentEvidence)
  ) {
    return true;
  }

  if (!isTrustedReporter(context)) return false;
  return !(
    diagnosis.followup_kind === "missing_info_request" ||
    (diagnosis.followup_kind === "technical_diagnosis" &&
      hasIndependentEvidence)
  );
}

function buildUnsafeCloseComment() {
  return [
    PIERRE_COMMENT_OPENER,
    "",
    "I do not have enough confidence to close this automatically. A maintainer needs to review this one.",
  ].join("\n");
}

function selectComment(
  diagnosis: IssueTriageDiagnosis,
  context: IssueContext,
) {
  if (shouldSuppressComment(context, diagnosis)) {
    return undefined;
  }
  return diagnosis.followup_comment?.trim() || undefined;
}

/** Resolves the exact GitHub-facing change before the workflow executes it. */
export function resolveIssueTriageOutcome(
  context: IssueContext,
  diagnosisValue: IssueTriageDiagnosis,
): IssueTriageOutcome {
  const diagnosis = v.parse(issueTriageDiagnosisSchema, diagnosisValue);

  if (
    diagnosis.needs_human_review ||
    diagnosis.category === "security" ||
    diagnosis.severity === "critical"
  ) {
    return {
      action: "none",
      labels: [],
      needs_human_review: true,
    };
  }

  const labels = resolveLabelsToApply(context, diagnosis.labels_to_apply);

  if (shouldCloseAsSpam(diagnosis)) {
    return {
      action: "close",
      labels,
      comment: normalizePierreComment(buildSpamCloseComment(context), context),
      close_reason: "not planned",
      closure_kind: "spam",
      needs_human_review: false,
    };
  }

  if (shouldCloseAsInvalidLowSignal(context, diagnosis)) {
    return {
      action: "close",
      labels,
      comment: normalizePierreComment(
        buildInvalidCloseComment(context),
        context,
      ),
      close_reason: "not planned",
      closure_kind: "invalid",
      needs_human_review: false,
    };
  }

  const unsafeCloseRequest = diagnosis.should_close;
  const rawComment = unsafeCloseRequest
    ? buildUnsafeCloseComment()
    : selectComment(diagnosis, context);
  const comment = rawComment
    ? normalizePierreComment(rawComment, context)
    : undefined;
  const action =
    comment ? "comment" : labels.length > 0 ? "label" : "none";

  return {
    action,
    labels,
    ...(comment ? { comment } : {}),
    needs_human_review: unsafeCloseRequest,
  };
}
