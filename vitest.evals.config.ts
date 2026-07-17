import { config } from "dotenv";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import DefaultEvalReporter from "vitest-evals/reporter";

config({
  path: [
    resolve(process.env.FLUE_EVAL_ENV ?? ".env.local"),
    resolve(".env"),
  ],
  quiet: true,
});

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    hookTimeout: 60_000,
    include: ["evals/**/*.eval.ts"],
    maxWorkers: 1,
    outputFile: { json: "vitest-results.json" },
    reporters: [new DefaultEvalReporter(), "json"],
    testTimeout: 60_000,
  },
});
