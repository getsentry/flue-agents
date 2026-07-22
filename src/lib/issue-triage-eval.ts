import * as v from "valibot";

import {
  assertDiagnosisAnalysis,
  issueTriageDiagnosisSchema,
  type IssueTriageDiagnosis,
} from "./issue-triage-analysis.ts";
import {
  issueTriageOutcomeSchema,
  resolveDuplicateOutcome,
  resolveIssueTriageOutcome,
  type IssueTriageOutcome,
} from "./issue-triage-outcome.ts";

const closeReasonSchema = v.picklist(["not planned", "duplicate"]);
const duplicateCandidateSchema = v.strictObject({
  number: v.pipe(v.number(), v.integer(), v.minValue(1)),
  title: v.string(),
  url: v.string(),
  state: v.picklist(["open", "closed"]),
  confidence: v.picklist(["low", "medium", "high"]),
  reason: v.string(),
});
export const issueTriageEvalDuplicateSearchSchema = v.object({
  status: v.picklist(["duplicate", "unique", "uncertain"]),
  duplicate: v.optional(duplicateCandidateSchema),
  candidates: v.array(duplicateCandidateSchema),
  rationale: v.string(),
});
const rubricSchema = v.strictObject({
  pass: v.pipe(v.array(v.string()), v.minLength(1)),
  fail: v.optional(v.array(v.string()), []),
  threshold: v.optional(
    v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
    0.75,
  ),
});
const analysisExpectationSchema = v.variant("kind", [
  v.object({
    kind: v.literal("bug"),
    root_cause_includes: v.optional(v.array(v.string())),
    min_causal_chain_steps: v.optional(
      v.pipe(v.number(), v.integer(), v.minValue(1)),
    ),
    min_structured_evidence: v.optional(
      v.pipe(v.number(), v.integer(), v.minValue(1)),
    ),
    confidence: v.optional(v.picklist(["low", "medium", "high"])),
  }),
  v.object({
    kind: v.literal("gap"),
    gap_includes: v.optional(v.array(v.string())),
    min_acceptance_criteria: v.optional(
      v.pipe(v.number(), v.integer(), v.minValue(1)),
    ),
    min_structured_evidence: v.optional(
      v.pipe(v.number(), v.integer(), v.minValue(1)),
    ),
  }),
]);

export const issueTriageEvalDiagnosisSchema = issueTriageDiagnosisSchema;
export const issueTriageEvalOutcomeSchema = issueTriageOutcomeSchema;
type Diagnosis = IssueTriageDiagnosis;

const authorAssociationSchema = v.picklist([
  "COLLABORATOR",
  "CONTRIBUTOR",
  "FIRST_TIMER",
  "FIRST_TIME_CONTRIBUTOR",
  "MANNEQUIN",
  "MEMBER",
  "NONE",
  "OWNER",
]);

export const issueTriageEvalFixtureSchema = v.pipe(
  v.strictObject({
    name: v.pipe(v.string(), v.minLength(1)),
    description: v.string(),
    source: v.strictObject({
      repository: v.string(),
      issueNumber: v.pipe(v.number(), v.integer(), v.minValue(1)),
      capturedAt: v.string(),
    }),
    issue: v.strictObject({
      author: v.string(),
      authorAssociation: authorAssociationSchema,
      title: v.string(),
      labels: v.optional(v.array(v.string()), []),
      body: v.string(),
    }),
    duplicateCandidates: v.optional(v.array(duplicateCandidateSchema), []),
    rubric: v.optional(rubricSchema),
    expectedAnalysis: v.optional(analysisExpectationSchema),
    expectedOutcome: v.strictObject({
      action: v.optional(
        v.picklist(["none", "comment", "close"]),
      ),
      comment_includes: v.optional(v.array(v.string())),
      comment_excludes: v.optional(v.array(v.string())),
      max_comment_words: v.optional(
        v.pipe(v.number(), v.integer(), v.minValue(1)),
      ),
      close_reason: v.optional(closeReasonSchema),
      needs_human_review: v.optional(v.boolean()),
    }),
  }),
);
export type IssueTriageEvalFixture = v.InferOutput<
  typeof issueTriageEvalFixtureSchema
>;

/** Strictly validates fixture input before either discovery or LLM execution. */
export function parseIssueTriageEvalFixture(value: unknown) {
  return v.parse(issueTriageEvalFixtureSchema, value);
}

function addExactExpectation<T>(
  failures: string[],
  field: string,
  actual: T,
  expected: T | undefined,
) {
  if (expected !== undefined && actual !== expected) {
    failures.push(`${field}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function includesTerms(value: string, terms: string[]) {
  const normalized = value.toLowerCase();
  return terms.filter((term) => !normalized.includes(term.toLowerCase()));
}

function evaluateAnalysisExpectation(
  diagnosis: Diagnosis,
  expected: IssueTriageEvalFixture["expectedAnalysis"],
  failures: string[],
) {
  if (!expected) {
    return;
  }

  if (expected.kind === "bug") {
    const analysis = diagnosis.bug_analysis;
    if (!analysis) {
      failures.push("analysis: expected bug_analysis");
      return;
    }

    const missingTerms = includesTerms(
      [analysis.root_cause ?? "", ...analysis.causal_chain].join(" "),
      expected.root_cause_includes ?? [],
    );
    if (missingTerms.length > 0) {
      failures.push(
        `bug_analysis: root cause or causal chain missing ${missingTerms.join(", ")}`,
      );
    }
    if (
      expected.min_causal_chain_steps !== undefined &&
      analysis.causal_chain.length < expected.min_causal_chain_steps
    ) {
      failures.push(
        `bug_analysis.causal_chain: expected at least ${expected.min_causal_chain_steps} steps, got ${analysis.causal_chain.length}`,
      );
    }
    if (
      expected.min_structured_evidence !== undefined &&
      analysis.evidence.length < expected.min_structured_evidence
    ) {
      failures.push(
        `bug_analysis.evidence: expected at least ${expected.min_structured_evidence} items, got ${analysis.evidence.length}`,
      );
    }
    addExactExpectation(
      failures,
      "bug_analysis.confidence",
      analysis.confidence,
      expected.confidence,
    );
    return;
  }

  const analysis = diagnosis.gap_analysis;
  if (!analysis) {
    failures.push("analysis: expected gap_analysis");
    return;
  }

  const missingTerms = includesTerms(
    analysis.gap,
    expected.gap_includes ?? [],
  );
  if (missingTerms.length > 0) {
    failures.push(`gap_analysis.gap: missing ${missingTerms.join(", ")}`);
  }
  if (
    expected.min_acceptance_criteria !== undefined &&
    analysis.acceptance_criteria.length < expected.min_acceptance_criteria
  ) {
    failures.push(
      `gap_analysis.acceptance_criteria: expected at least ${expected.min_acceptance_criteria} items, got ${analysis.acceptance_criteria.length}`,
    );
  }
  if (
    expected.min_structured_evidence !== undefined &&
    analysis.evidence.length < expected.min_structured_evidence
  ) {
    failures.push(
      `gap_analysis.evidence: expected at least ${expected.min_structured_evidence} items, got ${analysis.evidence.length}`,
    );
  }
}

export function evaluateIssueTriageOutcome(
  diagnosis: Diagnosis | undefined,
  outcome: IssueTriageOutcome,
  fixture: IssueTriageEvalFixture,
) {
  const expected = fixture.expectedOutcome;
  const failures: string[] = [];
  addExactExpectation(failures, "action", outcome.action, expected.action);
  addExactExpectation(
    failures,
    "close_reason",
    outcome.close_reason,
    expected.close_reason,
  );
  addExactExpectation(
    failures,
    "needs_human_review",
    outcome.needs_human_review,
    expected.needs_human_review,
  );

  const missingCommentTerms = includesTerms(
    outcome.comment ?? "",
    expected.comment_includes ?? [],
  );
  if (missingCommentTerms.length > 0) {
    failures.push(`comment: missing ${missingCommentTerms.join(", ")}`);
  }

  const excluded = (expected.comment_excludes ?? []).filter((term) =>
    (outcome.comment ?? "").toLowerCase().includes(term.toLowerCase()),
  );
  if (excluded.length > 0) {
    failures.push(`comment: includes forbidden ${excluded.join(", ")}`);
  }
  if (expected.max_comment_words !== undefined && outcome.comment) {
    const words = outcome.comment.trim().split(/\s+/).length;
    if (words > expected.max_comment_words) {
      failures.push(
        `comment: expected at most ${expected.max_comment_words} words, got ${words}`,
      );
    }
  }

  if (diagnosis) {
    evaluateAnalysisExpectation(
      diagnosis,
      fixture.expectedAnalysis,
      failures,
    );
    try {
      assertDiagnosisAnalysis(diagnosis);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  return failures;
}

function buildIssueContext(fixture: IssueTriageEvalFixture) {
  const issueUrl = `https://github.com/${fixture.source.repository}/issues/${fixture.source.issueNumber}`;
  const issueLabels = fixture.issue.labels.map((name) => ({ name }));
  const association = fixture.issue.authorAssociation;
  return {
    issueNumber: fixture.source.issueNumber,
    repository: fixture.source.repository,
    reporter: {
      association,
      trusted: ["OWNER", "MEMBER", "COLLABORATOR"].includes(association),
    },
    issue: {
      title: fixture.issue.title,
      body: fixture.issue.body,
      author: { login: fixture.issue.author },
      labels: issueLabels,
      comments: [],
      url: issueUrl,
      state: "open",
      createdAt: fixture.source.capturedAt,
      updatedAt: fixture.source.capturedAt,
    },
    fetchedAt: fixture.source.capturedAt,
  };
}

export async function runIssueTriageEval(
  init: any,
  payload: unknown,
  issueTriageAgent: unknown,
) {
  // Keep the server-side deadline just inside the eval harness deadline so
  // slow model calls can finish while cancellation still reaches the client.
  const signal = AbortSignal.timeout(175_000);
  const fixture = parseIssueTriageEvalFixture(payload);
  const harness = await init(issueTriageAgent);
  const session = await harness.session(
    `eval-${fixture.source.repository.replace(/[^A-Za-z0-9_.-]+/g, "-")}-${fixture.source.issueNumber}`,
  );
  const context = buildIssueContext(fixture);
  let duplicateSearch: v.InferOutput<
    typeof issueTriageEvalDuplicateSearchSchema
  > = {
    status: "unique",
    candidates: [],
    rationale: "Eval fixture does not provide duplicate candidates.",
  };
  if (fixture.duplicateCandidates.length > 0) {
    const duplicateResponse = await session.skill("issue-triage", {
      args: {
        stage: "search-duplicates",
        issueNumber: fixture.source.issueNumber,
        repository: fixture.source.repository,
        context,
        duplicateCandidates: fixture.duplicateCandidates,
      },
      result: issueTriageEvalDuplicateSearchSchema,
      signal,
    });
    duplicateSearch = duplicateResponse.data;
    if (duplicateSearch.status === "duplicate" && duplicateSearch.duplicate) {
      return {
        scenario: `${fixture.source.repository}#${fixture.source.issueNumber}`,
        description: fixture.description,
        duplicateSearch,
        outcome: resolveDuplicateOutcome(
          context,
          duplicateSearch.duplicate.number,
        ),
      };
    }
  }

  const response = await session.skill("issue-triage", {
    args: {
      stage: "diagnose-and-validate",
      issueNumber: fixture.source.issueNumber,
      repository: fixture.source.repository,
      context,
      duplicateSearch,
      repositoryContext: {
        checkoutAvailable: false,
        repoPath: null,
        remoteUrl: fixture.source.repository,
        headSha: null,
        checkoutNote:
          "Eval fixture run: no repository checkout is available. Use only the provided issue context.",
      },
    },
    result: issueTriageEvalDiagnosisSchema,
    signal,
  });
  const diagnosis = response.data;
  let outcome: IssueTriageOutcome;
  try {
    assertDiagnosisAnalysis(diagnosis);
    outcome = resolveIssueTriageOutcome(context, diagnosis);
  } catch {
    // Match production: semantic validation failures never reach GitHub.
    outcome = {
      action: "none",
      needs_human_review: true,
    };
  }

  return {
    scenario: `${fixture.source.repository}#${fixture.source.issueNumber}`,
    description: fixture.description,
    duplicateSearch,
    diagnosis,
    outcome,
  };
}
