import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { mock } from "node:test";

import {
  applyLabels,
  closeSpamIssue,
  githubCommandEnv,
  type IssueContext,
} from "../src/lib/issue-triage-github.ts";

type ShellCall = {
  command: string;
  env?: Record<string, string>;
};

async function readSpamFixture() {
  const fixtureUrl = new URL(
    "../fixtures/issue-triage/external-registry-spam-1059.json",
    import.meta.url,
  );
  return JSON.parse(await readFile(fixtureUrl, "utf8"));
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
  const commandEnv = githubCommandEnv({
    GH_TOKEN: "",
    GITHUB_TOKEN: " fallback-token ",
  });
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
    GH_TOKEN: "fallback-token",
    GITHUB_TOKEN: "fallback-token",
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
        (env.GH_TOKEN === "fallback-token" &&
          env.GITHUB_TOKEN === "fallback-token"),
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

test("skips duplicate closure when the issue is already closed at mutation time", async () => {
  mock.module("@flue/runtime/cloudflare", {
    namedExports: {
      extend: (descriptor: unknown) => descriptor,
    },
  });
  mock.module("@sentry/cloudflare", {
    namedExports: {
      instrumentDurableObjectWithSentry: (_options: unknown, Final: unknown) =>
        Final,
    },
  });
  mock.module(new URL("../src/agents/issue-triage.ts", import.meta.url).href, {
    defaultExport: {},
  });

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
  const result = await runIssueTriageWorkflow({
    init: async () => ({
      session: async () => session,
    }),
    payload: {
      issueNumber: 123,
      repository: "getsentry/example",
    },
    env: {
      GH_TOKEN: "test-token",
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
      ({ command }) =>
        !command.startsWith("gh issue comment") &&
        !command.startsWith("gh issue close") &&
        !command.includes("--add-label"),
    ),
  );
});
