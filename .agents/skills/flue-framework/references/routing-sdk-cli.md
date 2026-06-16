# Routing, SDK, And CLI

## `app.ts`

Add source-root `app.ts` when the app needs authentication, health checks, webhooks, route prefixes, provider registration, or custom HTTP routes.

```ts
import { flue } from "@flue/runtime/routing";
import { Hono } from "hono";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));
app.use("/agents/*", requireUser);
app.use("/workflows/*", requireUser);
app.use("/runs/*", requireUser);
app.route("/", flue());

export default app;
```

Without `app.ts`, Flue generates a default application mounted at `/`.

Use `app.route("/api", flue())` to mount under a prefix. SDK `baseUrl` must include that prefix.

## Public Flue Routes

Mounting `flue()` does not expose every module. Modules opt in by export:

| Module export | Route under mount |
| --- | --- |
| Agent `route` | `POST /agents/:name/:id` |
| Agent `websocket` | `GET /agents/:name/:id` WebSocket upgrade |
| Workflow `route` | `POST /workflows/:name` |
| Workflow `websocket` | `GET /workflows/:name` WebSocket upgrade |

Workflow run routes under the same mount:

- `GET /runs/:runId`
- `GET /runs/:runId/events`
- `GET /runs/:runId/stream`

Administrative routes from `admin()` are read-only but can expose sensitive payloads, results, model activity, and metadata. Put them behind an appropriate authorization boundary.

## HTTP Response Modes

Workflow HTTP invocation can return an accepted run or wait for result depending on query mode. In this repo, examples use:

```bash
curl "http://localhost:3583/workflows/issue-triage?wait=result" \
  -H "Content-Type: application/json" \
  -d '{"repository":"getsentry/sentry-mcp","issueNumber":1059}'
```

Authorize workflow invocation and run-inspection endpoints before admitting work or revealing run data.

## SDK Client

Use `createFlueClient(...)` for deployed apps:

```ts
import { createFlueClient } from "@flue/sdk";

const client = createFlueClient({
  baseUrl: "https://example.com/api",
  token: process.env.FLUE_TOKEN,
});
```

Important options:

| Option | Use |
| --- | --- |
| `baseUrl` | Public `flue()` mount URL, including pathname prefix. |
| `headers` or `token` | Per-request auth. |
| `adminBasePath` | Origin-relative admin mount path, defaults to `/admin`. |
| `websocketUrl` | Transform WebSocket URL, e.g. add handshake auth. |

SDK namespaces:

- `client.agents.invoke(...)` for HTTP agent prompts.
- `client.agents.connect(...)` for agent WebSockets.
- `client.workflows.connect(...)` for workflow WebSockets.
- `client.runs.get(...)`, `.events(...)`, `.stream(...)` for run inspection.
- `client.admin.agents.list()` and `client.admin.runs.*` for protected admin tooling.

## CLI

Commands and uses:

| Command | Use |
| --- | --- |
| `flue init` | Write initial `flue.config.ts`. |
| `flue dev` | Watch-mode local server. Cloudflare target uses Wrangler. |
| `flue build` | Write deployable output to `dist/` by default. |
| `flue run` | Execute one workflow locally on Node target. |
| `flue connect` | Interactive local agent connection on Node target. |
| `flue logs` | Replay or follow workflow-run events from a running server. |
| `flue add` | Fetch connector installation recipes. |

Common options: `--target`, `--root`, `--output`, `--config`, and `--env`.

In this repo, prefer package scripts:

```bash
pnpm run dev
pnpm run build
pnpm run deploy
pnpm run typecheck
pnpm run test
```
