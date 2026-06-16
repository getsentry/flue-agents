import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { mock } from "node:test";

import {
  applyLabels,
  closeSpamIssue,
  resolveGithubCommandEnv,
  type IssueContext,
} from "../src/lib/issue-triage-github.ts";

type ShellCall = {
  command: string;
  env?: Record<string, string>;
};

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
    labels: fixture.issue.labelsAtCapture.map((name: string) => ({ name })),
    fetchedAt: fixture.source.capturedAt,
  };

  const labelsApplied = await applyLabels(
    session,
    commandEnv,
    context,
    fixture.expectedTriage.labels_to_apply,
  );
  const commentPosted = await closeSpamIssue(
    session,
    commandEnv,
    context,
    fixture.observedTriage.diagnosis,
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
  assert.match(commentBody, /automated external promotion/);
  assert.match(commentBody, /I'm closing it as invalid/);
  assert.doesNotMatch(commentBody, /maintainer can decide whether to .*close/i);
  assert.equal(fsOps[0]?.startsWith("mkdir /workspace/.tmp/issue-triage-"), true);
  assert.equal(fsOps[1], `write ${commentPath}`);
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
