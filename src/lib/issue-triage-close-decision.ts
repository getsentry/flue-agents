import { findInvalidLabel, type IssueContext } from "./issue-triage-github.ts";

type CloseCandidate = {
  should_close?: boolean;
  close_reason?: "not planned";
  disposition: string;
  severity: string;
  category: string;
  labels_to_apply: string[];
  needs_human_review: boolean;
};

function hasRequestedLabel(diagnosis: CloseCandidate, labelName: string) {
  return diagnosis.labels_to_apply.some(
    (label) => label.toLowerCase() === labelName.toLowerCase(),
  );
}

function hasNoContraryCloseReason(diagnosis: CloseCandidate) {
  return diagnosis.close_reason === undefined || diagnosis.close_reason === "not planned";
}

export function shouldCloseAsSpam(diagnosis: CloseCandidate) {
  return (
    diagnosis.should_close === true &&
    hasNoContraryCloseReason(diagnosis) &&
    diagnosis.disposition === "spam" &&
    diagnosis.severity === "low" &&
    diagnosis.category !== "security" &&
    diagnosis.needs_human_review === false &&
    hasRequestedLabel(diagnosis, "invalid")
  );
}

export function shouldCloseAsInvalidLowSignal(
  context: IssueContext,
  diagnosis: CloseCandidate,
) {
  return (
    diagnosis.should_close === true &&
    hasNoContraryCloseReason(diagnosis) &&
    ["low_actionability", "impractical_scope", "unclear"].includes(
      diagnosis.disposition,
    ) &&
    diagnosis.severity === "low" &&
    diagnosis.category !== "security" &&
    diagnosis.needs_human_review === false &&
    hasRequestedLabel(diagnosis, "invalid") &&
    findInvalidLabel(context) !== null
  );
}
