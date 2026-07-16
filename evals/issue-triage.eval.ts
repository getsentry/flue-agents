import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { aroundAll, beforeEach } from "vitest";
import { createJudge, describeEval } from "vitest-evals";
import * as v from "valibot";

import {
  issueTriageEvalDiagnosisSchema,
  parseIssueTriageEvalFixture,
  type IssueTriageEvalFixture,
} from "../src/lib/issue-triage-eval.ts";
import { DEFAULT_ISSUE_TRIAGE_EVAL_MODEL } from "../src/lib/issue-triage-model.ts";
import {
  createFlueWorkflowHarness,
  startFlueEvalServer,
} from "./flue-workflow-harness.ts";

const rootPath = fileURLToPath(new URL("..", import.meta.url));
const fixtureDir = join(rootPath, "fixtures/issue-triage");
const CASE_TIMEOUT_MS = 125_000;
const SERVER_HOOK_TIMEOUT_MS = 90_000;
const CLEANUP_TIMEOUT_MS = 10_000;
const model =
  process.env.FLUE_TRIAGE_EVAL_MODEL ?? DEFAULT_ISSUE_TRIAGE_EVAL_MODEL;

const evalOutputSchema = v.strictObject({
  scenario: v.string(),
  description: v.string(),
  passed: v.boolean(),
  failures: v.array(v.string()),
  diagnosis: issueTriageEvalDiagnosisSchema,
});
type EvalOutput = v.InferOutput<typeof evalOutputSchema>;

function parseEvalOutput(value: unknown): EvalOutput {
  return v.parse(evalOutputSchema, value);
}

function createEvalRoot() {
  const evalRoot = mkdtempSync(join(tmpdir(), "flue-agents-evals-"));
  const evalAgent = join(evalRoot, "src/agents/issue-triage.ts");
  const evalEnv = join(evalRoot, ".env.evals");
  const evalSkill = join(evalRoot, "src/skills/issue-triage/SKILL.md");
  const evalWorkflow = join(evalRoot, "src/workflows/issue-triage-eval.ts");

  symlinkSync(join(rootPath, "node_modules"), join(evalRoot, "node_modules"), "dir");
  mkdirSync(dirname(evalAgent), { recursive: true });
  mkdirSync(dirname(evalSkill), { recursive: true });
  mkdirSync(dirname(evalWorkflow), { recursive: true });
  writeFileSync(
    evalSkill,
    readFileSync(join(rootPath, "src/skills/issue-triage/SKILL.md"), "utf8"),
  );
  writeFileSync(
    evalAgent,
    [
      `import { createAgent } from "@flue/runtime";`,
      `import { PIERRE_PERSONALITY } from ${JSON.stringify(pathToFileURL(join(rootPath, "src/lib/pierre.ts")).href)};`,
      `import issueTriage from "../skills/issue-triage/SKILL.md" with { type: "skill" };`,
      ``,
      `export default createAgent(({ env }) => ({`,
      `  model: env.FLUE_TRIAGE_EVAL_MODEL ?? env.FLUE_TRIAGE_MODEL,`,
      `  thinkingLevel: "low",`,
      `  cwd: "/workspace",`,
      `  skills: [issueTriage],`,
      `  instructions: \`Triage Sentry GitHub issues carefully. \${PIERRE_PERSONALITY} Use the issue-triage skill for duplicate search, diagnosis, validation, concise additive follow-up comments, and safe closure decisions. Never rewrite reporter-authored issue content. Your structured response is machine-validated: when should_close is true, always set close_reason to not planned; for actionable documentation, feature, support, or maintenance issues, always include gap_analysis.\`,`,
      `}));`,
      ``,
    ].join("\n"),
  );
  writeFileSync(
    evalWorkflow,
    [
      `import type { WorkflowRouteHandler } from "@flue/runtime";`,
      `import issueTriageAgent from "../agents/issue-triage.ts";`,
      `import { runIssueTriageEval } from ${JSON.stringify(pathToFileURL(join(rootPath, "src/lib/issue-triage-eval.ts")).href)};`,
      ``,
      `export const route: WorkflowRouteHandler = async (_c, next) => next();`,
      ``,
      `export async function run({ init, payload }) {`,
      `  return runIssueTriageEval(init, payload, issueTriageAgent);`,
      `}`,
      ``,
    ].join("\n"),
  );
  writeFileSync(
    evalEnv,
    [
      `FLUE_TRIAGE_EVAL_MODEL=${JSON.stringify(model)}`,
      `FLUE_TRIAGE_MODEL=${JSON.stringify(model)}`,
    ].join("\n"),
  );

  return { evalRoot, evalEnv };
}

const fixtures = readdirSync(fixtureDir)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => {
    let fixture: IssueTriageEvalFixture;
    try {
      fixture = parseIssueTriageEvalFixture(
        JSON.parse(readFileSync(join(fixtureDir, file), "utf8")),
      );
    } catch (error) {
      throw new Error(`Invalid issue-triage fixture ${file}`, { cause: error });
    }
      return {
        file,
        name: fixture.name,
        fixture,
    };
  });

if (fixtures.length === 0) {
  throw new Error("No issue-triage integration fixtures found.");
}
if (!model.startsWith("openrouter/")) {
  throw new Error("FLUE_TRIAGE_EVAL_MODEL must use the openrouter/ provider.");
}
if (!process.env.OPENROUTER_API_KEY) {
  throw new Error("OPENROUTER_API_KEY is required to run integration evals.");
}

let evalServer: Awaited<ReturnType<typeof startFlueEvalServer>> | undefined;

aroundAll(
  async (runSuite) => {
    const { evalRoot, evalEnv } = createEvalRoot();
    try {
      evalServer = await startFlueEvalServer({
        cwd: rootPath,
        root: evalRoot,
        envFile: evalEnv,
      });
      await runSuite();
    } finally {
      try {
        await evalServer?.stop();
      } finally {
        evalServer = undefined;
        rmSync(evalRoot, { recursive: true, force: true });
      }
    }
  },
  SERVER_HOOK_TIMEOUT_MS +
    fixtures.length * (SERVER_HOOK_TIMEOUT_MS + CASE_TIMEOUT_MS) +
    CLEANUP_TIMEOUT_MS,
);

beforeEach(async () => {
  if (!evalServer) {
    throw new Error("Flue eval server has not started.");
  }
  await evalServer.ensureRunning();
}, SERVER_HOOK_TIMEOUT_MS);

const deterministicOutcomeJudge = createJudge<IssueTriageEvalFixture, EvalOutput>(
  "DeterministicOutcomeJudge",
  ({ output }) => ({
    score: output.passed && output.failures.length === 0 ? 1 : 0,
    metadata: {
      rationale:
        output.failures.length === 0
          ? "All deterministic fixture assertions passed."
          : output.failures.join("; "),
    },
  }),
);

const issueTriageHarness = createFlueWorkflowHarness<
  IssueTriageEvalFixture,
  EvalOutput
>({
  name: "flue-issue-triage",
  workflowName: "issue-triage-eval",
  getBaseUrl: () => {
    if (!evalServer) {
      throw new Error("Flue eval server has not started.");
    }
    return evalServer.baseUrl();
  },
  inputMessage: (input) => input.description,
  parseOutput: parseEvalOutput,
  timeoutMs: CASE_TIMEOUT_MS,
});

describeEval(
  "issue triage integration",
  {
    harness: issueTriageHarness,
    judges: [deterministicOutcomeJudge],
    judgeThreshold: 1,
  },
  (it) => {
    it.for(fixtures)("$name", async ({ fixture }, { run }) => {
      await run(fixture);
    });
  },
);
