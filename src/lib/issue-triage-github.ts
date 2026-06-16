import type { FlueSession } from "@flue/runtime";

import {
  PIERRE_COMMENT_OPENER,
  PIERRE_LEGACY_COMMENT_OPENER,
} from "./pierre.ts";

type TokenEnv = {
  GITHUB_APP_CLIENT_ID?: string;
  GITHUB_APP_INSTALLATION_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
};

declare const githubCommandEnvBrand: unique symbol;

export type GithubCommandEnv = Record<string, string> & {
  readonly GH_TOKEN: string;
  readonly GITHUB_TOKEN: string;
  readonly [githubCommandEnvBrand]: true;
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

type IssueCloseDiagnosis = SpamCloseDiagnosis;

export function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function repoArg(repository?: string) {
  return repository ? ` --repo ${shellQuote(repository)}` : "";
}

function encodeBase64Url(value: string | ArrayBuffer) {
  const bytes =
    typeof value === "string"
      ? new TextEncoder().encode(value)
      : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeBase64(value: string) {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function encodeDerLength(length: number) {
  if (length < 0x80) {
    return Uint8Array.of(length);
  }

  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function concatBytes(...arrays: Uint8Array[]) {
  const output = new Uint8Array(
    arrays.reduce((sum, array) => sum + array.length, 0),
  );
  let offset = 0;
  for (const array of arrays) {
    output.set(array, offset);
    offset += array.length;
  }
  return output;
}

function derSequence(...items: Uint8Array[]) {
  const body = concatBytes(...items);
  return concatBytes(Uint8Array.of(0x30), encodeDerLength(body.length), body);
}

function derInteger(value: number) {
  return Uint8Array.of(0x02, 0x01, value);
}

function derOctetString(value: Uint8Array) {
  return concatBytes(Uint8Array.of(0x04), encodeDerLength(value.length), value);
}

function normalizeGitHubPrivateKey(privateKey: string) {
  const pem = privateKey.trim().replace(/\\n/g, "\n");
  const match = pem.match(
    /-----BEGIN (RSA )?PRIVATE KEY-----([\s\S]+?)-----END (RSA )?PRIVATE KEY-----/,
  );
  if (!match) {
    throw new Error("GITHUB_APP_PRIVATE_KEY must be a PEM private key.");
  }

  const der = decodeBase64(match[2]);
  if (!match[1]) {
    return der;
  }

  const rsaEncryptionOid = Uint8Array.of(
    0x06,
    0x09,
    0x2a,
    0x86,
    0x48,
    0x86,
    0xf7,
    0x0d,
    0x01,
    0x01,
    0x01,
  );
  const algorithm = derSequence(rsaEncryptionOid, Uint8Array.of(0x05, 0x00));
  return derSequence(derInteger(0), algorithm, derOctetString(der));
}

async function createGitHubAppJwt(env: TokenEnv) {
  const issuer = env.GITHUB_APP_CLIENT_ID?.trim();
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.trim();
  if (!issuer || !privateKey) {
    throw new Error(
      "GITHUB_APP_CLIENT_ID and GITHUB_APP_PRIVATE_KEY are required for GitHub App authentication.",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = encodeBase64Url(
    JSON.stringify({
      iat: now - 60,
      exp: now + 9 * 60,
      iss: issuer,
    }),
  );
  const data = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    normalizeGitHubPrivateKey(privateKey),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(data),
  );
  return `${data}.${encodeBase64Url(signature)}`;
}

async function createInstallationToken(env: TokenEnv, repository?: string) {
  const installationId = env.GITHUB_APP_INSTALLATION_ID?.trim();
  if (!installationId) {
    throw new Error(
      "GITHUB_APP_INSTALLATION_ID is required for GitHub App authentication.",
    );
  }

  const jwt = await createGitHubAppJwt(env);
  const body: {
    repositories?: string[];
    permissions: {
      contents: "read";
      issues: "write";
    };
  } = {
    permissions: {
      contents: "read",
      issues: "write",
    },
  };

  if (repository) {
    body.repositories = [repository.split("/")[1]];
  }

  const response = await fetch(
    `https://api.github.com/app/installations/${encodeURIComponent(
      installationId,
    )}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
        "User-Agent": "sentry-flue-agents",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Creating GitHub App installation token failed: ${response.status} ${response.statusText} ${text}`.trim(),
    );
  }

  const payload: unknown = await response.json();
  if (!isRecord(payload) || typeof payload.token !== "string") {
    throw new Error("Creating GitHub App installation token returned no token.");
  }
  return payload.token;
}

export async function resolveGithubCommandEnv(env: TokenEnv, repository?: string) {
  const token = await createInstallationToken(env, repository);
  return {
    GH_TOKEN: token,
    GITHUB_TOKEN: token,
  } as GithubCommandEnv;
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

export function findInvalidLabel(context: IssueContext) {
  return existingLabels(context).get("invalid") ?? null;
}

export async function runGhCommand(
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
    await session.shell(`rm -rf ${shellQuote(dir)}`);
  }
}

export async function applyLabels(
  session: FlueSession,
  commandEnv: GithubCommandEnv,
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
  commandEnv: GithubCommandEnv,
  context: IssueContext,
  body?: string,
) {
  const comment = normalizePierreComment(body);
  if (!comment) {
    return false;
  }

  await withGhBodyFile(
    session,
    `issue-${context.issueNumber}-comment`,
    comment,
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

function normalizePierreComment(body?: string) {
  const comment = body?.trim();
  if (!comment) {
    return "";
  }

  return comment.replace(
    new RegExp(`^${PIERRE_LEGACY_COMMENT_OPENER.replace(".", "\\.")}`),
    PIERRE_COMMENT_OPENER,
  );
}

export const PIERRE_SPAM_CLOSE_COMMENTS = [
  [
    PIERRE_COMMENT_OPENER,
    "",
    "Merci for the note. This looks like an automated outside promotion, not a repo issue we can work on. I'm closing it as invalid so the tracker stays tidy.",
  ].join("\n"),
  [
    PIERRE_COMMENT_OPENER,
    "",
    "I had a look. This appears to be an automated outside promotion, not a repo issue we can work on. I'm closing it as invalid so the tracker stays tidy.",
  ].join("\n"),
  [
    PIERRE_COMMENT_OPENER,
    "",
    "Merci. This reads as an automated outside promotion, not a repo issue we can work on. I'm closing it as invalid so the tracker stays tidy.",
  ].join("\n"),
  [
    PIERRE_COMMENT_OPENER,
    "",
    "A small note from my side: this looks like an automated outside promotion, not a repo issue we can work on. I'm closing it as invalid so the tracker stays tidy.",
  ].join("\n"),
  [
    PIERRE_COMMENT_OPENER,
    "",
    "Merci for sending this over. This looks like an automated outside promotion, not a repo issue we can work on. I'm closing it as invalid so the tracker stays tidy.",
  ].join("\n"),
] as const;

export const PIERRE_INVALID_CLOSE_COMMENTS = [
  [
    PIERRE_COMMENT_OPENER,
    "",
    "Merci for the report. I don't see a concrete repo problem or change for maintainers to act on here, so I'm closing this as invalid.",
  ].join("\n"),
  [
    PIERRE_COMMENT_OPENER,
    "",
    "I had a look. I don't see a concrete repo problem or change for maintainers to act on here, so I'm closing this as invalid.",
  ].join("\n"),
  [
    PIERRE_COMMENT_OPENER,
    "",
    "Merci. I don't see a concrete repo problem or change for maintainers to act on here, so I'm closing this as invalid.",
  ].join("\n"),
  [
    PIERRE_COMMENT_OPENER,
    "",
    "A small note from my side: I don't see a concrete repo problem or change for maintainers to act on here, so I'm closing this as invalid.",
  ].join("\n"),
  [
    PIERRE_COMMENT_OPENER,
    "",
    "Merci for writing this up. I don't see a concrete repo problem or change for maintainers to act on here, so I'm closing this as invalid.",
  ].join("\n"),
] as const;

function selectStaticPierreComment(variants: readonly string[]) {
  return variants[Math.floor(Math.random() * variants.length)] ?? variants[0];
}

function buildSpamCloseComment() {
  return selectStaticPierreComment(PIERRE_SPAM_CLOSE_COMMENTS);
}

function buildInvalidCloseComment() {
  return selectStaticPierreComment(PIERRE_INVALID_CLOSE_COMMENTS);
}

function selectCloseComment(
  diagnosis: IssueCloseDiagnosis,
  fallback: () => string,
) {
  const comment =
    diagnosis.close_comment?.trim() || diagnosis.triage_comment?.trim();

  if (comment && /\bclos/i.test(comment) && !hasPuntingCloseLanguage(comment)) {
    return normalizePierreComment(comment);
  }

  return fallback();
}

export async function closeSpamIssue(
  session: FlueSession,
  commandEnv: GithubCommandEnv,
  context: IssueContext,
  diagnosis: SpamCloseDiagnosis,
) {
  const commentPosted = await postComment(
    session,
    commandEnv,
    context,
    selectCloseComment(diagnosis, buildSpamCloseComment),
  );
  await runGhCommand(
    session,
    commandEnv,
    `gh issue close ${context.issueNumber}${repoArg(context.repository)} --reason ${shellQuote("not planned")}`,
    "Closing spam issue",
  );

  return commentPosted;
}

export async function closeInvalidIssue(
  session: FlueSession,
  commandEnv: GithubCommandEnv,
  context: IssueContext,
  diagnosis: IssueCloseDiagnosis,
) {
  const commentPosted = await postComment(
    session,
    commandEnv,
    context,
    selectCloseComment(diagnosis, buildInvalidCloseComment),
  );
  await runGhCommand(
    session,
    commandEnv,
    `gh issue close ${context.issueNumber}${repoArg(context.repository)} --reason ${shellQuote("not planned")}`,
    "Closing invalid issue",
  );

  return commentPosted;
}
