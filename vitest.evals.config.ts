import { config } from "dotenv";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

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
    hookTimeout: 100_000,
    include: ["evals/**/*.eval.ts"],
    maxWorkers: 1,
    outputFile: { json: "vitest-results.json" },
    reporters: ["vitest-evals/reporter", "json"],
    retry: 2,
    testTimeout: 240_000,
  },
});
