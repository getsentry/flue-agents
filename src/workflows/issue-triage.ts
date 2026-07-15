// Owns the bounded issue-triage workflow: it gathers GitHub context, delegates
// judgment to the triage agent, preserves reporter-authored title and body,
// and keeps Flue's generated Durable Object wrapped with Sentry at the module
// boundary.
import type { Sandbox } from "@cloudflare/sandbox";
import type {
  FlueContext,
  FlueSession,
  WorkflowRouteHandler,
} from "@flue/runtime";
import { extend } from "@flue/runtime/cloudflare";
import * as Sentry from "@sentry/cloudflare";
import * as v from "valibot";

import issueTriageAgent from "../agents/issue-triage.ts";
import {
  applyLabels,
  closeInvalidIssue,
  closeSpamIssue,
  findDuplicateLabel,
  type GithubCommandEnv,
  resolveGithubCommandEnv,
  type IssueContext,
  isRecord,
  postComment,
  repoArg,
  runGhCommand,
  shellQuote,
} from "../lib/issue-triage-github.ts";
import {
  assertDiagnosisAnalysis,
  closeReasonSchema,
  issueTriageDiagnosisSchema,
  type IssueTriageDiagnosis,
} from "../lib/issue-triage-analysis.ts";
import {
  shouldCloseAsInvalidLowSignal,
  shouldCloseAsSpam,
} from "../lib/issue-triage-close-decision.ts";
import { PIERRE_COMMENT_OPENER } from "../lib/pierre.ts";
import { getSentryOptions, type SentryEnv } from "../lib/sentry.ts";

export const route: WorkflowRouteHandler = async (_c, next) => next();

type Env = SentryEnv & {
  GITHUB_APP_CLIENT_ID?: string;
  GITHUB_APP_INSTALLATION_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  FLUE_TRIAGE_MODEL?: string;
  Sandbox: DurableObjectNamespace<Sandbox>;
};

export const cloudflare = extend({
  wrap: (Final) =>
    Sentry.instrumentDurableObjectWithSentry(
      (env: Env) => getSentryOptions(env),
      Final,
    ),
});

const repositorySchema = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
);

const payloadSchema = v.object({
  issueNumber: v.pipe(v.number(), v.integer(), v.minValue(1)),
  repository: v.optional(repositorySchema),
});

const duplicateCandidateSchema = v.object({
  number: v.pipe(v.number(), v.integer(), v.minValue(1)),
  title: v.string(),
  url: v.string(),
  state: v.string(),
  confidence: v.picklist(["low", "medium", "high"]),
  reason: v.string(),
});

const duplicateSearchSchema = v.object({
  status: v.picklist(["duplicate", "unique", "uncertain"]),
  duplicate: v.optional(duplicateCandidateSchema),
  candidates: v.array(duplicateCandidateSchema),
  rationale: v.string(),
});
type DuplicateSearch = v.InferOutput<typeof duplicateSearchSchema>;
type DuplicateCandidate = v.InferOutput<typeof duplicateCandidateSchema>;
type WorkflowLog = FlueContext<unknown, Env>["log"];

const diagnosisSchema = issueTriageDiagnosisSchema;
type Diagnosis = IssueTriageDiagnosis;

const updateSchema = v.object({
  title_updated: v.boolean(),
  body_updated: v.boolean(),
  labels_applied: v.array(v.string()),
  comment_posted: v.boolean(),
  issue_closed: v.boolean(),
  closure_kind: v.optional(v.picklist(["spam", "invalid"])),
  close_reason: v.optional(closeReasonSchema),
  needs_human_review: v.boolean(),
  summary: v.string(),
});

const TRUSTED_REPORTER_ASSOCIATIONS = new Set([
  "OWNER",
  "MEMBER",
  "COLLABORATOR",
]);

const IGNORED_AUTHOR_LOGINS = new Set(["github-actions[bot]"]);

function normalizeAuthorLogin(value: string) {
  const login = value.trim().toLowerCase();
  return login === "github-actions" ? "github-actions[bot]" : login;
}

function getIssueAuthorLogin(context: IssueContext) {
  if (!isRecord(context.issue)) {
    return null;
  }

  for (const key of ["author", "user"] as const) {
    const author = context.issue[key];
    if (isRecord(author) && typeof author.login === "string") {
      const login = normalizeAuthorLogin(author.login);
      return login || null;
    }
  }

  return null;
}

function normalizeAuthorAssociation(value: string) {
  const association = value.trim().toUpperCase();
  return association || null;
}

function isTrustedAssociation(association?: string) {
  const normalized = association ? normalizeAuthorAssociation(association) : null;
  return normalized !== null && TRUSTED_REPORTER_ASSOCIATIONS.has(normalized);
}

function summarizeAgentFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("404 status code")) {
    return "The triage model returned a provider error before producing structured output.";
  }

  if (message.includes("Gateway Timeout")) {
    return "The triage model timed out before producing structured output.";
  }

  return "The triage agent failed before producing structured output.";
}

function logInfo(
  log: WorkflowLog,
  message: string,
  attributes: Record<string, unknown>,
) {
  log.info?.(message, attributes);
}

function buildDuplicateSearchFailure(error: unknown): DuplicateSearch {
  return {
    status: "uncertain",
    candidates: [],
    rationale: summarizeAgentFailure(error),
  };
}

function getIssueSearchText(context: IssueContext, key: "title" | "body") {
  if (!isRecord(context.issue) || typeof context.issue[key] !== "string") {
    return "";
  }
  return context.issue[key].trim();
}

function getQuotedPhrases(value: string) {
  const phrases = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 12 && line.length <= 120)
    .filter((line) => /[A-Za-z]/.test(line))
    .filter((line) => !/^(#|```|>|[-*]\s)/.test(line))
    .slice(0, 3);

  return phrases.map((phrase) => `"${phrase.replace(/"/g, '\\"')}"`);
}

function buildDuplicateSearchQueries(context: IssueContext) {
  const title = getIssueSearchText(context, "title");
  const body = getIssueSearchText(context, "body");
  const queries = new Set<string>();

  if (title) {
    queries.add(`"${title.replace(/"/g, '\\"')}"`);
  }

  for (const phrase of getQuotedPhrases(body)) {
    queries.add(phrase);
  }

  return Array.from(queries).slice(0, 4);
}

function toDuplicateCandidate(value: unknown, issueNumber: number) {
  if (!isRecord(value) || typeof value.number !== "number") {
    return null;
  }

  if (value.number === issueNumber) {
    return null;
  }

  if (
    typeof value.title !== "string" ||
    typeof value.url !== "string" ||
    typeof value.state !== "string"
  ) {
    return null;
  }

  return {
    number: value.number,
    title: value.title,
    url: value.url,
    state: value.state,
    confidence: "low",
    reason: "Workflow-owned GitHub search candidate for duplicate comparison.",
  } satisfies DuplicateCandidate;
}

async function collectDuplicateCandidates(
  session: FlueSession,
  commandEnv: GithubCommandEnv,
  context: IssueContext,
) {
  const repo = repoArg(context.repository);
  const candidates = new Map<number, DuplicateCandidate>();

  for (const query of buildDuplicateSearchQueries(context)) {
    for (const state of ["open", "closed"]) {
      const result = await readJsonCommand(
        session,
        commandEnv,
        `gh search issues ${shellQuote(query)}${repo} --state ${state} --limit 10 --json number,title,url,state`,
        "Searching duplicate issue candidates",
      );

      if (!Array.isArray(result)) {
        continue;
      }

      for (const item of result) {
        const candidate = toDuplicateCandidate(item, context.issueNumber);
        if (candidate && !candidates.has(candidate.number)) {
          candidates.set(candidate.number, candidate);
        }
      }
    }
  }

  return Array.from(candidates.values()).slice(0, 10);
}

function buildDiagnosisFailure(error: unknown): Diagnosis {
  return {
    severity: "low",
    category: "unknown",
    disposition: "unclear",
    validity: "unclear",
    summary:
      "Automated triage could not complete, so the issue is left unchanged for maintainer review.",
    evidence: [summarizeAgentFailure(error)],
    labels_to_apply: [],
    should_close: false,
    needs_human_review: true,
  };
}

function getIssueState(context: IssueContext) {
  if (!isRecord(context.issue) || typeof context.issue.state !== "string") {
    return null;
  }
  return context.issue.state.toLowerCase();
}

function issueSnapshot(context: IssueContext) {
  if (!isRecord(context.issue)) {
    return "";
  }

  const labels = Array.isArray(context.issue.labels)
    ? context.issue.labels
        .map((label) =>
          isRecord(label) && typeof label.name === "string" ? label.name : label,
        )
        .sort()
    : context.issue.labels;

  return JSON.stringify({
    title: context.issue.title,
    body: context.issue.body,
    state: context.issue.state,
    labels,
    comments: context.issue.comments,
  });
}

function getIssueAuthorAssociation(context: IssueContext) {
  if (context.reporter?.association) {
    return normalizeAuthorAssociation(context.reporter.association);
  }

  if (!isRecord(context.issue)) {
    return null;
  }

  if (typeof context.issue.authorAssociation === "string") {
    return normalizeAuthorAssociation(context.issue.authorAssociation);
  }

  if (typeof context.issue.author_association === "string") {
    return normalizeAuthorAssociation(context.issue.author_association);
  }

  if (
    isRecord(context.issue.author) &&
    typeof context.issue.author.association === "string"
  ) {
    return normalizeAuthorAssociation(context.issue.author.association);
  }

  return null;
}

function isTrustedReporter(context: IssueContext) {
  return context.reporter?.trusted === true
    ? true
    : isTrustedAssociation(getIssueAuthorAssociation(context) ?? undefined);
}

/**
 * Suppresses standalone trusted-reporter comments unless the model classifies
 * them as a blocking ask or concrete repository validation finding.
 */
function shouldSuppressTriageComment(
  context: IssueContext,
  diagnosis: Diagnosis,
) {
  if (!isTrustedReporter(context)) {
    return false;
  }

  return !(
    diagnosis.followup_kind === "missing_info_request" ||
    diagnosis.followup_kind === "technical_diagnosis"
  );
}

async function readJsonCommand(
  session: FlueSession,
  commandEnv: GithubCommandEnv,
  command: string,
  description: string,
) {
  const result = await session.shell(command, {
    env: commandEnv,
    signal: AbortSignal.timeout(60_000),
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `${description} failed: ${result.stderr || result.stdout}`.trim(),
    );
  }

  try {
    return JSON.parse(result.stdout) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${description} returned invalid JSON: ${message}`);
  }
}

/** Reads reporter association from GitHub or legacy issue-shaped fields. */
function readAuthorAssociation(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.authorAssociation === "string") {
    return normalizeAuthorAssociation(value.authorAssociation);
  }

  if (typeof value.author_association === "string") {
    return normalizeAuthorAssociation(value.author_association);
  }

  if (isRecord(value.author) && typeof value.author.association === "string") {
    return normalizeAuthorAssociation(value.author.association);
  }

  return null;
}

async function readReporterAssociation(
  session: FlueSession,
  commandEnv: GithubCommandEnv,
  issueNumber: number,
  repository?: string,
) {
  if (!repository) {
    return null;
  }

  try {
    const issue = await readJsonCommand(
      session,
      commandEnv,
      `gh api ${shellQuote(`/repos/${repository}/issues/${issueNumber}`)}`,
      "Fetching issue reporter association",
    );
    return readAuthorAssociation(issue);
  } catch {
    return null;
  }
}

async function closeDuplicate(
  session: FlueSession,
  commandEnv: GithubCommandEnv,
  context: IssueContext,
  duplicate: v.InferOutput<typeof duplicateCandidateSchema>,
) {
  const duplicateLabel = findDuplicateLabel(context);
  const labelsApplied = duplicateLabel
    ? await applyLabels(session, commandEnv, context, [duplicateLabel])
    : [];
  const comment = [
    PIERRE_COMMENT_OPENER,
    "",
    `Thanks for the report. This looks like the same issue as #${duplicate.number}.`,
    "",
    `I'm closing this one so the conversation stays in one place. Please follow #${duplicate.number} for updates.`,
  ].join("\n");

  await postComment(session, commandEnv, context, comment);
  await runGhCommand(
    session,
    commandEnv,
    `gh issue close ${context.issueNumber}${repoArg(context.repository)} --reason duplicate --duplicate-of ${duplicate.number}`,
    "Closing duplicate issue",
  );

  return labelsApplied;
}

function buildUnsafeCloseComment() {
  return [
    PIERRE_COMMENT_OPENER,
    "",
    "I do not have enough confidence to close this automatically. A maintainer can make the call.",
  ].join("\n");
}

/** Applies trusted-reporter suppression to a schema-validated follow-up. */
function selectFollowupComment(diagnosis: Diagnosis, context: IssueContext) {
  if (shouldSuppressTriageComment(context, diagnosis)) {
    return undefined;
  }

  return diagnosis.followup_comment;
}

async function applyTriageUpdate(
  session: FlueSession,
  commandEnv: GithubCommandEnv,
  context: IssueContext,
  diagnosis: v.InferOutput<typeof diagnosisSchema>,
): Promise<v.InferOutput<typeof updateSchema>> {
  if (getIssueState(context) === "closed") {
    return {
      title_updated: false,
      body_updated: false,
      labels_applied: [],
      comment_posted: false,
      issue_closed: false,
      needs_human_review: true,
      summary: "Skipped triage update because the issue is already closed.",
    };
  }

  if (
    diagnosis.category === "security" ||
    diagnosis.severity === "critical"
  ) {
    return {
      title_updated: false,
      body_updated: false,
      labels_applied: [],
      comment_posted: false,
      issue_closed: false,
      needs_human_review: true,
      summary:
        "Skipped public mutations because the issue is security-sensitive or critical.",
    };
  }

  const labelsApplied = await applyLabels(
    session,
    commandEnv,
    context,
    diagnosis.labels_to_apply,
  );
  let commentPosted = false;

  if (shouldCloseAsSpam(diagnosis)) {
    commentPosted = await closeSpamIssue(
      session,
      commandEnv,
      context,
      diagnosis,
    );

    return {
      title_updated: false,
      body_updated: false,
      labels_applied: labelsApplied,
      comment_posted: commentPosted,
      issue_closed: true,
      closure_kind: "spam",
      close_reason: "not planned",
      needs_human_review: false,
      summary: "Closed issue as spam.",
    };
  }

  if (shouldCloseAsInvalidLowSignal(context, diagnosis)) {
    commentPosted = await closeInvalidIssue(
      session,
      commandEnv,
      context,
      diagnosis,
    );

    return {
      title_updated: false,
      body_updated: false,
      labels_applied: labelsApplied,
      comment_posted: commentPosted,
      issue_closed: true,
      closure_kind: "invalid",
      close_reason: "not planned",
      needs_human_review: false,
      summary: "Closed issue as invalid low-signal.",
    };
  }

  const unsafeCloseRequest = diagnosis.should_close === true;

  const comment = unsafeCloseRequest
    ? buildUnsafeCloseComment()
    : selectFollowupComment(diagnosis, context);
  if (comment) {
    commentPosted = await postComment(session, commandEnv, context, comment);
  }

  const changed = [
    labelsApplied.length > 0 ? "labels" : null,
    commentPosted ? "comment" : null,
  ].filter(Boolean);

  return {
    title_updated: false,
    body_updated: false,
    labels_applied: labelsApplied,
    comment_posted: commentPosted,
    issue_closed: false,
    needs_human_review: diagnosis.needs_human_review || unsafeCloseRequest,
    summary: unsafeCloseRequest
      ? "Skipped unsafe close request and left the issue open for maintainer review."
      : changed.length > 0
        ? `Updated issue ${changed.join(", ")}.`
        : "No issue update was needed.",
  };
}

async function readIssueContext(
  session: FlueSession,
  commandEnv: GithubCommandEnv,
  issueNumber: number,
  repository?: string,
): Promise<IssueContext> {
  const repo = repoArg(repository);
  const issue = await readJsonCommand(
    session,
    commandEnv,
    `gh issue view ${issueNumber}${repo} --json title,body,author,labels,comments,url,state,createdAt,updatedAt`,
    "Fetching issue context",
  );
  const reporterAssociation = await readReporterAssociation(
    session,
    commandEnv,
    issueNumber,
    repository,
  );
  const labels = await readJsonCommand(
    session,
    commandEnv,
    `gh label list${repo} --limit 200 --json name,description`,
    "Fetching repository labels",
  );
  const context: IssueContext = {
    issueNumber,
    issue,
    labels,
    fetchedAt: new Date().toISOString(),
  };

  if (repository) {
    context.repository = repository;
  }
  const reporterLogin = getIssueAuthorLogin(context);
  if (reporterLogin || reporterAssociation) {
    context.reporter = {};
    if (reporterLogin) {
      context.reporter.login = reporterLogin;
    }
    if (reporterAssociation) {
      context.reporter.association = reporterAssociation;
      context.reporter.trusted = isTrustedAssociation(reporterAssociation);
    }
  }

  return context;
}

async function prepareRepository(
  session: FlueSession,
  commandEnv: GithubCommandEnv,
  issueNumber: number,
  repository?: string,
) {
  const root = await session.shell("git rev-parse --show-toplevel", {
    signal: AbortSignal.timeout(30_000),
  });

  if (root.exitCode === 0) {
    const repoPath = root.stdout.trim();
    const remote = await session.shell("git remote get-url origin", {
      cwd: repoPath,
      signal: AbortSignal.timeout(30_000),
    });
    const head = await session.shell("git rev-parse HEAD", {
      cwd: repoPath,
      signal: AbortSignal.timeout(30_000),
    });

    return {
      checkoutAvailable: true,
      repoPath,
      remoteUrl: remote.exitCode === 0 ? remote.stdout.trim() : null,
      headSha: head.exitCode === 0 ? head.stdout.trim() : null,
      checkoutNote: "Using the repository checkout prepared by GitHub Actions.",
    };
  }

  if (!repository) {
    return {
      checkoutAvailable: false,
      repoPath: null,
      remoteUrl: null,
      headSha: null,
      checkoutNote:
        "No repository checkout was available and no repository was provided.",
    };
  }

  const clonePath = `.flue-issue-triage-${issueNumber}`;
  const clone = await session.shell(
    `gh repo clone ${shellQuote(repository)} ${shellQuote(clonePath)} -- --filter=blob:none`,
    {
      env: commandEnv,
      signal: AbortSignal.timeout(300_000),
    },
  );

  if (clone.exitCode !== 0) {
    return {
      checkoutAvailable: false,
      repoPath: null,
      remoteUrl: null,
      headSha: null,
      checkoutNote: `Repository clone failed: ${clone.stderr || clone.stdout}`,
    };
  }

  const head = await session.shell("git rev-parse HEAD", {
    cwd: clonePath,
    signal: AbortSignal.timeout(30_000),
  });

  return {
    checkoutAvailable: true,
    repoPath: clonePath,
    remoteUrl: repository,
    headSha: head.exitCode === 0 ? head.stdout.trim() : null,
    checkoutNote:
      "Cloned the repository with gh repo clone using a GitHub App installation token.",
  };
}

export async function run({
  init,
  payload,
  env,
  log,
}: FlueContext<unknown, Env>) {
  const { issueNumber, repository } = v.parse(payloadSchema, payload);
  logInfo(log, "[issue-triage] Run accepted", { issueNumber, repository });
  const commandEnv = await resolveGithubCommandEnv(env, repository);
  const harness = await init(issueTriageAgent);
  const session = await harness.session(`issue-${issueNumber}`);

  const initialContext = await readIssueContext(
    session,
    commandEnv,
    issueNumber,
    repository,
  );
  logInfo(log, "[issue-triage] Issue context loaded", {
    issueNumber,
    repository,
    issueState: getIssueState(initialContext) ?? "unknown",
  });

  const authorLogin = initialContext.reporter?.login;
  if (authorLogin && IGNORED_AUTHOR_LOGINS.has(authorLogin)) {
    logInfo(log, "[issue-triage] Run ignored", {
      issueNumber,
      repository,
      authorLogin,
      reason: "ignored_author",
    });
    return {
      outcome: "ignored",
      reason: "ignored_author",
      author_login: authorLogin,
      steps: [{ name: "check-author", result: "ignored" }],
      labels_applied: [],
      comment_posted: false,
      title_updated: false,
      body_updated: false,
      issue_closed: false,
      needs_human_review: false,
      summary: `Skipped triage for ignored author ${authorLogin}.`,
    };
  }

  let duplicateSearch: DuplicateSearch;
  try {
    const duplicateCandidates = await collectDuplicateCandidates(
      session,
      commandEnv,
      initialContext,
    );
    logInfo(log, "[issue-triage] Duplicate candidates collected", {
      issueNumber,
      repository,
      candidateCount: duplicateCandidates.length,
    });
    const response = await session.skill("issue-triage", {
      args: {
        stage: "search-duplicates",
        issueNumber,
        repository,
        context: initialContext,
        duplicateCandidates,
      },
      result: duplicateSearchSchema,
      signal: AbortSignal.timeout(300_000),
    });
    duplicateSearch = response.data;
    logInfo(log, "[issue-triage] Duplicate search completed", {
      issueNumber,
      repository,
      status: duplicateSearch.status,
      candidateCount: duplicateSearch.candidates.length,
      duplicateNumber: duplicateSearch.duplicate?.number,
    });
  } catch (error) {
    log.warn("[issue-triage] Duplicate search failed", {
      issueNumber,
      repository,
      error: summarizeAgentFailure(error),
    });
    duplicateSearch = buildDuplicateSearchFailure(error);
  }

  if (duplicateSearch.status === "duplicate") {
    if (!duplicateSearch.duplicate) {
      throw new Error(
        `Duplicate search returned duplicate status without a canonical issue for #${issueNumber}.`,
      );
    }

    const closureContext = await readIssueContext(
      session,
      commandEnv,
      issueNumber,
      repository,
    );
    if (getIssueState(closureContext) === "closed") {
      logInfo(log, "[issue-triage] Duplicate close skipped", {
        issueNumber,
        repository,
        duplicateNumber: duplicateSearch.duplicate.number,
        reason: "already_closed",
      });
      return {
        outcome: "needs_human_review",
        steps: [
          { name: "search-duplicates", result: duplicateSearch.status },
          { name: "close-duplicate", result: "skipped: already closed" },
        ],
        duplicate: duplicateSearch.duplicate,
        labels_applied: [],
        comment_posted: false,
        issue_closed: false,
        needs_human_review: true,
        summary: "Skipped duplicate closure because the issue is already closed.",
      };
    }

    const labelsApplied = await closeDuplicate(
      session,
      commandEnv,
      closureContext,
      duplicateSearch.duplicate,
    );
    logInfo(log, "[issue-triage] Duplicate closed", {
      issueNumber,
      repository,
      duplicateNumber: duplicateSearch.duplicate.number,
      labelsApplied,
    });

    return {
      outcome: "duplicate_closed",
      steps: [
        { name: "search-duplicates", result: duplicateSearch.status },
        { name: "close-duplicate", result: "closed" },
      ],
      duplicate: duplicateSearch.duplicate,
      labels_applied: labelsApplied,
      comment_posted: true,
      summary: `Closed as a duplicate of #${duplicateSearch.duplicate.number}.`,
    };
  }

  const repositoryContext = await prepareRepository(
    session,
    commandEnv,
    issueNumber,
    repository,
  );
  logInfo(log, "[issue-triage] Repository context prepared", {
    issueNumber,
    repository,
    checkoutAvailable: repositoryContext.checkoutAvailable,
    headSha: repositoryContext.headSha,
  });

  const diagnosisContext = await readIssueContext(
    session,
    commandEnv,
    issueNumber,
    repository,
  );
  let diagnosis: Diagnosis;
  try {
    const response = await session.skill("issue-triage", {
      args: {
        stage: "diagnose-and-validate",
        issueNumber,
        repository,
        context: diagnosisContext,
        repositoryContext,
        duplicateSearch,
      },
      result: diagnosisSchema,
      signal: AbortSignal.timeout(900_000),
    });
    diagnosis = response.data;
    assertDiagnosisAnalysis(diagnosis);
    logInfo(log, "[issue-triage] Diagnosis completed", {
      issueNumber,
      repository,
      severity: diagnosis.severity,
      category: diagnosis.category,
      disposition: diagnosis.disposition,
      validity: diagnosis.validity,
      needsHumanReview: diagnosis.needs_human_review,
      shouldClose: diagnosis.should_close ?? false,
    });
  } catch (error) {
    log.warn("[issue-triage] Diagnosis failed", {
      issueNumber,
      repository,
      error: summarizeAgentFailure(error),
    });
    diagnosis = buildDiagnosisFailure(error);
  }

  const updateContext = await readIssueContext(
    session,
    commandEnv,
    issueNumber,
    repository,
  );
  if (issueSnapshot(diagnosisContext) !== issueSnapshot(updateContext)) {
    return {
      outcome: "needs_human_review",
      steps: [
        { name: "search-duplicates", result: duplicateSearch.status },
        {
          name: "prepare-repository",
          result: repositoryContext.checkoutAvailable ? "ready" : "unavailable",
        },
        { name: "diagnose-and-validate", result: diagnosis.validity },
        { name: "apply-triage-update", result: "skipped: issue changed" },
      ],
      severity: diagnosis.severity,
      category: diagnosis.category,
      disposition: diagnosis.disposition,
      validity: diagnosis.validity,
      labels_applied: [],
      comment_posted: false,
      title_updated: false,
      body_updated: false,
      issue_closed: false,
      needs_human_review: true,
      summary: diagnosis.summary,
      update_summary:
        "Skipped triage mutations because the issue changed during analysis.",
      evidence: diagnosis.evidence,
      bug_analysis: diagnosis.bug_analysis,
      gap_analysis: diagnosis.gap_analysis,
    };
  }

  const update = await applyTriageUpdate(
    session,
    commandEnv,
    updateContext,
    diagnosis,
  );
  const outcome = update.issue_closed
    ? update.closure_kind === "invalid"
      ? "closed_invalid"
      : "closed_spam"
    : update.needs_human_review
      ? "needs_human_review"
      : "triaged";
  logInfo(log, "[issue-triage] Run completed", {
    issueNumber,
    repository,
    outcome,
    labelsApplied: update.labels_applied,
    commentPosted: update.comment_posted,
    issueClosed: update.issue_closed,
    closureKind: update.closure_kind,
    closeReason: update.close_reason,
    needsHumanReview: update.needs_human_review,
  });

  return {
    outcome,
    steps: [
      { name: "search-duplicates", result: duplicateSearch.status },
      {
        name: "prepare-repository",
        result: repositoryContext.checkoutAvailable ? "ready" : "unavailable",
      },
      { name: "diagnose-and-validate", result: diagnosis.validity },
      { name: "apply-triage-update", result: update.summary },
    ],
    severity: diagnosis.severity,
    category: diagnosis.category,
    disposition: diagnosis.disposition,
    validity: diagnosis.validity,
    labels_applied: update.labels_applied,
    comment_posted: update.comment_posted,
    title_updated: update.title_updated,
    body_updated: update.body_updated,
    issue_closed: update.issue_closed,
    closure_kind: update.closure_kind,
    close_reason: update.close_reason,
    needs_human_review: update.needs_human_review,
    summary: diagnosis.summary,
    update_summary: update.summary,
    evidence: diagnosis.evidence,
    bug_analysis: diagnosis.bug_analysis,
    gap_analysis: diagnosis.gap_analysis,
  };
}
