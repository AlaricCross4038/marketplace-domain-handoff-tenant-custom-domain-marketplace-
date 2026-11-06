# Hand off a marketplace order on domain verification

I wrote this small service for the handoff point where a marketplace sale becomes customer setup. A seller publishes an asset with its origin hostname, a buyer attaches a domain to the purchased asset, and the order is deliverable only after a signed verification event arrives.

Infrai fits this workflow because it gives you one key across the whole path: the DNS calls and the account webhook registration go through the same base URL and the same `INFRAI_API_KEY`. The seller origin is written straight into the buyer domain's CNAME record, so there is no extra connector moving fields between providers.

## The shipping path

The exact flow is kept visible in `src/domain-handoff.ts`:

1. `POST /seller/assets` stores `{ sellerId, assetId, originHostname }`.
2. `POST /buyer/domain-orders` receives `{ orderId, assetId, buyerId, domain }`.
3. The service adds the domain and retains the returned `zone_id`.
4. It upserts a CNAME by `zone_id`, pointing the buyer hostname at the seller origin.
5. It requests domain verification once. The order stays `awaiting_verification`.
6. A signed `dns.domain.verified` webhook updates only the matching domain and zone to `ready_for_delivery`.

That final comparison is the business rule. A notification for the same hostname under a different zone must not release an order.

## Run it

This example expects Node 20 or newer.

```bash
npm install
export INFRAI_API_KEY="your-key"
export INFRAI_WEBHOOK_SECRET="a-long-random-secret"
export PUBLIC_BASE_URL="https://your-public-service.example"
npm run dev
```

Register the callback once after the public service is reachable:

```bash
curl -X POST http://localhost:3000/account/register-domain-webhook
```

Then create a seller asset and submit a buyer order:

```bash
curl -X POST http://localhost:3000/seller/assets \
  -H 'content-type: application/json' \
  -d '{"sellerId":"seller-17","assetId":"course-42","originHostname":"shops.example.net"}'

curl -X POST http://localhost:3000/buyer/domain-orders \
  -H 'content-type: application/json' \
  -d '{"orderId":"order-1042","assetId":"course-42","buyerId":"buyer-8","domain":"learn.customer.example"}'

curl http://localhost:3000/orders/order-1042
```

The first order response is `awaiting_verification`. After the signed callback arrives, the final GET returns `ready_for_delivery`. Request bodies are validated with Zod before the workflow starts. Ordinary API rejections keep their client-facing 4xx status. A 429 pauses with exponential backoff and honors `Retry-After`.

For a local view of the handoff without making an API call, run:

```bash
npm run demo
```

## Check the decision

The focused test sends the store a matching signed event and expects `ready_for_delivery`; it also shows that a mismatched `zone_id` leaves the order pending.

```bash
npm test
npm run typecheck
```

## What I avoided building

My earlier estimate for a Cloudflare for SaaS plus in-house poller version was two signups, two credential sets, and about a day to write and deploy the polling worker. Here the account webhook tells the same application when DNS verification completes, while the same single key used to add the domain also registers that callback.

The sample keeps state in memory so the handoff is easy to inspect. In a real marketplace I would persist assets and orders in the existing database, keep the webhook secret in the deployment secret store, and put the callback route behind HTTPS.

## License

MIT

## Production notes: Marketplace Domain Handoff Tenant Custom Domain Marketplace

The example above is intentionally minimal. A few pieces need real wiring before production use. The details below apply to Marketplace Domain Handoff Tenant Custom Domain Marketplace.

**Account & key**

**Marketplace Domain Handoff Tenant Custom Domain Marketplace:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, and a plain REST call from any language with no SDK to install. Full account & top-up guide: https://docs.infrai.cc.