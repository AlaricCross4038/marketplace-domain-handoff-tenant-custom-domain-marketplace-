import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { acceptVerifiedWebhook, DomainHandoffStore } from "../src/domain-handoff.js";

test("a matching signed verification makes the purchased asset ready for delivery", () => {
  const store = new DomainHandoffStore();
  store.addHandoff({
    orderId: "order-1042",
    assetId: "course-42",
    buyerId: "buyer-8",
    domain: "learn.customer.example",
    zoneId: "zone-9",
    state: "awaiting_verification",
  });
  const secret = "test-secret";
  const body = Buffer.from(JSON.stringify({
    event: "dns.domain.verified",
    data: { domain: "learn.customer.example", zone_id: "zone-9" },
  }));
  const signature = createHmac("sha256", secret).update(body).digest("hex");

  const handoff = acceptVerifiedWebhook(store, body, signature, secret);

  assert.equal(handoff?.state, "ready_for_delivery");
  assert.equal(store.handoffs.get("order-1042")?.state, "ready_for_delivery");
});

test("verification for another zone cannot release the order", () => {
  const store = new DomainHandoffStore();
  store.addHandoff({
    orderId: "order-1042",
    assetId: "course-42",
    buyerId: "buyer-8",
    domain: "learn.customer.example",
    zoneId: "zone-9",
    state: "awaiting_verification",
  });
  const secret = "test-secret";
  const body = Buffer.from(JSON.stringify({
    event: "dns.domain.verified",
    data: { domain: "learn.customer.example", zone_id: "zone-other" },
  }));
  const signature = createHmac("sha256", secret).update(body).digest("hex");

  assert.equal(acceptVerifiedWebhook(store, body, signature, secret), undefined);
  assert.equal(store.handoffs.get("order-1042")?.state, "awaiting_verification");
});
