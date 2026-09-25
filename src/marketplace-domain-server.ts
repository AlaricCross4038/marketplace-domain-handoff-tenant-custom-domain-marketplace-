import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { buyerDomainSchema, sellerAssetSchema, DomainHandoffStore, startDomainHandoff, acceptVerifiedWebhook } from "./domain-handoff.js";
import { InfraiClient, InfraiError, infrai } from "./infrai-client.js";

const apiKey = process.env.INFRAI_API_KEY;
const webhookSecret = process.env.INFRAI_WEBHOOK_SECRET;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");
if (!webhookSecret) throw new Error("Set INFRAI_WEBHOOK_SECRET before starting the service");

const client = new InfraiClient(apiKey);
const store = new DomainHandoffStore();

export const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/seller/assets") {
      const asset = sellerAssetSchema.parse(JSON.parse((await readBody(request)).toString("utf8")));
      return json(response, 201, store.addAsset(asset));
    }
    if (request.method === "POST" && request.url === "/buyer/domain-orders") {
      const input = buyerDomainSchema.parse(JSON.parse((await readBody(request)).toString("utf8")));
      return json(response, 202, await startDomainHandoff(client, store, input));
    }
    if (request.method === "POST" && request.url === "/webhooks/infrai") {
      const rawBody = await readBody(request);
      const handoff = acceptVerifiedWebhook(store, rawBody, String(request.headers["x-infrai-signature"] ?? ""), webhookSecret);
      return json(response, 200, { received: true, handoff });
    }
    if (request.method === "POST" && request.url === "/account/register-domain-webhook") {
      const publicUrl = process.env.PUBLIC_BASE_URL;
      if (!publicUrl) throw new Error("Set PUBLIC_BASE_URL before registering the webhook");
      const registration = await infrai.account.webhooks.register(client, {
        url: new URL("/webhooks/infrai", publicUrl).toString(),
        events: ["dns.domain.verified"],
        description: "Marketplace domain handoff",
        secret: webhookSecret,
      });
      return json(response, 201, registration);
    }
    const match = request.method === "GET" && request.url?.match(/^\/orders\/([^/]+)$/);
    if (match) {
      const handoff = store.handoffs.get(decodeURIComponent(match[1]));
      return handoff ? json(response, 200, handoff) : json(response, 404, { error: "Order not found" });
    }
    return json(response, 404, { error: "Route not found" });
  } catch (error) {
    if (error instanceof ZodError) return json(response, 400, { error: "Invalid request", issues: error.issues });
    if (error instanceof InfraiError) return json(response, error.status >= 400 && error.status < 500 ? error.status : 502, { error: error.code });
    return json(response, 500, { error: error instanceof Error ? error.message : "Unexpected error" });
  }
});

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => console.log(`Marketplace domain service listening on http://localhost:${port}`));
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
