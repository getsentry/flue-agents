import type { FlueSession } from "@flue/runtime";

import {
  PIERRE_COMMENT_OPENER,
  PIERRE_LEGACY_COMMENT_OPENER,
  shouldIntroducePierre,
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
  reporter?: {
    login?: string;
    association?: string;
    trusted?: boolean;
  };
  issue: unknown;
  fetchedAt: string;
};

type SpamCloseDiagnosis = unknown;

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

export async function postComment(
  session: FlueSession,
  commandEnv: GithubCommandEnv,
  context: IssueContext,
  body?: string,
) {
  const comment = body?.trim();
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

export function normalizePierreComment(
  body: string | undefined,
  context: IssueContext,
) {
  const comment = body?.trim();
  if (!comment) {
    return "";
  }

  if (shouldIntroducePierre(context.reporter?.association)) {
    if (comment.startsWith(PIERRE_COMMENT_OPENER)) {
      return comment;
    }

    if (comment.startsWith(PIERRE_LEGACY_COMMENT_OPENER)) {
      return `${PIERRE_COMMENT_OPENER}${comment.slice(PIERRE_LEGACY_COMMENT_OPENER.length)}`;
    }

    return `${PIERRE_COMMENT_OPENER}\n\n${comment}`;
  }

  for (const opener of [
    PIERRE_COMMENT_OPENER,
    PIERRE_LEGACY_COMMENT_OPENER,
  ]) {
    if (comment.startsWith(opener)) {
      return comment.slice(opener.length).trimStart();
    }
  }

  return comment;
}

export const PIERRE_SPAM_CLOSE_COMMENTS = [
  [
    PIERRE_COMMENT_OPENER,
    "",
    "This is external promotion, not repository work. I'm closing it as invalid.",
  ].join("\n"),
  [
    PIERRE_COMMENT_OPENER,
    "",
    "This is promotional outreach, not a bug, documentation problem, or feature request. I'm closing it as invalid.",
  ].join("\n"),
  [
    PIERRE_COMMENT_OPENER,
    "",
    "This is promotion for an external listing and does not identify repository work. I'm closing it as invalid.",
  ].join("\n"),
  [
    PIERRE_COMMENT_OPENER,
    "",
    "This is external promotion with no repository problem or requested change. I'm closing it as invalid.",
  ].join("\n"),
  [
    PIERRE_COMMENT_OPENER,
    "",
    "This is outreach for an external service, not an actionable repository issue. I'm closing it as invalid.",
  ].join("\n"),
] as const;

export const PIERRE_INVALID_CLOSE_COMMENTS = [
  [
    PIERRE_COMMENT_OPENER,
    "",
    "I'm closing this as invalid because it does not identify a concrete repository problem or proposed change. A focused issue should describe the current limitation and the outcome you need.",
  ].join("\n"),
  [
    PIERRE_COMMENT_OPENER,
    "",
    "There is no concrete bug or repository change to act on here, so I'm closing this as invalid. Please open a focused issue with the current behavior and the result you want.",
  ].join("\n"),
  [
    PIERRE_COMMENT_OPENER,
    "",
    "This does not describe a concrete repository problem or change, so I'm closing it as invalid. A new issue should include the current limitation, affected users, and desired outcome.",
  ].join("\n"),
  [
    PIERRE_COMMENT_OPENER,
    "",
    "I cannot identify a repository action from this report, so I'm closing it as invalid. Please describe the problem the current implementation causes and the specific change you need.",
  ].join("\n"),
  [
    PIERRE_COMMENT_OPENER,
    "",
    "This is missing the concrete problem maintainers would need to act on, so I'm closing it as invalid. Please open a focused issue with an example and the expected result.",
  ].join("\n"),
] as const;

function selectStaticPierreComment(
  variants: readonly string[],
  context: IssueContext,
) {
  if (variants.length === 0) {
    throw new Error("At least one Pierre comment variant is required.");
  }

  return variants[context.issueNumber % variants.length] ?? variants[0];
}

export function buildSpamCloseComment(context: IssueContext) {
  return selectStaticPierreComment(PIERRE_SPAM_CLOSE_COMMENTS, context);
}

export function buildInvalidCloseComment(context: IssueContext) {
  return selectStaticPierreComment(PIERRE_INVALID_CLOSE_COMMENTS, context);
}

/** Closes spam with a static Pierre comment, never generated diagnosis prose. */
export async function closeSpamIssue(
  session: FlueSession,
  commandEnv: GithubCommandEnv,
  context: IssueContext,
  _diagnosis: SpamCloseDiagnosis,
) {
  const commentPosted = await postComment(
    session,
    commandEnv,
    context,
    normalizePierreComment(buildSpamCloseComment(context), context),
  );
  await runGhCommand(
    session,
    commandEnv,
    `gh issue close ${context.issueNumber}${repoArg(context.repository)} --reason ${shellQuote("not planned")}`,
    "Closing spam issue",
  );

  return commentPosted;
}
