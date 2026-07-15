import * as v from "valibot";

import {
  assertDiagnosisAnalysis,
  issueTriageDiagnosisSchema,
  type IssueTriageDiagnosis,
} from "./issue-triage-analysis.ts";
import {
  shouldCloseAsInvalidLowSignal,
  shouldCloseAsSpam,
} from "./issue-triage-close-decision.ts";

const closeReasonSchema = v.picklist(["not planned"]);
const commentKindSchema = v.picklist([
  "none",
  "missing_info_request",
  "concrete_validation",
  "scope_note",
  "edit_notice",
  "duplicate_notice",
  "closure_notice",
]);

export const issueTriageEvalDiagnosisSchema = issueTriageDiagnosisSchema;
type Diagnosis = IssueTriageDiagnosis;

const fixtureSchema = v.object({
  description: v.string(),
  source: v.object({
    repository: v.string(),
    issueNumber: v.pipe(v.number(), v.integer(), v.minValue(1)),
    capturedAt: v.string(),
    url: v.optional(v.string()),
    issueUrl: v.optional(v.string()),
  }),
  issue: v.object({
    author: v.union([v.string(), v.object({ login: v.string() })]),
    authorAssociation: v.optional(v.string()),
    title: v.string(),
    labelsAtCapture: v.array(v.string()),
    body: v.string(),
  }),
  expectedTriage: v.object({
    labels_to_apply: v.optional(v.array(v.string())),
    labels_include: v.optional(v.array(v.string())),
    should_comment: v.optional(v.boolean()),
    comment_kind: v.optional(commentKindSchema),
    should_update_issue: v.optional(v.boolean()),
    should_close: v.optional(v.boolean()),
    close_reason: v.optional(closeReasonSchema),
    needs_human_review: v.optional(v.boolean()),
  }),
});
type EvalFixture = v.InferOutput<typeof fixtureSchema>;

function includesLabel(diagnosis: Diagnosis, label: string) {
  return diagnosis.labels_to_apply.some(
    (candidate) => candidate.toLowerCase() === label.toLowerCase(),
  );
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

function evaluateDiagnosis(diagnosis: Diagnosis, fixture: EvalFixture) {
  const expected = fixture.expectedTriage;
  const failures: string[] = [];
  const labels = expected.labels_include ?? expected.labels_to_apply ?? [];
  const inferredShouldClose =
    shouldCloseAsSpam(diagnosis) ||
    shouldCloseAsInvalidLowSignal(buildIssueContext(fixture), diagnosis);
  const effectiveShouldClose = diagnosis.should_close ?? inferredShouldClose;
  const effectiveCloseReason =
    diagnosis.close_reason ?? (inferredShouldClose ? "not planned" : undefined);

  addExactExpectation(
    failures,
    "should_comment",
    diagnosis.should_comment,
    expected.should_comment,
  );
  addExactExpectation(
    failures,
    "comment_kind",
    diagnosis.comment_kind,
    expected.comment_kind,
  );
  addExactExpectation(
    failures,
    "should_update_issue",
    diagnosis.should_update_issue,
    expected.should_update_issue,
  );
  addExactExpectation(
    failures,
    "should_close",
    effectiveShouldClose,
    expected.should_close,
  );
  addExactExpectation(
    failures,
    "close_reason",
    effectiveCloseReason,
    expected.close_reason,
  );
  addExactExpectation(
    failures,
    "needs_human_review",
    diagnosis.needs_human_review,
    expected.needs_human_review,
  );

  for (const label of labels) {
    if (!includesLabel(diagnosis, label)) {
      failures.push(`labels_to_apply: expected to include ${label}`);
    }
  }

  return failures;
}

function buildIssueContext(fixture: EvalFixture) {
  const author =
    typeof fixture.issue.author === "string"
      ? fixture.issue.author
      : fixture.issue.author.login;
  const issueUrl =
    fixture.source.url ??
    fixture.source.issueUrl ??
    `https://github.com/${fixture.source.repository}/issues/${fixture.source.issueNumber}`;

  const association = fixture.issue.authorAssociation?.trim();
  return {
    issueNumber: fixture.source.issueNumber,
    repository: fixture.source.repository,
    reporter: association
      ? {
          association,
          trusted: ["OWNER", "MEMBER", "COLLABORATOR"].includes(
            association.toUpperCase(),
          ),
        }
      : undefined,
    issue: {
      title: fixture.issue.title,
      body: fixture.issue.body,
      author: { login: author },
      labels: [],
      comments: [],
      url: issueUrl,
      state: "open",
      createdAt: fixture.source.capturedAt,
      updatedAt: fixture.source.capturedAt,
    },
    labels: fixture.issue.labelsAtCapture.map((name) => ({ name })),
    fetchedAt: fixture.source.capturedAt,
  };
}

export async function runIssueTriageEval(
  init: any,
  payload: unknown,
  issueTriageAgent: unknown,
) {
  const fixture = v.parse(fixtureSchema, payload);
  const harness = await init(issueTriageAgent);
  const session = await harness.session(
    `eval-${fixture.source.repository.replace(/[^A-Za-z0-9_.-]+/g, "-")}-${fixture.source.issueNumber}`,
  );
  const context = buildIssueContext(fixture);
  const response = await session.skill("issue-triage", {
    args: {
      stage: "diagnose-and-validate",
      issueNumber: fixture.source.issueNumber,
      repository: fixture.source.repository,
      context,
      duplicateSearch: {
        status: "unique",
        candidates: [],
        rationale: "Eval fixture does not provide duplicate candidates.",
      },
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
    signal: AbortSignal.timeout(300_000),
  });
  const diagnosis = response.data;
  const failures = evaluateDiagnosis(diagnosis, fixture);
  try {
    assertDiagnosisAnalysis(diagnosis);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  return {
    scenario: `${fixture.source.repository}#${fixture.source.issueNumber}`,
    description: fixture.description,
    passed: failures.length === 0,
    failures,
    diagnosis,
  };
}
