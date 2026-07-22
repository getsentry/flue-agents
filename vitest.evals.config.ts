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
    hookTimeout: 70_000,
    include: ["evals/**/*.eval.ts"],
    maxWorkers: 1,
    reporters: ["vitest-evals/reporter"],
    testTimeout: 130_000,
  },
});
