// Owns the local Flue boundary used by eval suites. The suite owns one server
// lifecycle, each harness call creates a fresh workflow run, and the child gets
// only the environment needed to execute Flue and call the configured LLM.
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createServer } from "node:net";
import type { Readable } from "node:stream";

import { createFlueClient, type FlueEvent } from "@flue/sdk";
import {
  createHarness,
  type JsonValue,
  type TranscriptEvent,
  toJsonValue,
} from "vitest-evals";

const EVAL_SERVER_ENV_KEYS = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "NODE_OPTIONS",
  "CI",
  "NO_COLOR",
  "FORCE_COLOR",
  "OPENROUTER_API_KEY",
] as const;

type EvalServer = {
  baseUrl: () => string;
  ensureRunning: () => Promise<void>;
  stop: () => Promise<void>;
};

type EvalServerProcess = ChildProcessByStdio<null, Readable, Readable>;

type RunningEvalServer = {
  baseUrl: string;
  child: EvalServerProcess;
};

type WorkflowHarnessOptions<
  TInput,
  TOutput extends JsonValue,
> = {
  name: string;
  workflowName: string;
  getBaseUrl: () => string | Promise<string>;
  inputMessage: (input: TInput) => string;
  parseOutput: (output: unknown) => TOutput;
  timeoutMs?: number;
};

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

  if (!address || typeof address === "string") {
    throw new Error("Could not allocate a local Flue eval server port.");
  }
  return address.port;
}

function appendLog(current: string, chunk: Buffer) {
  return `${current}${chunk.toString("utf8")}`.slice(-20_000);
}

function isTerminated(child: EvalServerProcess) {
  return child.exitCode !== null || child.signalCode !== null;
}

/** Waits until the local HTTP boundary is reachable or startup fails. */
async function waitForServer(
  child: EvalServerProcess,
  baseUrl: string,
  startupLogs: () => string,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  let spawnError: Error | undefined;
  const onError = (error: Error) => {
    spawnError = error;
  };
  child.on("error", onError);

  try {
    while (Date.now() < deadline) {
      if (spawnError) {
        throw new Error(`Flue eval server could not start: ${spawnError.message}`);
      }
      if (isTerminated(child)) {
        const status =
          child.exitCode !== null
            ? `with code ${child.exitCode}`
            : `from signal ${child.signalCode}`;
        throw new Error(
          `Flue eval server exited ${status} during startup:\n${startupLogs()}`,
        );
      }

      try {
        await fetch(baseUrl, { signal: AbortSignal.timeout(1_000) });
        return;
      } catch {
        await delay(100);
      }
    }
  } finally {
    child.off("error", onError);
  }

  throw new Error(
    `Flue eval server did not become ready within ${timeoutMs}ms:\n${startupLogs()}`,
  );
}

/** Stops the suite-owned server, escalating only when graceful shutdown stalls. */
async function stopChild(child: EvalServerProcess) {
  if (isTerminated(child)) {
    return;
  }

  const closed = new Promise<void>((resolve, reject) => {
    child.once("close", () => resolve());
    child.once("error", reject);
  });
  child.kill("SIGTERM");
  await Promise.race([closed, delay(5_000)]);
  if (!isTerminated(child)) {
    child.kill("SIGKILL");
    await Promise.race([closed, delay(5_000)]);
  }
}

/** Starts one local Flue Node server for an eval suite. */
export async function startFlueEvalServer(options: {
  cwd: string;
  root: string;
  envFile: string;
  startupTimeoutMs?: number;
}): Promise<EvalServer> {
  const env: NodeJS.ProcessEnv = {};
  for (const key of EVAL_SERVER_ENV_KEYS) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }

  let current: RunningEvalServer | undefined;
  let startPromise: Promise<RunningEvalServer> | undefined;
  let stopped = false;

  const start = async () => {
    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const child = spawn(
      "pnpm",
      [
        "exec",
        "flue",
        "dev",
        "--target",
        "node",
        "--root",
        options.root,
        "--env",
        options.envFile,
        "--port",
        String(port),
      ],
      {
        cwd: options.cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let logs = "";
    child.stdout.on("data", (chunk: Buffer) => {
      logs = appendLog(logs, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      logs = appendLog(logs, chunk);
    });

    try {
      await waitForServer(
        child,
        baseUrl,
        () => logs,
        options.startupTimeoutMs ?? 60_000,
      );
    } catch (error) {
      await stopChild(child);
      throw error;
    }
    return { baseUrl, child };
  };

  const ensureRunning = async () => {
    if (stopped) {
      throw new Error("Flue eval server has already stopped.");
    }

    if (current && !isTerminated(current.child)) {
      try {
        await fetch(current.baseUrl, { signal: AbortSignal.timeout(1_000) });
        return;
      } catch {
        await stopChild(current.child);
        current = undefined;
      }
    }

    startPromise ??= start();
    try {
      current = await startPromise;
    } finally {
      startPromise = undefined;
    }
  };

  await ensureRunning();

  return {
    baseUrl: () => {
      if (!current || isTerminated(current.child)) {
        throw new Error("Flue eval server is not running.");
      }
      return current.baseUrl;
    },
    ensureRunning,
    stop: async () => {
      stopped = true;
      const pending = startPromise;
      const running =
        current ?? (pending ? await pending.catch(() => undefined) : undefined);
      current = undefined;
      if (running) {
        await stopChild(running.child);
      }
    },
  };
}

/** Converts Flue tool lifecycle events into vitest-evals transcript events. */
function recordToolEvent(
  event: FlueEvent,
  transcript: TranscriptEvent[],
) {
  if (event.type === "tool_start") {
    const args = toJsonValue(event.args);
    transcript.push({
      type: "tool_call",
      id: event.toolCallId,
      name: event.toolName,
      arguments:
        args && typeof args === "object" && !Array.isArray(args) ? args : {},
    });
    return;
  }

  if (event.type === "tool_call") {
    const result = toJsonValue(event.result) ?? null;
    const base = {
      type: "tool_result",
      toolCallId: event.toolCallId,
      name: event.toolName,
    } as const;
    if (event.isError) {
      const details =
        result && typeof result === "object" && !Array.isArray(result)
          ? result
          : {};
      const message =
        typeof result === "string"
          ? result
          : typeof details.message === "string"
            ? details.message
            : result === null
              ? "Tool call failed"
              : JSON.stringify(result);
      transcript.push({
        ...base,
        error: { ...details, message },
      });
    } else {
      transcript.push({ ...base, content: result });
    }
  }
}

/** Creates a vitest-evals harness backed by fresh runs on the suite server. */
export function createFlueWorkflowHarness<
  TInput,
  TOutput extends JsonValue,
>(options: WorkflowHarnessOptions<TInput, TOutput>) {
  return createHarness<TInput, TOutput>({
    name: options.name,
    run: async ({ input, signal }) => {
      const startedAt = performance.now();
      const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? 60_000);
      const runSignal = signal
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal;
      const client = createFlueClient({ baseUrl: await options.getBaseUrl() });
      const admission = await client.workflows.invoke(options.workflowName, {
        payload: input,
        signal: runSignal,
      });
      const transcript: TranscriptEvent[] = [
        {
          type: "message",
          role: "user",
          content: options.inputMessage(input),
        },
      ];
      let output: TOutput | undefined;
      let inputTokens = 0;
      let outputTokens = 0;
      let totalTokens = 0;
      let cost = 0;
      let provider: string | undefined;
      let model: string | undefined;
      let toolCalls = 0;

      const stream = client.runs.stream(admission.runId, {
        live: true,
        signal: runSignal,
      });
      try {
        for await (const event of stream) {
          if (event.type === "tool_start" || event.type === "tool_call") {
            if (event.type === "tool_call") {
              toolCalls += 1;
            }
            recordToolEvent(event, transcript);
          }

          if (event.type === "turn" && event.usage) {
            provider ??= event.provider;
            model ??= event.model;
            inputTokens += event.usage.input;
            outputTokens += event.usage.output;
            totalTokens += event.usage.totalTokens;
            cost += event.usage.cost.total;
          }

          if (event.type === "run_end") {
            if (event.isError) {
              throw new Error(
                `Flue workflow ${options.workflowName} failed: ${JSON.stringify(event.error)}`,
              );
            }
            output = options.parseOutput(event.result);
          }
        }
      } finally {
        stream.cancel();
      }

      if (output === undefined) {
        throw new Error(
          `Flue workflow ${options.workflowName} ended without a result.`,
        );
      }

      transcript.push({
        type: "message",
        role: "assistant",
        content: output,
      });

      return {
        output,
        events: transcript,
        usage: {
          provider,
          model,
          inputTokens,
          outputTokens,
          totalTokens,
          toolCalls,
          retries: 0,
          metadata: { cost },
        },
        timings: {
          totalMs: performance.now() - startedAt,
        },
        artifacts: {
          runId: admission.runId,
        },
      };
    },
  });
}
