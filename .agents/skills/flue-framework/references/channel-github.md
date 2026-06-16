# GitHub Channel

Use the GitHub channel when a Flue app should receive signed GitHub webhook deliveries and use Octokit from trusted application code.

## Install And Place

- Prefer `flue add channel github` for the blueprint.
- The blueprint installs `@flue/github` and `@octokit/rest`.
- Keep the channel module under the source root, `src/channels/github.ts` in this repo.
- Export named `channel` and `client` bindings from the channel module.
- Mount the channel under `flue()`; the documented path is `/channels/github/webhook`, including any outer route prefix.

Required runtime values:

| Variable | Use |
| --- | --- |
| `GITHUB_WEBHOOK_SECRET` | Verifies inbound GitHub deliveries. |
| `GITHUB_TOKEN` | Authenticates outbound Octokit calls for user/token based apps. |

For GitHub App flows, keep app credentials in trusted application code or environment bindings and do not expose installation, repository, or credential selection to the model.

## Delivery Contract

- Configure GitHub webhooks with content type `application/json`; form-encoded deliveries are not accepted.
- Subscribe only to events the application handles.
- Branch on `delivery.name`, the `X-GitHub-Event` value.
- Branch on `delivery.payload.action` where the event has actions.
- Treat `delivery.payload` as the native `@octokit/webhooks-types` payload. Do not invent a normalized shape.
- GitHub `ping` is acknowledged by the channel and does not reach the callback.
- Acknowledge unsupported verified deliveries by returning without dispatching work.
- Dispatch durable work quickly; GitHub expects a `2xx` response within ten seconds.
- Claim `delivery.deliveryId` in application storage before dispatch when duplicate admission matters; the channel is stateless.

Useful native payload paths:

| Need | Native field |
| --- | --- |
| Repository owner | `payload.repository.owner.login` |
| Repository name | `payload.repository.name` |
| Repository full name | `payload.repository.full_name` |
| Issue number | `payload.issue.number` |
| Pull request issue number | `payload.pull_request.number` |
| Review comment thread | `payload.comment.in_reply_to_id ?? payload.comment.id` |

Pull requests use their issue number for issue comments.

## Dispatch Pattern

Trusted code authenticates the delivery, decides the repository and event policy, then dispatches a bounded input to an agent or workflow.

```ts
export const channel = createGitHubChannel({
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
  async webhook({ delivery }) {
    if (
      delivery.name === "issue_comment" &&
      delivery.payload.action === "created"
    ) {
      const { repository, issue, comment } = delivery.payload;
      await dispatch(assistant, {
        id: channel.conversationKey({
          owner: repository.owner.login,
          repo: repository.name,
          issueNumber: issue.number,
        }),
        input: {
          type: "github.issue_comment.created",
          deliveryId: delivery.deliveryId,
          installationId: delivery.payload.installation?.id,
          comment: { id: comment.id, body: comment.body },
        },
      });
    }
  },
});
```

## Tool Binding

Bind outbound Octokit tools in trusted code. Let the model choose bounded content, such as comment body, not repository, issue, credential, tenant, or arbitrary API method.

```ts
export function commentOnIssue(ref: {
  owner: string;
  repo: string;
  issueNumber: number;
}) {
  return defineTool({
    name: "comment_on_github_issue",
    description: "Comment on the GitHub issue or pull request bound to this agent.",
    parameters: {
      type: "object",
      properties: { body: { type: "string", minLength: 1 } },
      required: ["body"],
      additionalProperties: false,
    },
    async execute({ body }) {
      const result = await client.rest.issues.createComment({
        owner: ref.owner,
        repo: ref.repo,
        issue_number: ref.issueNumber,
        body,
      });
      return JSON.stringify({ commentId: result.data.id });
    },
  });
}
```

## Repo Notes

- This repo currently accepts `/channels/github/webhook` and a compatibility `/github/webhook` route.
- The app policy admits verified `issues.opened` deliveries into the `issue-triage` workflow.
- Keep direct Flue workflow routes protected for manual/operator use.
