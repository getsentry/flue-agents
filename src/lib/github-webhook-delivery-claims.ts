// Owns idempotent GitHub webhook admission claims. Each delivery id maps to
// one Durable Object instance, so redeliveries are rejected before workflow
// side effects can run twice.
export class GitHubWebhookDeliveryClaims {
  constructor(private readonly ctx: DurableObjectState) {}

  async fetch(request: Request) {
    if (request.method !== "PUT") {
      return new Response(null, { status: 405 });
    }

    const claimed = await this.ctx.storage.transaction(async (txn) => {
      if (await txn.get("claimed")) {
        return false;
      }

      await txn.put("claimed", Date.now());
      return true;
    });

    return new Response(null, { status: claimed ? 201 : 409 });
  }
}
