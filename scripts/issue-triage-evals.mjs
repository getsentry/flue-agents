import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url);
const fixtureDir = new URL("../fixtures/issue-triage", import.meta.url);
const rootPath = fileURLToPath(root);
const baseEnvFile = ".env";
const localEnvFile = process.env.FLUE_EVAL_ENV || ".env.local";
const defaultEvalModel = "openrouter/moonshotai/kimi-k2.6";

function envPath(file) {
  return isAbsolute(file) ? file : join(rootPath, file);
}

function parseEnvFile(path) {
  if (!existsSync(path)) {
    return {};
  }

  const values = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (!key) {
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

function stringifyEnv(values) {
  return Object.entries(values)
    .map(([key, value]) => `${key}=${JSON.stringify(value ?? "")}`)
    .join("\n");
}

const baseEnvPath = envPath(baseEnvFile);
const localEnvPath = envPath(localEnvFile);
const fileEnv = {
  ...parseEnvFile(baseEnvPath),
  ...parseEnvFile(localEnvPath),
};
const loadedEnv = {
  ...fileEnv,
  ...process.env,
};
const model = loadedEnv.FLUE_TRIAGE_EVAL_MODEL || defaultEvalModel;

if (!model) {
  console.error(
    [
      "Missing eval model.",
      "",
      "Set an OpenRouter Flue model before running evals, for example:",
      "  FLUE_TRIAGE_EVAL_MODEL=openrouter/moonshotai/kimi-k2.6 pnpm evals",
      "",
      `You can also set FLUE_TRIAGE_EVAL_MODEL in ${localEnvFile}.`,
      `Default eval model: ${defaultEvalModel}`,
      "",
      "The production cloudflare/... model only works on the Cloudflare target.",
    ].join("\n"),
  );
  process.exit(1);
}

if (!model.startsWith("openrouter/")) {
  console.error(
    [
      `FLUE_TRIAGE_EVAL_MODEL=${model} is not supported for issue-triage evals.`,
      "Use OpenRouter only, for example:",
      `  FLUE_TRIAGE_EVAL_MODEL=${defaultEvalModel}`,
    ].join("\n"),
  );
  process.exit(1);
}

if (!loadedEnv.OPENROUTER_API_KEY) {
  console.error(
    [
      `FLUE_TRIAGE_EVAL_MODEL=${model} uses the OpenRouter provider.`,
      `Set OPENROUTER_API_KEY in ${localEnvFile} or in your shell before running pnpm evals.`,
      "",
      "The default eval model is:",
      `  FLUE_TRIAGE_EVAL_MODEL=${defaultEvalModel}`,
    ].join("\n"),
  );
  process.exit(1);
}

function parseFlueRunOutput(stdout) {
  const starts = [];
  for (let index = stdout.indexOf("{"); index !== -1; index = stdout.indexOf("{", index + 1)) {
    starts.push(index);
  }

  for (const start of starts.reverse()) {
    try {
      return JSON.parse(stdout.slice(start));
    } catch {
      // Keep scanning earlier JSON-looking fragments in build logs.
    }
  }

  throw new Error("Could not parse flue run JSON result from stdout.");
}

const fixtureFiles = readdirSync(fixtureDir)
  .filter((name) => name.endsWith(".json"))
  .sort();

if (fixtureFiles.length === 0) {
  console.error("No issue-triage eval fixtures found.");
  process.exit(1);
}

const results = [];
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
  stringifyEnv({
    ...fileEnv,
    FLUE_TRIAGE_EVAL_MODEL: model,
    FLUE_TRIAGE_MODEL: model,
  }),
);

try {
  for (const file of fixtureFiles) {
    const fixturePath = join(fixtureDir.pathname, file);
    const fixture = readFileSync(fixturePath, "utf8");
    const command = [
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
      fixture,
    ];
    const started = Date.now();
    const result = spawnSync("pnpm", command, {
      cwd: rootPath,
      encoding: "utf8",
      env: {
        ...loadedEnv,
        FLUE_TRIAGE_EVAL_MODEL: model,
        FLUE_TRIAGE_MODEL: model,
      },
      maxBuffer: 20 * 1024 * 1024,
    });
    const durationMs = Date.now() - started;

    if (result.status !== 0) {
      results.push({
        file,
        passed: false,
        durationMs,
        failures: [
          `flue run exited ${result.status}: ${(result.stderr || result.stdout).trim()}`,
        ],
      });
      continue;
    }

    try {
      const output = parseFlueRunOutput(result.stdout);
      results.push({
        file,
        passed: output.passed === true,
        durationMs,
        scenario: output.scenario,
        failures: output.failures ?? [],
        diagnosis: output.diagnosis,
      });
    } catch (error) {
      results.push({
        file,
        passed: false,
        durationMs,
        failures: [error instanceof Error ? error.message : String(error)],
      });
    }
  }
} finally {
  rmSync(evalRoot, { recursive: true, force: true });
}

let failed = 0;
for (const result of results) {
  const status = result.passed ? "PASS" : "FAIL";
  console.log(`${status} ${result.file} (${result.durationMs}ms)`);
  if (!result.passed) {
    failed += 1;
    for (const failure of result.failures) {
      console.log(`  - ${failure}`);
    }
    if (result.diagnosis) {
      console.log(`  diagnosis: ${JSON.stringify(result.diagnosis)}`);
    }
  }
}

console.log(
  `\n${results.length - failed}/${results.length} issue-triage evals passed`,
);

if (failed > 0) {
  process.exit(1);
}
