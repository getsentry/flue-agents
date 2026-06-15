# Agents And Workflows

## Choose The Surface

| Need | Use |
| --- | --- |
| Continuing conversation or event stream keyed by instance and session | Addressable agent |
| One finite unit of work with a result, run history, and deterministic setup | Workflow |
| External webhook or event should enqueue work without direct prompt exposure | Custom route plus `dispatch(...)` |
| Workflow needs dependable fields | Valibot `result` schema |

## Agents

Create one discovered agent per flat file:

```ts
import { createAgent, type AgentRouteHandler } from "@flue/runtime";

export const route: AgentRouteHandler = async (_c, next) => next();

export default createAgent(({ id, env }) => ({
  model: env.FLUE_MODEL ?? "cloudflare/@cf/moonshotai/kimi-k2.6",
  instructions: `Help with work for instance ${id}.`,
}));
```

`createAgent(...)` runs whenever Flue initializes a harness for an addressable interaction or workflow `init(...)`. Do not treat it as a one-time constructor for an instance ID.

Important runtime config fields:

| Field | Use |
| --- | --- |
| `model` | Default model specifier, or `false` to require call-level selection. |
| `instructions` | Agent behavior and operating context. |
| `tools` | Model-callable application functions. |
| `skills` | Imported skill references. |
| `subagents` | Named `defineAgentProfile(...)` profiles for delegation. |
| `thinkingLevel` | Default reasoning effort. |
| `compaction` | Conversation compaction policy; `false` disables threshold compaction. |
| `durability` | Durable submission recovery limits and timeouts. |
| `cwd` | Working directory inside the sandbox. |
| `sandbox` | Sandbox factory, `false`, or default virtual sandbox. |

## Agent Instances And Sessions

- Agent file name is the agent name.
- `id` selects a continuing agent instance.
- `session` selects conversation history within that instance; default is `default`.
- Separate sessions can keep separate histories.
- Direct HTTP/WebSocket prompts and `dispatch(...)` inputs are not workflow runs.

Expose only the transports the application needs:

```ts
import type { AgentRouteHandler, AgentWebSocketHandler } from "@flue/runtime";

export const route: AgentRouteHandler = async (_c, next) => next();
export const websocket: AgentWebSocketHandler = async (_c, next) => next();
```

Omit these exports for workflow-owned agents or agents that only receive application-owned dispatches.

## Dispatch

Use `dispatch(...)` when trusted application code has already authenticated, normalized, and routed an event:

```ts
import { dispatch } from "@flue/runtime";
import supportAgent from "./agents/support-agent.ts";

await dispatch(supportAgent, {
  id: ticketId,
  session: "events",
  input: { type: "support.comment.created", commentId },
});
```

Use an application-level idempotency key around external effects when callers may retry events.

## Workflows

A workflow exports `run(...)`; its file name is the workflow name:

```ts
import { createAgent, type FlueContext } from "@flue/runtime";
import * as v from "valibot";

const worker = createAgent(() => ({
  model: "cloudflare/@cf/moonshotai/kimi-k2.6",
  instructions: "Return a concise decision.",
}));

const Result = v.object({
  decision: v.picklist(["accept", "reject"]),
  reason: v.string(),
});

export async function run({ init, payload }: FlueContext<{ text: string }>) {
  const harness = await init(worker);
  const session = await harness.session();
  const response = await session.prompt(payload.text, { result: Result });
  return response.data;
}
```

Workflow code may do ordinary TypeScript before, between, or after agent operations. Use `harness.fs` and `harness.shell(...)` for workflow-controlled setup that should not become conversation history.

Expose workflow transports only when needed:

```ts
import type { WorkflowRouteHandler, WorkflowWebSocketHandler } from "@flue/runtime";

export const route: WorkflowRouteHandler = async (_c, next) => next();
export const websocket: WorkflowWebSocketHandler = async (_c, next) => next();
```

HTTP workflow invocation is `POST /workflows/<name>`. Workflow WebSocket invocation is finite and ends with that run; it is not a continuing agent conversation.

## Sessions And Operations

Use:

- `harness.session(name?)` for the default or named session.
- `session.prompt(input, options?)` for model interaction.
- `session.skill(name, options?)` to force a registered or workspace-discovered skill.
- `session.task(input, { agent, ... })` to delegate to a named subagent profile.
- `session.shell(command, options?)` for command output that should be included in session context.
- `session.fs` or `harness.fs` for file operations.
- `session.compact()` to compact current session context.
- `session.delete()` to delete a session.

Paths may be absolute or relative. Relative paths use configured `cwd`; absolute paths are more portable across sandbox connectors.
