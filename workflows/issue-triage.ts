import type { Sandbox } from "@cloudflare/sandbox";
import type {
  FlueContext,
  FlueSession,
  WorkflowRouteHandler,
} from "@flue/runtime";
import * as v from "valibot";

import issueTriageAgent from "../agents/issue-triage";

export const route: WorkflowRouteHandler = async (_c, next) => next();

type Env = {
  GH_TOKEN?: string;
  GITHUB_TOKEN?: string;
  FLUE_TRIAGE_MODEL?: string;
  Sandbox: DurableObjectNamespace<Sandbox>;
};

const repositorySchema = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
);

const payloadSchema = v.object({
  issueNumber: v.pipe(v.number(), v.integer(), v.minValue(1)),
  repository: v.optional(repositorySchema),
});

const severitySchema = v.picklist(["low", "medium", "high", "critical"]);
const categorySchema = v.picklist([
  "bug",
  "documentation",
  "feature_request",
  "support",
  "security",
  "maintenance",
  "unknown",
]);
const dispositionSchema = v.picklist([
  "actionable",
  "needs_more_info",
  "low_actionability",
  "impractical_scope",
  "spam",
  "unclear",
]);
const rewriteModeSchema = v.picklist([
  "none",
  "light_cleanup",
  "technical_diagnosis",
  "scope_clarification",
]);
const closeReasonSchema = v.picklist(["not planned"]);

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

const diagnosisSchema = v.object({
  severity: severitySchema,
  category: categorySchema,
  disposition: dispositionSchema,
  rewrite_mode: rewriteModeSchema,
  validity: v.picklist(["confirmed", "likely", "not_reproducible", "unclear"]),
  summary: v.string(),
  evidence: v.array(v.string()),
  labels_to_apply: v.array(v.string()),
  should_comment: v.boolean(),
  should_update_issue: v.boolean(),
  proposed_title: v.optional(v.string()),
  proposed_body: v.optional(v.string()),
  triage_comment: v.optional(v.string()),
  update_comment: v.optional(v.string()),
  should_close: v.optional(v.boolean()),
  close_reason: v.optional(closeReasonSchema),
  close_comment: v.optional(v.string()),
  needs_human_review: v.boolean(),
});
type Diagnosis = v.InferOutput<typeof diagnosisSchema>;

const updateSchema = v.object({
  title_updated: v.boolean(),
  body_updated: v.boolean(),
  labels_applied: v.array(v.string()),
  comment_posted: v.boolean(),
  issue_closed: v.boolean(),
  close_reason: v.optional(closeReasonSchema),
  needs_human_review: v.boolean(),
  summary: v.string(),
});

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

function buildDuplicateSearchFailure(error: unknown): DuplicateSearch {
  return {
    status: "uncertain",
    candidates: [],
    rationale: summarizeAgentFailure(error),
  };
}

function buildDiagnosisFailure(error: unknown): Diagnosis {
  return {
    severity: "low",
    category: "unknown",
    disposition: "unclear",
    rewrite_mode: "none",
    validity: "unclear",
    summary:
      "Automated triage could not complete, so the issue is left unchanged for maintainer review.",
    evidence: [summarizeAgentFailure(error)],
    labels_to_apply: [],
    should_comment: false,
    should_update_issue: false,
    needs_human_review: true,
  };
}

type IssueContext = {
  issueNumber: number;
  repository?: string;
  issue: unknown;
  labels: unknown;
  fetchedAt: string;
};

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function repoArg(repository?: string) {
  return repository ? ` --repo ${shellQuote(repository)}` : "";
}

function githubCommandEnv(env: Env) {
  const token = env.GH_TOKEN ?? env.GITHUB_TOKEN;
  if (!token) {
    return {};
  }
  return {
    GH_TOKEN: token,
    GITHUB_TOKEN: token,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getIssueState(context: IssueContext) {
  if (!isRecord(context.issue) || typeof context.issue.state !== "string") {
    return null;
  }
  return context.issue.state.toLowerCase();
}

function getIssueTitle(context: IssueContext) {
  if (!isRecord(context.issue) || typeof context.issue.title !== "string") {
    return "";
  }
  return context.issue.title;
}

function getIssueBody(context: IssueContext) {
  if (!isRecord(context.issue) || typeof context.issue.body !== "string") {
    return "";
  }
  return context.issue.body;
}

function existingLabels(context: IssueContext) {
  if (!Array.isArray(context.labels)) {
    return new Map<string, string>();
  }

  const labels = new Map<string, string>();
  for (const label of context.labels) {
    if (isRecord(label) && typeof label.name === "string") {
      labels.set(label.name.toLowerCase(), label.name);
    }
  }
  return labels;
}

function filterExistingLabels(context: IssueContext, labels: string[]) {
  const available = existingLabels(context);
  const result = new Map<string, string>();

  for (const label of labels) {
    const existing = available.get(label.toLowerCase());
    if (existing) {
      result.set(existing.toLowerCase(), existing);
    }
  }

  return Array.from(result.values());
}

function findDuplicateLabel(context: IssueContext) {
  return existingLabels(context).get("duplicate") ?? null;
}

async function readJsonCommand(
  session: FlueSession,
  commandEnv: Record<string, string>,
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

async function runGhCommand(
  session: FlueSession,
  commandEnv: Record<string, string>,
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
}

async function withGhBodyFile<T>(
  session: FlueSession,
  prefix: string,
  body: string,
  callback: (path: string) => Promise<T>,
) {
  const dir = `/workspace/.tmp/issue-triage-${crypto.randomUUID()}`;
  const path = `${dir}/${prefix}.md`;

  await session.fs.writeFile(path, body);

  try {
    return await callback(path);
  } finally {
    await session.fs.rm(dir, { recursive: true, force: true });
  }
}

async function applyLabels(
  session: FlueSession,
  commandEnv: Record<string, string>,
  context: IssueContext,
  labels: string[],
) {
  const repo = repoArg(context.repository);
  const applied: string[] = [];

  for (const label of filterExistingLabels(context, labels)) {
    await runGhCommand(
      session,
      commandEnv,
      `gh issue edit ${context.issueNumber}${repo} --add-label ${shellQuote(label)}`,
      `Applying label ${label}`,
    );
    applied.push(label);
  }

  return applied;
}

async function editIssueTitle(
  session: FlueSession,
  commandEnv: Record<string, string>,
  context: IssueContext,
  title?: string,
) {
  const nextTitle = title?.trim();
  if (!nextTitle || nextTitle === getIssueTitle(context).trim()) {
    return false;
  }

  await runGhCommand(
    session,
    commandEnv,
    `gh issue edit ${context.issueNumber}${repoArg(context.repository)} --title ${shellQuote(nextTitle)}`,
    "Updating issue title",
  );
  return true;
}

async function editIssueBody(
  session: FlueSession,
  commandEnv: Record<string, string>,
  context: IssueContext,
  body?: string,
) {
  const nextBody = body?.trim();
  if (!nextBody || nextBody === getIssueBody(context).trim()) {
    return false;
  }

  await withGhBodyFile(
    session,
    `issue-${context.issueNumber}-body`,
    nextBody,
    (path) =>
      runGhCommand(
        session,
        commandEnv,
        `gh issue edit ${context.issueNumber}${repoArg(context.repository)} --body-file ${shellQuote(path)}`,
        "Updating issue body",
      ),
  );
  return true;
}

async function postComment(
  session: FlueSession,
  commandEnv: Record<string, string>,
  context: IssueContext,
  body?: string,
) {
  if (!body?.trim()) {
    return false;
  }

  await withGhBodyFile(
    session,
    `issue-${context.issueNumber}-comment`,
    body.trim(),
    (path) =>
      runGhCommand(
        session,
        commandEnv,
        `gh issue comment ${context.issueNumber}${repoArg(context.repository)} --body-file ${shellQuote(path)}`,
        "Posting issue comment",
      ),
  );
  return true;
}

async function closeDuplicate(
  session: FlueSession,
  commandEnv: Record<string, string>,
  context: IssueContext,
  duplicate: v.InferOutput<typeof duplicateCandidateSchema>,
) {
  const duplicateLabel = findDuplicateLabel(context);
  const labelsApplied = duplicateLabel
    ? await applyLabels(session, commandEnv, context, [duplicateLabel])
    : [];
  const comment = [
    `Thanks for the report. This appears to duplicate #${duplicate.number}.`,
    "",
    `Closing this so discussion and updates stay in one place. Please follow #${duplicate.number} for progress.`,
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

function shouldCloseAsSpam(diagnosis: Diagnosis) {
  return (
    diagnosis.should_close === true &&
    diagnosis.close_reason === "not planned" &&
    diagnosis.disposition === "spam" &&
    diagnosis.severity === "low" &&
    diagnosis.category !== "security" &&
    diagnosis.needs_human_review === false
  );
}

function hasPuntingCloseLanguage(comment: string) {
  return /maintainer can decide whether to .*close/i.test(comment);
}

function buildSpamCloseComment() {
  return [
    "Triage bot here.",
    "",
    "This is an automated external promotion rather than a repo bug, docs issue, support request, or feature request, so I'm closing it as invalid for normal repo triage.",
  ].join("\n");
}

function buildUnsafeCloseComment(diagnosis: Diagnosis) {
  const lines = [
    "Triage bot here.",
    "",
    "The agent flagged this for spam closure, but the request did not pass the auto-close guardrails, so I left it open for maintainer review.",
  ];

  if (diagnosis.summary.trim()) {
    lines.push("", `Current read: ${diagnosis.summary.trim()}`);
  }

  return lines.join("\n");
}

function selectCloseComment(diagnosis: Diagnosis) {
  const comment =
    diagnosis.close_comment?.trim() || diagnosis.triage_comment?.trim();

  if (comment && /\bclos/i.test(comment) && !hasPuntingCloseLanguage(comment)) {
    return comment;
  }

  return buildSpamCloseComment();
}

function selectUnsafeCloseComment(diagnosis: Diagnosis) {
  const comment =
    diagnosis.triage_comment?.trim() || diagnosis.close_comment?.trim();

  if (
    comment &&
    !/\bclos/i.test(comment) &&
    !hasPuntingCloseLanguage(comment)
  ) {
    return comment;
  }

  return buildUnsafeCloseComment(diagnosis);
}

async function closeSpamIssue(
  session: FlueSession,
  commandEnv: Record<string, string>,
  context: IssueContext,
  diagnosis: Diagnosis,
) {
  const commentPosted = await postComment(
    session,
    commandEnv,
    context,
    selectCloseComment(diagnosis),
  );
  await runGhCommand(
    session,
    commandEnv,
    `gh issue close ${context.issueNumber}${repoArg(context.repository)} --reason ${shellQuote("not planned")}`,
    "Closing spam issue",
  );

  return commentPosted;
}

function buildIssueUpdateComment(
  diagnosis: v.InferOutput<typeof diagnosisSchema>,
) {
  const evidence = diagnosis.evidence
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
  const lines = ["Triage bot here.", ""];

  switch (diagnosis.rewrite_mode) {
    case "light_cleanup":
      lines.push(
        "I did a light cleanup so the issue is easier to scan without changing the ask.",
      );
      break;
    case "scope_clarification":
      lines.push(
        "I trimmed this to the current ask and what is still missing for maintainers.",
      );
      break;
    case "technical_diagnosis":
      lines.push(
        "I updated the issue with the repository context that seemed relevant.",
      );
      break;
    case "none":
      lines.push("I added a short triage note for maintainer review.");
      break;
  }

  if (diagnosis.summary.trim()) {
    lines.push("", `Current read: ${diagnosis.summary.trim()}`);
  }

  if (diagnosis.rewrite_mode === "technical_diagnosis" && evidence.length > 0) {
    lines.push("", "What I checked:");
    for (const item of evidence) {
      lines.push(`- ${item}`);
    }
  }

  lines.push("", "A maintainer will take it from here.");

  return lines.join("\n");
}

function selectTriageComment(
  diagnosis: v.InferOutput<typeof diagnosisSchema>,
  bodyUpdated: boolean,
) {
  if (bodyUpdated) {
    return (
      diagnosis.update_comment?.trim() ||
      diagnosis.triage_comment?.trim() ||
      buildIssueUpdateComment(diagnosis)
    );
  }

  if (!diagnosis.should_comment) {
    return undefined;
  }

  return diagnosis.triage_comment?.trim();
}

async function applyTriageUpdate(
  session: FlueSession,
  commandEnv: Record<string, string>,
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

  const labelsApplied = await applyLabels(
    session,
    commandEnv,
    context,
    diagnosis.labels_to_apply,
  );
  let titleUpdated = false;
  let bodyUpdated = false;
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
      close_reason: "not planned",
      needs_human_review: false,
      summary: "Closed issue as spam.",
    };
  }

  const unsafeCloseRequest = diagnosis.should_close === true;

  if (diagnosis.should_update_issue) {
    titleUpdated = await editIssueTitle(
      session,
      commandEnv,
      context,
      diagnosis.proposed_title,
    );
    bodyUpdated = await editIssueBody(
      session,
      commandEnv,
      context,
      diagnosis.proposed_body,
    );

    const comment = unsafeCloseRequest
      ? selectUnsafeCloseComment(diagnosis)
      : selectTriageComment(diagnosis, bodyUpdated);
    if (comment) {
      commentPosted = await postComment(session, commandEnv, context, comment);
    }
  } else {
    const comment = unsafeCloseRequest
      ? selectUnsafeCloseComment(diagnosis)
      : selectTriageComment(diagnosis, false);
    if (comment) {
      commentPosted = await postComment(session, commandEnv, context, comment);
    }
  }

  const changed = [
    titleUpdated ? "title" : null,
    bodyUpdated ? "body" : null,
    labelsApplied.length > 0 ? "labels" : null,
    commentPosted ? "comment" : null,
  ].filter(Boolean);

  return {
    title_updated: titleUpdated,
    body_updated: bodyUpdated,
    labels_applied: labelsApplied,
    comment_posted: commentPosted,
    issue_closed: false,
    needs_human_review: diagnosis.needs_human_review || unsafeCloseRequest,
    summary: unsafeCloseRequest
      ? "Skipped unsafe spam close request and left the issue open for maintainer review."
      : changed.length > 0
        ? `Updated issue ${changed.join(", ")}.`
        : "No issue update was needed.",
  };
}

async function readIssueContext(
  session: FlueSession,
  commandEnv: Record<string, string>,
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

  return context;
}

async function prepareRepository(
  session: FlueSession,
  commandEnv: Record<string, string>,
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
      "Cloned the repository with gh repo clone using the GitHub token.",
  };
}

export async function run({
  init,
  payload,
  env,
  log,
}: FlueContext<unknown, Env>) {
  const { issueNumber, repository } = v.parse(payloadSchema, payload);
  const commandEnv = githubCommandEnv(env);
  if (!commandEnv.GH_TOKEN) {
    throw new Error(
      "GH_TOKEN or GITHUB_TOKEN is required to triage GitHub issues.",
    );
  }
  const harness = await init(issueTriageAgent);
  const session = await harness.session(`issue-${issueNumber}`);

  const initialContext = await readIssueContext(
    session,
    commandEnv,
    issueNumber,
    repository,
  );
  let duplicateSearch: DuplicateSearch;
  try {
    const response = await session.skill("issue-triage", {
      args: {
        stage: "search-duplicates",
        issueNumber,
        repository,
        context: initialContext,
      },
      result: duplicateSearchSchema,
      signal: AbortSignal.timeout(300_000),
    });
    duplicateSearch = response.data;
  } catch (error) {
    log.warn("[issue-triage] Duplicate search failed", {
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
    const labelsApplied = await closeDuplicate(
      session,
      commandEnv,
      closureContext,
      duplicateSearch.duplicate,
    );

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
  } catch (error) {
    log.warn("[issue-triage] Diagnosis failed", {
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
  const update = await applyTriageUpdate(
    session,
    commandEnv,
    updateContext,
    diagnosis,
  );

  return {
    outcome: update.issue_closed
      ? "closed_spam"
      : update.needs_human_review
        ? "needs_human_review"
        : "triaged",
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
    rewrite_mode: diagnosis.rewrite_mode,
    validity: diagnosis.validity,
    labels_applied: update.labels_applied,
    comment_posted: update.comment_posted,
    title_updated: update.title_updated,
    body_updated: update.body_updated,
    issue_closed: update.issue_closed,
    close_reason: update.close_reason,
    needs_human_review: update.needs_human_review,
    summary: update.summary,
  };
}
