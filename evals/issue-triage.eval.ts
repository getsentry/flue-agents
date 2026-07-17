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

import { afterAll, beforeAll, expect } from "vitest";
import { createJudge, describeEval } from "vitest-evals";
import * as v from "valibot";

import {
  issueTriageEvalDiagnosisSchema,
  parseIssueTriageEvalFixture,
  type IssueTriageEvalFixture,
} from "../src/lib/issue-triage-eval.ts";
import {
  createFlueWorkflowHarness,
  startFlueEvalServer,
} from "./flue-workflow-harness.ts";

const rootPath = fileURLToPath(new URL("..", import.meta.url));
const fixtureDir = join(rootPath, "fixtures/issue-triage");
const model =
  process.env.FLUE_TRIAGE_EVAL_MODEL ?? "openrouter/moonshotai/kimi-k2.6";

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
      `  cwd: "/workspace",`,
      `  skills: [issueTriage],`,
      `  instructions: \`Triage Sentry GitHub issues carefully. \${PIERRE_PERSONALITY} Use the issue-triage skill for duplicate search, diagnosis, validation, concise issue updates, and safe closure decisions.\`,`,
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
      name: file.replace(/\.json$/, ""),
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

const { evalRoot, evalEnv } = createEvalRoot();
let evalServer: Awaited<ReturnType<typeof startFlueEvalServer>> | undefined;

beforeAll(async () => {
  evalServer = await startFlueEvalServer({
    cwd: rootPath,
    root: evalRoot,
    envFile: evalEnv,
  });
}, 70_000);

afterAll(async () => {
  await evalServer?.stop();
  rmSync(evalRoot, { recursive: true, force: true });
}, 10_000);

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
    return evalServer.baseUrl;
  },
  inputMessage: (input) => input.description,
  parseOutput: parseEvalOutput,
  timeoutMs: 60_000,
});

describeEval("issue triage integration", { harness: issueTriageHarness }, (it) => {
  it.for(fixtures)("$name", async ({ fixture }, { run }) => {
    const result = await run(fixture);

    expect(result.output.failures).toEqual([]);
    expect(result.output.passed).toBe(true);
    await expect(result).toSatisfyJudge(deterministicOutcomeJudge);
  });
});
