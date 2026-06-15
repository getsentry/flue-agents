# Capabilities

## Tools

Use tools for executable application capabilities, not for filesystem or shell access. A tool has a model-facing `name`, `description`, `parameters`, and `execute`.

```ts
import { Type, defineTool } from "@flue/runtime";

export const lookupIssue = defineTool({
  name: "lookup_issue",
  description: "Look up one issue by numeric ID.",
  parameters: Type.Object({
    issueId: Type.Number({ description: "Issue ID" }),
  }),
  execute: async ({ issueId }) => {
    return JSON.stringify(await issues.get(String(issueId)));
  },
});
```

Attach stable tools in `createAgent({ tools })`. Attach invocation-specific tools through `init(agent, { tools })` or operation options.

Security rule: model-selected tool arguments are not an authorization boundary. Trusted application code should decide tenant, account, repository, credential, and allowed destination. Let the model choose only bounded values inside that scope.

## MCP Servers

Use `connectMcpServer(...)` when capabilities come from a remote MCP server:

```ts
const inventory = await connectMcpServer("inventory", {
  url: env.INVENTORY_MCP_URL,
  headers: { Authorization: `Bearer ${env.INVENTORY_MCP_TOKEN}` },
});

try {
  const harness = await init(agent, { tools: inventory.tools });
  return await (await harness.session()).prompt(payload.question);
} finally {
  await inventory.close();
}
```

Close MCP connections after the work using their tools finishes. Flue prefixes MCP tool names with the connection name, such as `mcp__inventory__lookup_item`.

## Skills

Use skills for reusable instructions and supporting resources. Skills do not add executable capabilities.

Imported skills are packaged with the application:

```ts
import review from "../skills/review/SKILL.md" with { type: "skill" };

export default createAgent(() => ({
  model: "cloudflare/@cf/moonshotai/kimi-k2.6",
  skills: [review],
}));
```

Workspace-discovered skills live under `<cwd>/.agents/skills/<name>/SKILL.md` inside the sandbox and do not need TypeScript imports. If an imported skill and workspace-discovered skill have the same declared name, initialization fails.

Use `session.skill("name", { args, result })` when workflow code must force a skill and receive structured data.

Do not store credentials, tokens, private keys, or sensitive customer data in imported skill directories.

## Subagents

Subagents are named `defineAgentProfile(...)` profiles available to a parent agent. They are not separately addressable endpoints.

```ts
import { createAgent, defineAgentProfile } from "@flue/runtime";

const reviewer = defineAgentProfile({
  name: "reviewer",
  instructions: "Review the proposed change and list correctness risks.",
});

export default createAgent(() => ({
  model: "cloudflare/@cf/moonshotai/kimi-k2.6",
  subagents: [reviewer],
}));
```

The parent can delegate through the built-in task capability, or workflow code can call:

```ts
await session.task(payload.change, {
  agent: "reviewer",
  result: ReviewSchema,
});
```

The child session gets its own context, not the parent transcript. Persistence remains owned under the parent session, and the sandbox boundary is shared unless task options override the working directory.

## Sandboxes

Choose the sandbox by required capability:

| Need | Sandbox |
| --- | --- |
| Fast prompt-and-response, small staged files, no durable filesystem | Default virtual sandbox |
| Local Node development with host filesystem and commands | `local(...)` from `@flue/runtime/node` |
| Cloudflare full Linux environment, git, package managers, native binaries | Cloudflare Sandbox |
| Cloudflare durable Workspace with structured code tool, no arbitrary shell | Cloudflare Shell |
| External VM/container provider | Connector from the ecosystem or custom `SandboxApi` |

Database persistence does not make a sandbox filesystem durable. Sandbox lifecycle, file retention, installed packages, network egress, and credentials are separate decisions.

Set `cwd` explicitly when paths matter. For container-backed coding agents, prefer a stable absolute path such as `/workspace`.

## Custom Sandbox Connector

A connector implements `SandboxApi`: file read/write/stat/list/mkdir/remove and command `exec(...)`. Use `pnpm exec flue add --category sandbox <docs-url-or-path>` when researching a new provider connector.
