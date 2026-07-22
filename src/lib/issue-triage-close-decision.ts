type CloseCandidate = {
  should_close?: boolean;
  close_reason?: "not planned";
  disposition: string;
  severity: string;
  category: string;
  needs_human_review: boolean;
};

function hasNoContraryCloseReason(diagnosis: CloseCandidate) {
  return (
    diagnosis.close_reason === undefined ||
    diagnosis.close_reason === "not planned"
  );
}

export function shouldCloseAsSpam(diagnosis: CloseCandidate) {
  return (
    diagnosis.should_close === true &&
    hasNoContraryCloseReason(diagnosis) &&
    diagnosis.disposition === "spam" &&
    diagnosis.severity === "low" &&
    diagnosis.category !== "security" &&
    diagnosis.needs_human_review === false
  );
}

export function shouldCloseAsInvalidLowSignal(diagnosis: CloseCandidate) {
  return (
    diagnosis.should_close === true &&
    hasNoContraryCloseReason(diagnosis) &&
    ["low_actionability", "impractical_scope", "unclear"].includes(
      diagnosis.disposition,
    ) &&
    diagnosis.severity === "low" &&
    diagnosis.category !== "security" &&
    diagnosis.needs_human_review === false
  );
}
