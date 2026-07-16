import { spawnSync } from "node:child_process";
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
import { expect } from "vitest";
import { createHarness, createJudge, describeEval } from "vitest-evals";

const rootPath = fileURLToPath(new URL("..", import.meta.url));
const fixtureDir = join(rootPath, "fixtures/issue-triage");
const model =
  process.env.FLUE_TRIAGE_EVAL_MODEL ?? "openrouter/moonshotai/kimi-k2.6";

type EvalFixture = {
  name?: string;
  description: string;
  source: {
    repository: string;
    issueNumber: number;
  };
  [key: string]: unknown;
};

type EvalOutput = {
  scenario: string;
  description: string;
  passed: boolean;
  failures: string[];
  diagnosis: unknown;
};

function parseFlueRunOutput(stdout: string): EvalOutput {
  const starts: number[] = [];
  for (
    let index = stdout.indexOf("{");
    index !== -1;
    index = stdout.indexOf("{", index + 1)
  ) {
    starts.push(index);
  }

  for (const start of starts.reverse()) {
    try {
      return JSON.parse(stdout.slice(start)) as EvalOutput;
    } catch {
      // Build logs can contain earlier JSON-looking fragments.
    }
  }

  throw new Error("Could not parse flue run JSON result from stdout.");
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
      `import issueTriageAgent from "../agents/issue-triage.ts";`,
      `import { runIssueTriageEval } from ${JSON.stringify(pathToFileURL(join(rootPath, "src/lib/issue-triage-eval.ts")).href)};`,
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

if (!model.startsWith("openrouter/")) {
  throw new Error("FLUE_TRIAGE_EVAL_MODEL must use the openrouter/ provider.");
}
if (!process.env.OPENROUTER_API_KEY) {
  throw new Error("OPENROUTER_API_KEY is required to run integration evals.");
}

const fixtures = readdirSync(fixtureDir)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => {
    const fixture = JSON.parse(
      readFileSync(join(fixtureDir, file), "utf8"),
    ) as EvalFixture;
    return {
      file,
      name: fixture.name ?? file.replace(/\.json$/, ""),
      fixture,
    };
  });

if (fixtures.length === 0) {
  throw new Error("No issue-triage integration fixtures found.");
}

const { evalRoot, evalEnv } = createEvalRoot();
process.on("exit", () => rmSync(evalRoot, { recursive: true, force: true }));

const deterministicOutcomeJudge = createJudge<EvalFixture, EvalOutput>(
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

const issueTriageHarness = createHarness<EvalFixture, EvalOutput>({
  name: "flue-issue-triage",
  run: async ({ input }) => {
    const result = spawnSync(
      "pnpm",
      [
        "exec",
        "flue",
        "run",
        "issue-triage-eval",
        "--target",
        "node",
        "--root",
        evalRoot,
        "--env",
        evalEnv,
        "--payload",
        JSON.stringify(input),
      ],
      {
        cwd: rootPath,
        encoding: "utf8",
        env: {
          ...process.env,
          FLUE_TRIAGE_EVAL_MODEL: model,
          FLUE_TRIAGE_MODEL: model,
        },
        maxBuffer: 20 * 1024 * 1024,
      },
    );

    if (result.status !== 0) {
      throw new Error(
        `flue run exited ${result.status}: ${(result.stderr || result.stdout).trim()}`,
      );
    }

    const output = parseFlueRunOutput(result.stdout);
    return {
      events: [
        {
          type: "message",
          role: "user",
          content: input.description,
        },
        {
          type: "message",
          role: "assistant",
          content: JSON.stringify(output.diagnosis),
        },
      ],
      output,
      artifacts: {
        scenario: output.scenario,
        diagnosis: output.diagnosis,
      },
      usage: {},
    };
  },
});

describeEval("issue triage integration", { harness: issueTriageHarness }, (it) => {
  it.for(fixtures)("$name", async ({ fixture }, { run }) => {
    const result = await run(fixture);

    expect(result.output.failures).toEqual([]);
    expect(result.output.passed).toBe(true);
    await expect(result).toSatisfyJudge(deterministicOutcomeJudge);
  });
});
