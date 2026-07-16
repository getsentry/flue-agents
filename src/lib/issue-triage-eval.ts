import * as v from "valibot";

import {
  assertDiagnosisAnalysis,
  issueTriageDiagnosisSchema,
  type IssueTriageDiagnosis,
} from "./issue-triage-analysis.ts";
const closeReasonSchema = v.picklist(["not planned"]);
const followupKindSchema = v.picklist([
  "technical_diagnosis",
  "scope_clarification",
  "missing_info_request",
]);

export const issueTriageEvalDiagnosisSchema = issueTriageDiagnosisSchema;
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
    description: v.string(),
    source: v.strictObject({
      repository: v.string(),
      issueNumber: v.pipe(v.number(), v.integer(), v.minValue(1)),
      capturedAt: v.string(),
    }),
    repositoryLabels: v.array(v.string()),
    issue: v.strictObject({
      author: v.string(),
      authorAssociation: authorAssociationSchema,
      title: v.string(),
      labels: v.optional(v.array(v.string()), []),
      body: v.string(),
    }),
    expectedTriage: v.strictObject({
      labels_include: v.optional(v.array(v.string())),
      has_followup_comment: v.optional(v.boolean()),
      followup_kind: v.optional(followupKindSchema),
      should_close: v.optional(v.boolean()),
      close_reason: v.optional(closeReasonSchema),
      needs_human_review: v.optional(v.boolean()),
    }),
  }),
  v.check((fixture) => {
    const available = new Set(
      fixture.repositoryLabels.map((label) => label.toLowerCase()),
    );
    return [
      ...fixture.issue.labels,
      ...(fixture.expectedTriage.labels_include ?? []),
    ].every((label) => available.has(label.toLowerCase()));
  }, "Issue and expected labels must exist in repositoryLabels."),
);
export type IssueTriageEvalFixture = v.InferOutput<
  typeof issueTriageEvalFixtureSchema
>;

/** Strictly validates fixture input before either discovery or LLM execution. */
export function parseIssueTriageEvalFixture(value: unknown) {
  return v.parse(issueTriageEvalFixtureSchema, value);
}

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

function evaluateDiagnosis(
  diagnosis: Diagnosis,
  fixture: IssueTriageEvalFixture,
) {
  const expected = fixture.expectedTriage;
  const failures: string[] = [];
  const labels = expected.labels_include ?? [];

  addExactExpectation(
    failures,
    "has_followup_comment",
    Boolean(diagnosis.followup_comment),
    expected.has_followup_comment,
  );
  addExactExpectation(
    failures,
    "followup_kind",
    diagnosis.followup_kind,
    expected.followup_kind,
  );
  addExactExpectation(
    failures,
    "should_close",
    diagnosis.should_close,
    expected.should_close,
  );
  addExactExpectation(
    failures,
    "close_reason",
    diagnosis.close_reason,
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
    labels: fixture.repositoryLabels.map((name) => ({ name })),
    fetchedAt: fixture.source.capturedAt,
  };
}

export async function runIssueTriageEval(
  init: any,
  payload: unknown,
  issueTriageAgent: unknown,
) {
  // Start the server-side deadline before agent/session setup. The surrounding
  // harness and Vitest deadlines include additional headroom for cancellation
  // and reporting after the model reaches this limit.
  const signal = AbortSignal.timeout(120_000);
  const fixture = parseIssueTriageEvalFixture(payload);
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
    signal,
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
