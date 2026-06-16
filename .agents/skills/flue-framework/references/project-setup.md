# Project Setup

## Layout Rules

Flue discovers authored source from one source root, in order:

1. `.flue/`
2. `src/`
3. project root

The first existing source root wins. Flue does not merge agents, workflows, `app.ts`, or `cloudflare.ts` across roots.

In this repo:

- Keep discovered modules in the `src/` layout.
- Add agents as `src/agents/<lower-kebab-name>.ts`.
- Add workflows as `src/workflows/<lower-kebab-name>.ts`.
- Add imported application skills under `src/skills/<name>/`.
- Add application-owned channels, when needed, under `src/channels/<name>.ts`.
- Keep discovered agent and workflow files flat; nested files are supporting code, not discovered modules.
- Update `README.md` and append Durable Object migrations in `wrangler.jsonc` when adding discovered agents or workflows.

## Configuration

Use `flue.config.ts` when a project needs authored config:

```ts
import { defineConfig } from "@flue/cli/config";

export default defineConfig({
  target: "cloudflare",
  output: "./dist",
});
```

Accepted options are:

| Option | Use |
| --- | --- |
| `target` | Required unless passed by CLI. Either `"node"` or `"cloudflare"`. |
| `root` | Project root. Relative values in config resolve from the config file directory. |
| `output` | Build output directory. Defaults to `<root>/dist`. |

CLI overrides beat config. Relative CLI `--root`, `--output`, and `--config` values resolve from the current working directory. Relative `--env` values resolve from the config base.

## Models And Providers

Model specifiers are `<provider>/<model>`, such as:

- `anthropic/claude-sonnet-4-6`
- `openai/gpt-5.5`
- `openrouter/moonshotai/kimi-k2.6`
- `cloudflare/@cf/moonshotai/kimi-k2.6`

Set an agent default with `model`, and override per operation with `session.prompt(..., { model })`, `session.skill(..., { model })`, or `session.task(..., { model })`.

Use `thinkingLevel` for reasoning effort: `off`, `minimal`, `low`, `medium`, `high`, or `xhigh`. The default is `medium`; unsupported provider paths may ignore it.

Keep provider credentials out of source. Built-in providers generally use environment variables such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `OPENROUTER_API_KEY`. Cloudflare binding-backed `cloudflare/...` models use the Worker `AI` binding instead of a model-provider API key.

## Provider Customization

Use `configureProvider(...)` in `app.ts` to adjust a built-in provider endpoint, API key, headers, or OpenAI response persistence while keeping the provider ID.

Use `registerProvider(...)` in `app.ts` for a custom provider ID:

```ts
import { registerProvider } from "@flue/runtime";

registerProvider("ollama", {
  api: "openai-completions",
  baseUrl: "http://localhost:11434/v1",
});
```

Avoid registering a built-in provider ID unless intentionally overriding it.

## Commands

Common Flue commands:

```bash
pnpm exec flue init --target cloudflare
pnpm exec flue dev --target cloudflare
pnpm exec flue build --target cloudflare
pnpm exec flue run <workflow> --target node --payload '{"key":"value"}'
pnpm exec flue connect <agent> <instance-id> --target node
pnpm exec flue logs <runId> --server http://127.0.0.1:3583
pnpm exec flue add <connector>
```

`flue run` and `flue connect` are Node-local commands. For Cloudflare local dev, use `flue dev --target cloudflare` and invoke HTTP or WebSocket routes.
