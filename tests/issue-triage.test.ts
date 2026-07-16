import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { mock, type TestContext } from "node:test";
import * as v from "valibot";

import { issueTriageEvalDiagnosisSchema } from "../src/lib/issue-triage-eval.ts";
import {
  assertDiagnosisAnalysis,
  type IssueTriageDiagnosis,
} from "../src/lib/issue-triage-analysis.ts";
import {
  shouldCloseAsInvalidLowSignal,
  shouldCloseAsSpam,
} from "../src/lib/issue-triage-close-decision.ts";
import {
  applyLabels,
  closeSpamIssue,
  PIERRE_INVALID_CLOSE_COMMENTS,
  PIERRE_SPAM_CLOSE_COMMENTS,
  postComment,
  resolveGithubCommandEnv,
  type IssueContext,
} from "../src/lib/issue-triage-github.ts";
import { PIERRE_PERSONALITY } from "../src/lib/pierre.ts";

type ShellCall = {
  command: string;
  env?: Record<string, string>;
};

const baseDiagnosis = {
  severity: "low",
  category: "feature_request",
  disposition: "actionable",
  validity: "likely",
  summary: "Clear request.",
  evidence: [],
  labels_to_apply: [],
  needs_human_review: false,
} as const;

function assertCompleteFollowupSchema(schema: v.GenericSchema) {
  const incomplete = v.parse(schema, {
    ...baseDiagnosis,
    followup_comment: "I found a concrete repository detail.",
  });
  const blank = v.parse(schema, {
    ...baseDiagnosis,
    followup_kind: "technical_diagnosis",
    followup_rationale: " ",
    followup_comment: "I found a concrete repository detail.",
  });
  const complete = v.parse(schema, {
    ...baseDiagnosis,
    followup_kind: "technical_diagnosis",
    followup_rationale: "Adds repository evidence.",
    followup_comment: "I found a concrete repository detail.",
  });

  assert.equal(incomplete.followup_comment, undefined);
  assert.equal("followup_kind" in incomplete, false);
  assert.equal("followup_rationale" in incomplete, false);
  assert.equal("followup_comment" in incomplete, false);
  assert.equal(blank.followup_kind, undefined);
  assert.equal("followup_kind" in blank, false);
  assert.equal("followup_rationale" in blank, false);
  assert.equal("followup_comment" in blank, false);
  assert.equal(complete.followup_kind, "technical_diagnosis");
}

test("normalizes incomplete follow-up metadata in evals", () => {
  assertCompleteFollowupSchema(issueTriageEvalDiagnosisSchema);
});

function mockModuleOnce(
  specifier: string,
  options: Parameters<typeof mock.module>[1],
) {
  try {
    mock.module(specifier, options);
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        error.code === "ERR_INVALID_STATE"
      )
    ) {
      throw error;
    }
  }
}

async function readSpamFixture() {
  const fixtureUrl = new URL(
    "../fixtures/issue-triage/external-registry-spam-1059.json",
    import.meta.url,
  );
  return JSON.parse(await readFile(fixtureUrl, "utf8"));
}

async function readInvalidLowSignalFixture() {
  const fixtureUrl = new URL(
    "../fixtures/issue-triage/invalid-low-signal-rewrite-1.json",
    import.meta.url,
  );
  return JSON.parse(await readFile(fixtureUrl, "utf8"));
}

async function readMemberActionableFixture() {
  const fixtureUrl = new URL(
    "../fixtures/issue-triage/member-actionable-sentry-mcp-1111.json",
    import.meta.url,
  );
  return {
    ...JSON.parse(await readFile(fixtureUrl, "utf8")),
    modelComment:
      "Hi, I'm Pierre!\n\nMerci for the report. I checked the repository and confirmed that neither the `GET /api/0/issues/{issue_id}/user-reports/` endpoint nor a `user_report` entry schema exists today. The gap is real.\n\nThe issue description already covers the two sensible implementation paths. A maintainer can take it from here.",
    expectedCommentPosted: false,
  };
}

async function readMemberTrackingFixture() {
  const fixtureUrl = new URL(
    "../fixtures/issue-triage/member-tracking-junior-622.json",
    import.meta.url,
  );
  return {
    ...JSON.parse(await readFile(fixtureUrl, "utf8")),
    modelComment:
      "Hi, I'm Pierre!\n\nThis is a thorough analysis — thanks for surfacing the patterns. The existing ast-grep/oxlint setup you describe is in place, so the wiring should be straightforward.\n\nA quick note: this is a large tracking issue with ~12 tasks. The recommended first slice at the bottom is probably the right place to start. If you want pieces picked up by other contributors, splitting a few of those into smaller issues would make ownership clearer.\n\nMerci for the detailed write-up.",
    expectedCommentPosted: false,
  };
}

function base64FromBytes(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function pemFromPkcs8(pkcs8: ArrayBuffer) {
  const base64 = base64FromBytes(new Uint8Array(pkcs8));
  const lines = base64.match(/.{1,64}/g) ?? [];
  return [
    "-----BEGIN PRIVATE KEY-----",
    ...lines,
    "-----END PRIVATE KEY-----",
  ].join("\n");
}

async function generateTestGitHubPrivateKey() {
  const key = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: Uint8Array.of(1, 0, 1),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  return pemFromPkcs8(await crypto.subtle.exportKey("pkcs8", key.privateKey));
}

test("requires explicit closure approval", () => {
  const diagnosis = {
    disposition: "spam",
    severity: "low",
    category: "maintenance",
    labels_to_apply: ["invalid"],
    needs_human_review: false,
  };
  const context: IssueContext = {
    issueNumber: 1,
    issue: {},
    labels: [{ name: "invalid" }],
    fetchedAt: "2026-07-15T00:00:00Z",
  };

  assert.equal(shouldCloseAsSpam(diagnosis), false);
  assert.equal(shouldCloseAsInvalidLowSignal(context, diagnosis), false);
  assert.equal(shouldCloseAsSpam({ ...diagnosis, should_close: true }), true);
});

test("requires structured root cause and gap analysis", () => {
  const base = {
    severity: "medium",
    category: "bug",
    disposition: "actionable",
    validity: "confirmed",
    summary: "A bug exists.",
    evidence: ["The source path proves the behavior."],
    labels_to_apply: [],
    should_close: false,
    needs_human_review: false,
  } as IssueTriageDiagnosis;

  assert.throws(() => assertDiagnosisAnalysis(base), /bug_analysis/);
  assert.throws(
    () =>
      assertDiagnosisAnalysis({
        ...base,
        category: "feature_request",
        validity: "likely",
      }),
    /gap_analysis/,
  );
});

test("keeps issue triage exposed only through the workflow route", async () => {
  const agentUrl = new URL("../src/agents/issue-triage.ts", import.meta.url);
  const workflowUrl = new URL("../src/workflows/issue-triage.ts", import.meta.url);
  const [agentSource, workflowSource] = await Promise.all([
    readFile(agentUrl, "utf8"),
    readFile(workflowUrl, "utf8"),
  ]);

  assert.doesNotMatch(agentSource, /export\s+const\s+route\b/);
  assert.match(workflowSource, /export\s+const\s+route\b/);
});

test("defines multiple hardcoded Pierre close comment variants", () => {
  assert.ok(PIERRE_SPAM_CLOSE_COMMENTS.length >= 5);
  assert.ok(PIERRE_INVALID_CLOSE_COMMENTS.length >= 5);
  assert.equal(
    new Set(PIERRE_SPAM_CLOSE_COMMENTS).size,
    PIERRE_SPAM_CLOSE_COMMENTS.length,
  );
  assert.equal(
    new Set(PIERRE_INVALID_CLOSE_COMMENTS).size,
    PIERRE_INVALID_CLOSE_COMMENTS.length,
  );

  for (const comment of PIERRE_SPAM_CLOSE_COMMENTS) {
    assert.match(comment, /^Hi, I'm Pierre!/);
    assert.match(comment, /promotion|outreach/);
    assert.match(comment, /I'm closing (it|this) as invalid|still invalid\. I'm closing it/);
    assert.match(comment, /tourist|café terrace|postcard|beret|avant-garde/);
    assert.doesNotMatch(comment, /\bMerci\b/);
    assert.doesNotMatch(comment, /\bPas\b/);
    assert.doesNotMatch(comment, /maintainer can decide whether to .*close/i);
  }

  for (const comment of PIERRE_INVALID_CLOSE_COMMENTS) {
    assert.match(comment, /^Hi, I'm Pierre!/);
    assert.match(
      comment,
      /concrete repository problem|repository change|actionable problem|concrete repository action|concrete problem/,
    );
    assert.match(comment, /I'm closing (it|this) as invalid/);
    assert.match(
      comment,
      /mood board|experimental|beautifully abstract|improv theatre|entire plot/,
    );
    assert.doesNotMatch(comment, /\bMerci\b/);
    assert.doesNotMatch(comment, /\bPas\b/);
    assert.doesNotMatch(comment, /maintainer can decide whether to .*close/i);
  }
});

test("defines a cheeky but reporter-safe Pierre personality", () => {
  assert.match(PIERRE_PERSONALITY, /useful first/);
  assert.match(PIERRE_PERSONALITY, /terse, confident, mildly playful/);
  assert.match(PIERRE_PERSONALITY, /one flourish is enough/);
  assert.match(PIERRE_PERSONALITY, /never at the reporter or any group of people/);
  assert.match(PIERRE_PERSONALITY, /drop the bit and be plain/);
  assert.match(PIERRE_PERSONALITY, /stereotypes, nationality insults/);
  assert.match(PIERRE_PERSONALITY, /not from sprinkling `Merci`/);
});

test("introduces Pierre only to first-time contributors", async () => {
  const postedComments: string[] = [];
  const session = {
    shell: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    fs: {
      mkdir: async () => {},
      writeFile: async (_path: string, body: string) => {
        postedComments.push(body);
      },
    },
  } as any;
  const commandEnv = {
    GH_TOKEN: "installation-token",
    GITHUB_TOKEN: "installation-token",
  } as any;
  const context: IssueContext = {
    issueNumber: 1,
    reporter: { association: "MEMBER", trusted: true },
    issue: {},
    labels: [],
    fetchedAt: "2026-07-10T00:00:00Z",
  };

  await postComment(
    session,
    commandEnv,
    context,
    "Hi, I'm Pierre!\n\nI found one useful detail.",
  );
  context.reporter = {
    association: "FIRST_TIME_CONTRIBUTOR",
    trusted: false,
  };
  await postComment(
    session,
    commandEnv,
    context,
    "Pierre here.\n\nI need one concrete reproduction.",
  );
  context.reporter = { association: "FIRST_TIMER", trusted: false };
  await postComment(
    session,
    commandEnv,
    context,
    "I confirmed the affected path.",
  );
  context.reporter = undefined;
  await postComment(
    session,
    commandEnv,
    context,
    "Pierre here.\n\nI found one useful detail.",
  );

  assert.deepEqual(postedComments, [
    "I found one useful detail.",
    "Hi, I'm Pierre!\n\nI need one concrete reproduction.",
    "Hi, I'm Pierre!\n\nI confirmed the affected path.",
    "I found one useful detail.",
  ]);
});

test("closes external registry spam using the deterministic GitHub update path", async () => {
  const fixture = await readSpamFixture();
  const shellCalls: ShellCall[] = [];
  const fsOps: string[] = [];
  const files = new Map<string, string>();
  const session = {
    shell: async (command: string, options?: { env?: Record<string, string> }) => {
      shellCalls.push({ command, env: options?.env });
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    fs: {
      mkdir: async (path: string) => {
        fsOps.push(`mkdir ${path}`);
      },
      writeFile: async (path: string, body: string) => {
        fsOps.push(`write ${path}`);
        files.set(path, body);
      },
      rm: async (path: string) => {
        fsOps.push(`rm ${path}`);
      },
    },
  } as any;
  const commandEnv = {
    GH_TOKEN: "installation-token",
    GITHUB_TOKEN: "installation-token",
  };
  const context: IssueContext = {
    issueNumber: fixture.source.issueNumber,
    repository: fixture.source.repository,
    issue: {
      title: fixture.issue.title,
      body: fixture.issue.body,
      state: "open",
    },
    labels: fixture.repositoryLabels.map((name: string) => ({ name })),
    fetchedAt: fixture.source.capturedAt,
  };

  const labelsApplied = await applyLabels(
    session,
    commandEnv,
    context,
    fixture.expectedTriage.labels_include,
  );
  const commentPosted = await closeSpamIssue(
    session,
    commandEnv,
    context,
    {},
  );

  assert.deepEqual(commandEnv, {
    GH_TOKEN: "installation-token",
    GITHUB_TOKEN: "installation-token",
  });
  assert.deepEqual(labelsApplied, ["invalid"]);
  assert.equal(commentPosted, true);
  assert.ok(
    shellCalls.some(
      ({ command }) =>
        command ===
        "gh issue edit 1059 --repo 'getsentry/sentry-mcp' --add-label 'invalid'",
    ),
  );
  assert.ok(
    shellCalls.some(
      ({ command }) =>
        command ===
        "gh issue close 1059 --repo 'getsentry/sentry-mcp' --reason 'not planned'",
    ),
  );
  assert.ok(
    shellCalls.every(
      ({ env }) =>
        env === undefined ||
        (env.GH_TOKEN === "installation-token" &&
          env.GITHUB_TOKEN === "installation-token"),
    ),
  );

  const [commentPath, commentBody] = Array.from(files.entries())[0];
  assert.match(commentPath, /issue-1059-comment\.md$/);
  assert.ok(
    shellCalls.some(
      ({ command }) =>
        command ===
        `gh issue comment 1059 --repo 'getsentry/sentry-mcp' --body-file '${commentPath}'`,
    ),
  );
  assert.match(commentBody, /promotion|outreach/);
  assert.match(
    commentBody,
    /I'm closing (it|this) as invalid|still invalid\. I'm closing it/,
  );
  assert.doesNotMatch(commentBody, /^Hi, I'm Pierre!/);
  assert.ok(
    Array.from(PIERRE_SPAM_CLOSE_COMMENTS).some((variant) =>
      variant.endsWith(commentBody),
    ),
  );
  assert.doesNotMatch(commentBody, /maintainer can decide whether to .*close/i);
  assert.equal(fsOps[0]?.startsWith("mkdir /workspace/.tmp/issue-triage-"), true);
  assert.equal(fsOps[1], `write ${commentPath}`);
  assert.ok(
    shellCalls.some(
      ({ command }) =>
        command.startsWith("rm -rf '/workspace/.tmp/issue-triage-"),
    ),
  );
});

test("ignores issues authored by github-actions before agent work", async (t) => {
  mockModuleOnce("@flue/runtime/cloudflare", {
    namedExports: {
      extend: (descriptor: unknown) => descriptor,
    },
  });
  mockModuleOnce("@sentry/cloudflare", {
    namedExports: {
      instrumentDurableObjectWithSentry: (_options: unknown, Final: unknown) =>
        Final,
    },
  });
  mockModuleOnce(
    new URL("../src/agents/issue-triage.ts", import.meta.url).href,
    {
      defaultExport: {},
    },
  );

  const { run: runIssueTriageWorkflow } = await import(
    "../src/workflows/issue-triage.ts"
  );
  const shellCalls: ShellCall[] = [];
  let skillCallCount = 0;
  const session = {
    shell: async (command: string, options?: { env?: Record<string, string> }) => {
      shellCalls.push({ command, env: options?.env });

      if (command.startsWith("gh issue view 42")) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            title: "Track pull request without a linked issue",
            body: "Automatically generated tracking issue.",
            author: { login: "github-actions[bot]" },
            labels: [],
            comments: [],
            state: "open",
          }),
          stderr: "",
        };
      }

      if (command.startsWith("gh api ")) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ author_association: "CONTRIBUTOR" }),
          stderr: "",
        };
      }

      if (command.startsWith("gh label list")) {
        return { exitCode: 0, stdout: "[]", stderr: "" };
      }

      throw new Error(`unexpected shell command: ${command}`);
    },
    skill: async () => {
      skillCallCount += 1;
      throw new Error("skill should not be called for ignored authors");
    },
  } as any;
  const privateKey = await generateTestGitHubPrivateKey();
  t.mock.method(
    globalThis,
    "fetch",
    mock.fn(async () => Response.json({ token: "workflow-installation-token" })),
  );

  const result = await runIssueTriageWorkflow({
    init: async () => ({ session: async () => session }),
    payload: {
      issueNumber: 42,
      repository: "getsentry/example",
    },
    env: {
      GITHUB_APP_CLIENT_ID: "Iv1.test",
      GITHUB_APP_INSTALLATION_ID: "12345",
      GITHUB_APP_PRIVATE_KEY: privateKey,
    },
    log: {
      info: () => {},
      warn: () => {},
    },
  } as any);

  assert.equal(result.outcome, "ignored");
  assert.equal(result.reason, "ignored_author");
  assert.equal(result.author_login, "github-actions[bot]");
  assert.equal(result.comment_posted, false);
  assert.equal(result.title_updated, false);
  assert.equal(result.body_updated, false);
  assert.equal(result.issue_closed, false);
  assert.equal(skillCallCount, 0);
  assert.equal(
    shellCalls.some(({ command }) => command.startsWith("gh search issues")),
    false,
  );
  assert.equal(
    shellCalls.some(({ command }) => /gh issue (edit|comment|close)/.test(command)),
    false,
  );
});

test("closes invalid low-signal rewrite requests as not planned", async (t) => {
  const fixture = await readInvalidLowSignalFixture();
  mockModuleOnce("@flue/runtime/cloudflare", {
    namedExports: {
      extend: (descriptor: unknown) => descriptor,
    },
  });
  mockModuleOnce("@sentry/cloudflare", {
    namedExports: {
      instrumentDurableObjectWithSentry: (_options: unknown, Final: unknown) =>
        Final,
    },
  });
  mockModuleOnce(
    new URL("../src/agents/issue-triage.ts", import.meta.url).href,
    {
      defaultExport: {},
    },
  );

  const { run: runIssueTriageWorkflow } = await import(
    "../src/workflows/issue-triage.ts"
  );
  const shellCalls: ShellCall[] = [];
  const files = new Map<string, string>();
  const labels = fixture.repositoryLabels.map((name: string) => ({
    name,
    description: "This doesn't seem right",
  }));
  const issue = {
    title: fixture.issue.title,
    body: fixture.issue.body,
    author: { login: fixture.issue.author },
    labels: [],
    comments: [],
    url: `https://github.com/${fixture.source.repository}/issues/${fixture.source.issueNumber}`,
    state: "open",
    createdAt: "2026-06-16T20:52:38Z",
    updatedAt: fixture.source.capturedAt,
  };
  let skillCallCount = 0;
  const session = {
    shell: async (command: string, options?: { env?: Record<string, string> }) => {
      shellCalls.push({ command, env: options?.env });

      if (command.startsWith("gh issue view 1")) {
        return { exitCode: 0, stdout: JSON.stringify(issue), stderr: "" };
      }

      if (command.startsWith("gh label list")) {
        return { exitCode: 0, stdout: JSON.stringify(labels), stderr: "" };
      }

      if (command.startsWith("gh search issues")) {
        return { exitCode: 0, stdout: JSON.stringify([]), stderr: "" };
      }

      if (command === "git rev-parse --show-toplevel") {
        return { exitCode: 1, stdout: "", stderr: "not a git repository" };
      }

      if (command.startsWith("gh repo clone ")) {
        return { exitCode: 1, stdout: "", stderr: "clone unavailable" };
      }

      return { exitCode: 0, stdout: "", stderr: "" };
    },
    fs: {
      mkdir: async () => {},
      writeFile: async (path: string, body: string) => {
        files.set(path, body);
      },
      rm: async () => {},
    },
    skill: async (_name: string, options: { args?: { stage?: string } }) => {
      skillCallCount += 1;
      if (options.args?.stage === "search-duplicates") {
        return {
          data: {
            status: "unique",
            candidates: [],
            rationale: "No duplicate candidates matched the exact low-signal ask.",
          },
        };
      }

      return {
        data: {
          severity: "low",
          category: "maintenance",
          disposition: "impractical_scope",
          validity: "unclear",
          summary:
            "The request is a content-free language rewrite preference with no actionable maintenance proposal.",
          evidence: [
            "Title asks to rewrite in Python.",
            "Body only says Python is better than JavaScript.",
            "No concrete problem, user impact, migration plan, or owner is provided.",
          ],
          labels_to_apply: fixture.expectedTriage.labels_include,
          followup_kind: "missing_info_request",
          followup_rationale: "Explains why the issue cannot proceed.",
          followup_comment:
            "Pierre here.\n\nMerci for the report. I do not see a concrete repo problem or change to work on here, so I'm closing this as invalid.",
          should_close: fixture.expectedTriage.should_close,
          close_reason: fixture.expectedTriage.close_reason,
          close_comment:
            "Pierre here.\n\nMerci for the report. I do not see a concrete repo problem or change to work on here, so I'm closing this as invalid.",
          needs_human_review: fixture.expectedTriage.needs_human_review,
        },
      };
    },
  } as any;
  const privateKey = await generateTestGitHubPrivateKey();
  t.mock.method(
    globalThis,
    "fetch",
    mock.fn(async () => Response.json({ token: "workflow-installation-token" })),
  );

  const result = await runIssueTriageWorkflow({
    init: async () => ({
      session: async () => session,
    }),
    payload: {
      issueNumber: fixture.source.issueNumber,
      repository: fixture.source.repository,
    },
    env: {
      GITHUB_APP_CLIENT_ID: "Iv1.test",
      GITHUB_APP_INSTALLATION_ID: "12345",
      GITHUB_APP_PRIVATE_KEY: privateKey,
    },
    log: {
      warn: () => {},
    },
  } as any);

  assert.equal(result.outcome, "closed_invalid");
  assert.equal(result.issue_closed, true);
  assert.equal(result.close_reason, "not planned");
  assert.equal(result.closure_kind, "invalid");
  assert.equal(result.needs_human_review, false);
  assert.equal(skillCallCount, 2);
  assert.ok(
    shellCalls.some(
      ({ command }) =>
        command ===
        "gh issue edit 1 --repo 'getsentry/flue-agents' --add-label 'invalid'",
    ),
  );
  assert.ok(
    shellCalls.some(
      ({ command }) =>
        command ===
        "gh issue close 1 --repo 'getsentry/flue-agents' --reason 'not planned'",
    ),
  );
  assert.ok(
    shellCalls.some(
      ({ command }) =>
        command.startsWith("gh search issues ") &&
        command.includes(" --state open "),
    ),
  );
  assert.ok(
    shellCalls.some(
      ({ command }) =>
        command.startsWith("gh search issues ") &&
        command.includes(" --state closed "),
    ),
  );
  assert.ok(
    shellCalls.every(
      ({ command }) =>
        !command.startsWith("gh search issues ") ||
        !command.includes(" --state all "),
    ),
  );
  assert.ok(
    shellCalls.every(
      ({ command, env }) =>
        !command.startsWith("gh ") ||
        (env?.GH_TOKEN === "workflow-installation-token" &&
          env?.GITHUB_TOKEN === "workflow-installation-token"),
    ),
  );

  const commentBody = Array.from(files.values()).find((body) =>
    Array.from(PIERRE_INVALID_CLOSE_COMMENTS).some((variant) =>
      variant.endsWith(body),
    ),
  );
  assert.ok(commentBody);
  assert.doesNotMatch(commentBody, /^Hi, I'm Pierre!/);
  assert.doesNotMatch(commentBody, /^Pierre here\./);
});

async function runMemberCommentSuppressionFixture(
  t: TestContext,
  fixture: any,
) {
  mockModuleOnce("@flue/runtime/cloudflare", {
    namedExports: {
      extend: (descriptor: unknown) => descriptor,
    },
  });
  mockModuleOnce("@sentry/cloudflare", {
    namedExports: {
      instrumentDurableObjectWithSentry: (_options: unknown, Final: unknown) =>
        Final,
    },
  });
  mockModuleOnce(
    new URL("../src/agents/issue-triage.ts", import.meta.url).href,
    {
      defaultExport: {},
    },
  );

  const { run: runIssueTriageWorkflow } = await import(
    "../src/workflows/issue-triage.ts"
  );
  const shellCalls: ShellCall[] = [];
  const files = new Map<string, string>();
  const labels = fixture.issue.labels.map((name: string) => ({
    name,
    description: "Existing label",
  }));
  let issueViewCount = 0;
  const issue = {
    title: fixture.issue.title,
    body: fixture.issue.body,
    author: { login: fixture.issue.author },
    labels,
    comments: [],
    url: `https://github.com/${fixture.source.repository}/issues/${fixture.source.issueNumber}`,
    state: "open",
    createdAt: "2026-06-19T00:00:00Z",
    updatedAt: fixture.source.capturedAt,
  };
  const session = {
    shell: async (command: string, options?: { env?: Record<string, string> }) => {
      shellCalls.push({ command, env: options?.env });

      if (command.startsWith(`gh issue view ${fixture.source.issueNumber}`)) {
        issueViewCount += 1;
        return {
          exitCode: 0,
          stdout: JSON.stringify(
            fixture.changeIssueDuringAnalysis && issueViewCount >= 3
              ? { ...issue, updatedAt: "2026-07-15T22:30:00Z" }
              : issue,
          ),
          stderr: "",
        };
      }

      if (command.startsWith("gh api ")) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            author_association: fixture.issue.authorAssociation,
          }),
          stderr: "",
        };
      }

      if (command.startsWith("gh label list")) {
        return { exitCode: 0, stdout: JSON.stringify(labels), stderr: "" };
      }

      if (command.startsWith("gh search issues")) {
        return { exitCode: 0, stdout: JSON.stringify([]), stderr: "" };
      }

      if (command === "git rev-parse --show-toplevel") {
        return { exitCode: 1, stdout: "", stderr: "not a git repository" };
      }

      if (command.startsWith("gh repo clone ")) {
        return { exitCode: 1, stdout: "", stderr: "clone unavailable" };
      }

      return { exitCode: 0, stdout: "", stderr: "" };
    },
    fs: {
      mkdir: async () => {},
      writeFile: async (path: string, body: string) => {
        files.set(path, body);
      },
      rm: async () => {},
    },
    skill: async (
      _name: string,
      options: { args?: { stage?: string }; result: v.GenericSchema },
    ) => {
      if (options.args?.stage === "search-duplicates") {
        return {
          data: fixture.duplicateSearch ?? {
            status: "unique",
            candidates: [],
            rationale: "No duplicate candidates matched.",
          },
        };
      }

      const modelDiagnosis = fixture.modelDiagnosis ?? {};
      const responseData = {
        severity: "low",
        category: "feature_request",
        disposition: "actionable",
        validity: "likely",
        summary: "The issue is already clear and actionable.",
        evidence: ["The reporter supplied the relevant context."],
        gap_analysis: {
          current_capability: "The requested behavior is not exposed today.",
          desired_outcome: "Agents can use the requested behavior.",
          gap: "The repository lacks the requested integration surface.",
          affected_users: "MCP users",
          workaround: null,
          acceptance_criteria: ["Expose the requested behavior."],
          constraints: [],
          smallest_viable_slice: "Add the missing API wrapper.",
          decision_type: "implementation",
          evidence: [
            {
              source: "reporter",
              claim: "The issue describes the missing integration surface.",
            },
          ],
        },
        labels_to_apply: [],
        followup_kind: "scope_clarification",
        followup_rationale:
          "The model attempted to add a public note, but it adds no new action.",
        followup_comment: fixture.modelComment,
        should_close: false,
        needs_human_review: false,
        ...modelDiagnosis,
      };
      return {
        data: v.parse(options.result, responseData),
      };
    },
  } as any;
  const privateKey = await generateTestGitHubPrivateKey();
  t.mock.method(
    globalThis,
    "fetch",
    mock.fn(async () => Response.json({ token: "workflow-installation-token" })),
  );

  const result = await runIssueTriageWorkflow({
    init: async () => ({
      session: async () => session,
    }),
    payload: {
      issueNumber: fixture.source.issueNumber,
      repository: fixture.source.repository,
      dryRun: fixture.dryRun,
    },
    env: {
      GITHUB_APP_CLIENT_ID: "Iv1.test",
      GITHUB_APP_INSTALLATION_ID: "12345",
      GITHUB_APP_PRIVATE_KEY: privateKey,
    },
    log: {
      info: () => {},
      warn: () => {},
    },
  } as any);

  const expectedNeedsHumanReview = fixture.expectedNeedsHumanReview ?? false;
  assert.equal(
    result.outcome,
    expectedNeedsHumanReview ? "needs_human_review" : "triaged",
  );
  assert.equal(result.comment_posted, fixture.expectedCommentPosted);
  if (fixture.expectedValidationError) {
    assert.match(result.validation_error, fixture.expectedValidationError);
  }
  if (fixture.expectedTriage.duplicate) {
    assert.deepEqual(result.duplicate, fixture.expectedTriage.duplicate);
    assert.ok(result.gap_analysis);
  }
  if (fixture.expectedTriage.issue_changed !== undefined) {
    assert.equal(result.issue_changed, fixture.expectedTriage.issue_changed);
    assert.equal(result.needs_human_review, true);
    assert.deepEqual(result.labels_proposed, []);
  }
  if (fixture.expectedTriage.outcome === "needs_human_review") {
    assert.deepEqual(result.labels_applied, []);
  }
  assert.equal(result.issue_closed, false);
  assert.equal(result.title_updated, false);
  assert.equal(result.body_updated, false);
  assert.equal(result.needs_human_review, expectedNeedsHumanReview);
  assert.ok(
    shellCalls.every(
      ({ command }) =>
        !command.startsWith("gh issue edit") ||
        (!command.includes(" --title ") && !command.includes(" --body-file ")),
    ),
    "append-only triage must never edit reporter-authored title or body",
  );
  assert.ok(
    fixture.expectedCommentPosted
      ? shellCalls.some(({ command }) => command.startsWith("gh issue comment"))
      : shellCalls.every(
          ({ command }) => !command.startsWith("gh issue comment"),
        ),
  );
  assert.equal(files.size > 0, fixture.expectedCommentPosted);
  if (fixture.expectedCommentPosted) {
    const [commentPath, commentBody] = Array.from(files.entries())[0];
    assert.equal(commentBody, fixture.modelComment);
    assert.ok(
      shellCalls.some(
        ({ command }) =>
          command ===
          `gh issue comment ${fixture.source.issueNumber} --repo '${fixture.source.repository}' --body-file '${commentPath}'`,
      ),
    );
  }
}

test("returns complete dry-run output when the issue changes during analysis", async (t) => {
  const fixture = await readMemberActionableFixture();
  fixture.dryRun = true;
  fixture.changeIssueDuringAnalysis = true;
  fixture.expectedTriage.outcome = "dry_run";
  fixture.expectedTriage.comment_posted = false;
  fixture.expectedTriage.issue_changed = true;

  await runMemberCommentSuppressionFixture(t, fixture);
});

test("preserves semantic validation errors when the issue changes during analysis", async (t) => {
  const fixture = await readMemberActionableFixture();
  fixture.changeIssueDuringAnalysis = true;
  fixture.modelDiagnosis = {
    should_update_issue: true,
    proposed_body: undefined,
  };
  fixture.expectedTriage.outcome = "needs_human_review";
  fixture.expectedTriage.comment_posted = false;
  fixture.expectedTriage.issue_changed = true;
  fixture.expectedTriage.validation_error = /proposed_body/;

  await runMemberCommentSuppressionFixture(t, fixture);
});

test("runs full diagnosis for duplicate dry runs without mutating issues", async (t) => {
  const fixture = await readMemberActionableFixture();
  const duplicate = {
    number: 456,
    title: "Existing matching issue",
    url: "https://github.com/getsentry/sentry-mcp/issues/456",
    state: "open",
    confidence: "high",
    reason: "Same underlying report.",
  };
  fixture.dryRun = true;
  fixture.duplicateSearch = {
    status: "duplicate",
    duplicate,
    candidates: [duplicate],
    rationale: "The reports describe the same request.",
  };
  fixture.expectedTriage.outcome = "dry_run";
  fixture.expectedTriage.comment_posted = false;
  fixture.expectedTriage.duplicate = duplicate;

  await runMemberCommentSuppressionFixture(t, fixture);
});

test("preserves diagnoses that fail semantic validation without mutating issues", async (t) => {
  const fixture = await readMemberActionableFixture();
  fixture.modelDiagnosis = {
    gap_analysis: undefined,
  };
  fixture.expectedNeedsHumanReview = true;
  fixture.expectedCommentPosted = false;
  fixture.expectedValidationError = /gap_analysis/;

  await runMemberCommentSuppressionFixture(t, fixture);
});

test("skips public mutations whenever diagnosis requires human review", async (t) => {
  const fixture = await readMemberActionableFixture();
  fixture.modelDiagnosis = {
    severity: "high",
    labels_to_apply: ["enhancement"],
    should_comment: true,
    should_update_issue: true,
    proposed_title: "Potentially sensitive report",
    proposed_body: "Details that should not be published automatically.",
    needs_human_review: true,
  };
  fixture.expectedTriage.outcome = "needs_human_review";
  fixture.expectedTriage.comment_posted = false;

  await runMemberCommentSuppressionFixture(t, fixture);
});

test("suppresses low-value actionable comments on member feature requests", async (t) => {
  await runMemberCommentSuppressionFixture(t, await readMemberActionableFixture());
});

test("suppresses praise and restatement comments on member tracking issues", async (t) => {
  await runMemberCommentSuppressionFixture(t, await readMemberTrackingFixture());
});

test("ignores incomplete production follow-up metadata", async (t) => {
  const fixture = await readMemberActionableFixture();
  fixture.issue.author = "external-reporter";
  fixture.issue.authorAssociation = "NONE";
  fixture.modelDiagnosis = { followup_kind: undefined };
  fixture.expectedCommentPosted = false;

  await runMemberCommentSuppressionFixture(t, fixture);
});

test("keeps specific missing-info comments for outside contributors", async (t) => {
  const fixture = await readMemberActionableFixture();
  fixture.issue.author = "external-reporter";
  fixture.issue.authorAssociation = "NONE";
  fixture.modelComment = [
    "Merci for the report. I need one concrete reproduction before maintainers can act here: which command failed, and what output did you expect?",
  ].join("\n");
  fixture.expectedCommentPosted = true;

  await runMemberCommentSuppressionFixture(t, fixture);
});

test("introduces Pierre in comments for first-time contributors", async (t) => {
  const fixture = await readMemberActionableFixture();
  fixture.issue.author = "new-reporter";
  fixture.issue.authorAssociation = "FIRST_TIME_CONTRIBUTOR";
  fixture.modelComment = [
    "Hi, I'm Pierre!",
    "",
    "Merci for the report. I need one concrete reproduction before maintainers can act here: which command failed, and what output did you expect?",
  ].join("\n");
  fixture.expectedCommentPosted = true;

  await runMemberCommentSuppressionFixture(t, fixture);
});

test("keeps concrete validation comments for member issues", async (t) => {
  const fixture = await readMemberActionableFixture();
  fixture.modelComment = [
    "Merci for the report. I found one extra repo detail that seems useful here.",
    "",
    "What I checked:",
    "- `packages/mcp-core/src/api-client/client.ts` has no issue user reports wrapper today.",
  ].join("\n");
  fixture.expectedCommentPosted = true;
  fixture.modelDiagnosis = {
    followup_kind: "technical_diagnosis",
    followup_rationale: "Adds a concrete repository finding not already captured.",
    evidence: [
      "`packages/mcp-core/src/api-client/client.ts` has no issue user reports wrapper today.",
    ],
  };

  await runMemberCommentSuppressionFixture(t, fixture);
});

test("suppresses rhetorical questions on member actionable issues", async (t) => {
  const fixture = await readMemberActionableFixture();
  fixture.modelComment = [
    "Hi, I'm Pierre!",
    "",
    "What happens next? The issue already covers the sensible paths, so a maintainer can take it from here.",
  ].join("\n");
  fixture.expectedCommentPosted = false;
  fixture.modelDiagnosis = {
    followup_kind: "scope_clarification",
  };

  await runMemberCommentSuppressionFixture(t, fixture);
});

test("mints a GitHub App installation token for gh commands", async (t) => {
  const privateKey = await generateTestGitHubPrivateKey();
  const fetchMock = mock.fn(
    async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      assert.equal(init?.method, "POST");
      assert.equal(headers["User-Agent"], "sentry-flue-agents");
      assert.match(headers.Authorization, /^Bearer /);
      return Response.json({ token: "installation-token" });
    },
  );
  t.mock.method(globalThis, "fetch", fetchMock as typeof fetch);

  const commandEnv = await resolveGithubCommandEnv(
    {
      GITHUB_APP_CLIENT_ID: "Iv1.test",
      GITHUB_APP_INSTALLATION_ID: "12345",
      GITHUB_APP_PRIVATE_KEY: privateKey,
    },
    "getsentry/example",
  );

  assert.deepEqual(commandEnv, {
    GH_TOKEN: "installation-token",
    GITHUB_TOKEN: "installation-token",
  });
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(
    fetchMock.mock.calls[0]?.arguments[0],
    "https://api.github.com/app/installations/12345/access_tokens",
  );
  assert.equal(
    fetchMock.mock.calls[0]?.arguments[1]?.body,
    JSON.stringify({
      permissions: {
        contents: "read",
        issues: "write",
      },
      repositories: ["example"],
    }),
  );
});

test("rejects personal GitHub tokens as workflow credentials", async () => {
  mockModuleOnce("@flue/runtime/cloudflare", {
    namedExports: {
      extend: (descriptor: unknown) => descriptor,
    },
  });
  mockModuleOnce("@sentry/cloudflare", {
    namedExports: {
      instrumentDurableObjectWithSentry: (_options: unknown, Final: unknown) =>
        Final,
    },
  });
  mockModuleOnce(
    new URL("../src/agents/issue-triage.ts", import.meta.url).href,
    {
      defaultExport: {},
    },
  );

  const { run: runIssueTriageWorkflow } = await import(
    "../src/workflows/issue-triage.ts"
  );
  let initCalled = false;

  await assert.rejects(
    () =>
      runIssueTriageWorkflow({
        init: async () => {
          initCalled = true;
          return {
            session: async () => ({
              shell: async () => {
                throw new Error("shell should not be called");
              },
            }),
          };
        },
        payload: {
          issueNumber: 123,
          repository: "getsentry/example",
        },
        env: {
          GH_TOKEN: "personal-token",
          GITHUB_TOKEN: "personal-token",
        },
        log: {
          warn: () => {},
        },
      } as any),
    /GITHUB_APP_INSTALLATION_ID is required for GitHub App authentication/,
  );
  assert.equal(initCalled, false);
});

test("rejects GitHub App ID as an issuer fallback", async () => {
  mockModuleOnce("@flue/runtime/cloudflare", {
    namedExports: {
      extend: (descriptor: unknown) => descriptor,
    },
  });
  mockModuleOnce("@sentry/cloudflare", {
    namedExports: {
      instrumentDurableObjectWithSentry: (_options: unknown, Final: unknown) =>
        Final,
    },
  });
  mockModuleOnce(
    new URL("../src/agents/issue-triage.ts", import.meta.url).href,
    {
      defaultExport: {},
    },
  );

  const { run: runIssueTriageWorkflow } = await import(
    "../src/workflows/issue-triage.ts"
  );
  const privateKey = await generateTestGitHubPrivateKey();
  let initCalled = false;

  await assert.rejects(
    () =>
      runIssueTriageWorkflow({
        init: async () => {
          initCalled = true;
          return {
            session: async () => ({
              shell: async () => {
                throw new Error("shell should not be called");
              },
            }),
          };
        },
        payload: {
          issueNumber: 123,
          repository: "getsentry/example",
        },
        env: {
          GITHUB_APP_ID: "12345",
          GITHUB_APP_INSTALLATION_ID: "12345",
          GITHUB_APP_PRIVATE_KEY: privateKey,
        },
        log: {
          warn: () => {},
        },
      } as any),
    /GITHUB_APP_CLIENT_ID and GITHUB_APP_PRIVATE_KEY are required for GitHub App authentication/,
  );
  assert.equal(initCalled, false);
});

test("skips duplicate closure when the issue is already closed at mutation time", async (t) => {
  mockModuleOnce("@flue/runtime/cloudflare", {
    namedExports: {
      extend: (descriptor: unknown) => descriptor,
    },
  });
  mockModuleOnce("@sentry/cloudflare", {
    namedExports: {
      instrumentDurableObjectWithSentry: (_options: unknown, Final: unknown) =>
        Final,
    },
  });
  mockModuleOnce(
    new URL("../src/agents/issue-triage.ts", import.meta.url).href,
    {
      defaultExport: {},
    },
  );

  const { run: runIssueTriageWorkflow } = await import(
    "../src/workflows/issue-triage.ts"
  );
  const shellCalls: ShellCall[] = [];
  let issueViewCount = 0;
  const duplicate = {
    number: 456,
    title: "Existing matching issue",
    url: "https://github.com/getsentry/example/issues/456",
    state: "open",
    confidence: "high",
    reason: "Same underlying report.",
  };
  const labels = [{ name: "duplicate", description: "Duplicate issue" }];
  const session = {
    shell: async (command: string, options?: { env?: Record<string, string> }) => {
      shellCalls.push({ command, env: options?.env });

      if (command.startsWith("gh issue view 123")) {
        issueViewCount += 1;
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            title: "Current issue",
            body: "Same failure",
            author: { login: "reporter" },
            labels: [],
            comments: [],
            url: "https://github.com/getsentry/example/issues/123",
            state: issueViewCount === 1 ? "open" : "closed",
            createdAt: "2026-06-15T00:00:00Z",
            updatedAt: "2026-06-15T00:01:00Z",
          }),
          stderr: "",
        };
      }

      if (command.startsWith("gh label list")) {
        return { exitCode: 0, stdout: JSON.stringify(labels), stderr: "" };
      }

      if (command.startsWith("gh search issues")) {
        return { exitCode: 0, stdout: JSON.stringify([]), stderr: "" };
      }

      return { exitCode: 0, stdout: "", stderr: "" };
    },
    skill: async () => ({
      data: {
        status: "duplicate",
        duplicate,
        candidates: [duplicate],
        rationale: "The reports describe the same failure.",
      },
    }),
  } as any;
  const privateKey = await generateTestGitHubPrivateKey();
  t.mock.method(
    globalThis,
    "fetch",
    mock.fn(async () => Response.json({ token: "workflow-installation-token" })),
  );

  const result = await runIssueTriageWorkflow({
    init: async () => ({
      session: async () => session,
    }),
    payload: {
      issueNumber: 123,
      repository: "getsentry/example",
    },
    env: {
      GITHUB_APP_CLIENT_ID: "Iv1.test",
      GITHUB_APP_INSTALLATION_ID: "12345",
      GITHUB_APP_PRIVATE_KEY: privateKey,
    },
    log: {
      warn: () => {},
    },
  } as any);

  assert.equal(result.outcome, "needs_human_review");
  assert.equal(result.issue_closed, false);
  assert.equal(result.comment_posted, false);
  assert.equal(result.needs_human_review, true);
  assert.equal(issueViewCount, 2);
  assert.ok(
    shellCalls.every(
      ({ command, env }) =>
        !command.startsWith("gh ") ||
        (env?.GH_TOKEN === "workflow-installation-token" &&
          env?.GITHUB_TOKEN === "workflow-installation-token"),
    ),
  );
  assert.ok(
    shellCalls.every(
      ({ command }) =>
        !command.startsWith("gh issue comment") &&
        !command.startsWith("gh issue close") &&
        !command.includes("--add-label"),
    ),
  );
});
