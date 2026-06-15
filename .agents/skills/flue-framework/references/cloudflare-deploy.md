# Cloudflare Deploy

## Build Model

The Cloudflare target builds Flue agents and workflows for Workers. Each discovered agent and workflow becomes a generated Durable Object class and binding.

Example generated names:

| Source file | Class | Binding |
| --- | --- | --- |
| `agents/support-chat.ts` | `FlueSupportChatAgent` | `env.FLUE_SUPPORT_CHAT_AGENT` |
| `workflows/translate.ts` | `FlueTranslateWorkflow` | `env.FLUE_TRANSLATE_WORKFLOW` |

The class name is used in Wrangler migrations. The binding is available to application code through `env`.

## `wrangler.jsonc`

Cloudflare Flue projects need:

- `compatibility_flags` containing `nodejs_compat`.
- Durable Object migrations for `FlueRegistry` and every generated agent/workflow class.
- Any application-owned Durable Object bindings/classes.
- AI binding when using binding-backed `cloudflare/...` models.
- Container binding/image when using Cloudflare Sandbox.

Append migrations when adding discovered agents or workflows. Never rewrite or reorder migration entries that may have been deployed. Generated Flue classes use `new_sqlite_classes`, not legacy `new_classes`.

Initial shape:

```json
{
  "compatibility_flags": ["nodejs_compat"],
  "ai": { "binding": "AI" },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": [
        "FlueRegistry",
        "FlueIssueTriageAgent",
        "FlueIssueTriageWorkflow"
      ]
    }
  ]
}
```

Use `renamed_classes` and `deleted_classes` only for intentional deployed class changes.

## Workers AI

Use binding-backed Workers AI with `cloudflare/...` models:

```ts
export default createAgent(() => ({
  model: "cloudflare/@cf/moonshotai/kimi-k2.6",
}));
```

Declare the `AI` binding in Wrangler. This path does not need a model-provider API key in the app environment. Authorization and billing follow the Worker account. Flue routes binding-backed calls through Cloudflare AI Gateway by default; re-register provider ID `cloudflare` in `app.ts` to choose gateway settings or set `gateway: false`.

## Cloudflare Sandbox

Use Cloudflare Sandbox when agents need a full Linux environment, git, package managers, native tools, browser dependencies, or durable filesystem behavior.

Repository pattern:

```ts
import { getSandbox, type Sandbox } from "@cloudflare/sandbox";
import { createAgent } from "@flue/runtime";
import { cfSandboxToSessionEnv } from "@flue/runtime/cloudflare";

type Env = {
  Sandbox: DurableObjectNamespace<Sandbox>;
};

export default createAgent<unknown, Env>(({ id, env }) => ({
  model: "cloudflare/@cf/moonshotai/kimi-k2.6",
  cwd: "/workspace",
  sandbox: {
    createSessionEnv: () =>
      cfSandboxToSessionEnv(getSandbox(env.Sandbox, id), "/workspace"),
  },
}));
```

Also:

- Export `Sandbox` from source-root `cloudflare.ts`.
- Add a `Sandbox` Durable Object binding and migration.
- Add a `containers` entry with the image path.
- Make the sandbox identity stable when workspace reuse matters.

Use Cloudflare Shell instead of Cloudflare Sandbox when a durable Workspace plus structured code tool is enough and arbitrary Linux shell access is not required.

## Extending Generated Durable Objects

Flue owns the generated Durable Object class. Use module-local `cloudflare = extend(...)` to add Cloudflare behavior.

Use `base` for Agents SDK lifecycle methods:

```ts
import { extend } from "@flue/runtime/cloudflare";

export const cloudflare = extend({
  base: (Base) =>
    class extends Base {
      async onStart() {
        await this.scheduleEvery(60, "heartbeat");
      }
    },
});
```

Use `wrap` for prototype-preserving instrumentation:

```ts
export const cloudflare = extend({
  wrap: (Final) => instrument(Final),
});
```

Do not override Flue-owned `fetch()`, `onRequest()`, WebSocket hooks, `onFiberRecovered()`, or `alarm()`.

## `cloudflare.ts`

Use source-root `cloudflare.ts` for Worker-level Cloudflare exports that are not HTTP routing.

- Named exports become top-level Worker exports, such as application-owned Durable Objects.
- Default export may provide non-HTTP handlers such as `scheduled`.
- Do not define default `fetch`; HTTP composition belongs in `app.ts`.

In this repo, `cloudflare.ts` exports Cloudflare Sandbox:

```ts
export { Sandbox } from "@cloudflare/sandbox";
```

## Deploy Commands

This repo:

```bash
pnpm run typecheck
pnpm run build
pnpm run deploy
```

Generic Cloudflare flow:

```bash
pnpm exec flue dev --target cloudflare
pnpm exec flue build --target cloudflare
pnpm exec wrangler secret put <NAME>
pnpm exec wrangler deploy
```

Local Cloudflare dev uses Workers tooling for runtime variables. Avoid committing `.env`, `.dev.vars`, API tokens, or generated secrets.
