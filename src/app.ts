import { flue, type Fetchable } from "@flue/runtime/routing";

const flueApp = flue();
const robotsTxt = "User-agent: *\nDisallow: /\n";

const app: Fetchable = {
  fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (
      url.pathname === "/robots.txt" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      return new Response(request.method === "HEAD" ? null : robotsTxt, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }

    return flueApp.fetch(request, env, ctx as ExecutionContext | undefined);
  },
};

export default app;
