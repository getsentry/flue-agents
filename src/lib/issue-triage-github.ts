import type { FlueSession } from "@flue/runtime";

type TokenEnv = {
  GH_TOKEN?: string;
  GITHUB_TOKEN?: string;
};

export type IssueContext = {
  issueNumber: number;
  repository?: string;
  issue: unknown;
  labels: unknown;
  fetchedAt: string;
};

type SpamCloseDiagnosis = {
  close_comment?: string;
  triage_comment?: string;
};

export function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function repoArg(repository?: string) {
  return repository ? ` --repo ${shellQuote(repository)}` : "";
}

export function githubCommandEnv(env: TokenEnv) {
  const token = env.GH_TOKEN?.trim() || env.GITHUB_TOKEN?.trim();
  if (!token) {
    return {};
  }
  return {
    GH_TOKEN: token,
    GITHUB_TOKEN: token,
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

export function findDuplicateLabel(context: IssueContext) {
  return existingLabels(context).get("duplicate") ?? null;
}

export async function runGhCommand(
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

export async function withGhBodyFile<T>(
  session: FlueSession,
  prefix: string,
  body: string,
  callback: (path: string) => Promise<T>,
) {
  const dir = `/workspace/.tmp/issue-triage-${crypto.randomUUID()}`;
  const path = `${dir}/${prefix}.md`;

  await session.fs.mkdir(dir, { recursive: true });
  await session.fs.writeFile(path, body);

  try {
    return await callback(path);
  } finally {
    await session.fs.rm(dir, { recursive: true, force: true });
  }
}

export async function applyLabels(
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

export async function postComment(
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

export function hasPuntingCloseLanguage(comment: string) {
  return /maintainer can decide whether to .*close/i.test(comment);
}

function buildSpamCloseComment() {
  return [
    "Pierre here.",
    "",
    "This is an automated external promotion rather than a repo bug, docs issue, support request, or feature request, so I'm closing it as invalid for normal repo triage.",
  ].join("\n");
}

function selectCloseComment(diagnosis: SpamCloseDiagnosis) {
  const comment =
    diagnosis.close_comment?.trim() || diagnosis.triage_comment?.trim();

  if (comment && /\bclos/i.test(comment) && !hasPuntingCloseLanguage(comment)) {
    return comment;
  }

  return buildSpamCloseComment();
}

export async function closeSpamIssue(
  session: FlueSession,
  commandEnv: Record<string, string>,
  context: IssueContext,
  diagnosis: SpamCloseDiagnosis,
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
