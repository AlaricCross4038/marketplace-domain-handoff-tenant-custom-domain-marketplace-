import { createHmac } from "node:crypto";
import { acceptVerifiedWebhook, DomainHandoffStore } from "./domain-handoff.js";

const store = new DomainHandoffStore();
store.addAsset({ sellerId: "seller-17", assetId: "course-42", originHostname: "shops.example.net" });
store.addHandoff({
  orderId: "order-1042",
  assetId: "course-42",
  buyerId: "buyer-8",
  domain: "learn.customer.example",
  zoneId: "zone-demo-1",
  state: "awaiting_verification",
});

const body = Buffer.from(JSON.stringify({
  event: "dns.domain.verified",
  data: { domain: "learn.customer.example", zone_id: "zone-demo-1" },
}));
const secret = "local-demo-secret";
const signature = createHmac("sha256", secret).update(body).digest("hex");
const ready = acceptVerifiedWebhook(store, body, signature, secret);

console.log(JSON.stringify(ready, null, 2));
