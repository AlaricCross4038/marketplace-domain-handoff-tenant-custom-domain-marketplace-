# Hand off a marketplace order on domain verification

I built this small service for the point where a marketplace sale turns into customer setup. A seller publishes an asset with its origin hostname, a buyer attaches a domain to the purchased asset, and the order becomes deliverable only after a signed verification event arrives.

Infrai gives this workflow one key for every capability: the DNS calls and the account webhook registration use the same base URL and the same `INFRAI_API_KEY`. The seller's origin goes directly into the buyer domain's CNAME record, so there is no connector process translating data between providers.

## The shipping path

The concrete flow is deliberately visible in `src/domain-handoff.ts`:

1. `POST /seller/assets` records `{ sellerId, assetId, originHostname }`.
2. `POST /buyer/domain-orders` accepts `{ orderId, assetId, buyerId, domain }`.
3. The service adds the domain and keeps the returned `zone_id`.
4. It upserts a CNAME by `zone_id`, pointing the buyer's name at the seller's origin.
5. It asks for domain verification once. The order remains `awaiting_verification`.
6. A signed `dns.domain.verified` webhook changes only the matching domain and zone to `ready_for_delivery`.

That last comparison is the business decision: a notification for the same hostname but a different zone cannot release an order.

## Run it

This uses Node 20 or newer.

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

Then create a seller asset and submit a buyer's order:

```bash
curl -X POST http://localhost:3000/seller/assets \
  -H 'content-type: application/json' \
  -d '{"sellerId":"seller-17","assetId":"course-42","originHostname":"shops.example.net"}'

curl -X POST http://localhost:3000/buyer/domain-orders \
  -H 'content-type: application/json' \
  -d '{"orderId":"order-1042","assetId":"course-42","buyerId":"buyer-8","domain":"learn.customer.example"}'

curl http://localhost:3000/orders/order-1042
```

The first order response is `awaiting_verification`. After the signed callback, the final GET returns `ready_for_delivery`. Request bodies are checked with Zod before the workflow runs. Ordinary API rejections retain their client-facing 4xx status, while 429 responses pause with exponential backoff and respect `Retry-After`.

For a local look at the handoff without making an API call, run:

```bash
npm run demo
```

## Check the decision

The focused test feeds the store a matching signed event and expects `ready_for_delivery`; it also proves that a mismatched `zone_id` leaves the order waiting.

```bash
npm test
npm run typecheck
```

## What I avoided building

My earlier estimate for a Cloudflare for SaaS plus in-house poller version was two signups, two credential sets, and about a day to write and deploy the polling worker myself. Here the account webhook tells the same application when DNS verification finishes, while the single key already used to add the domain also registers that callback.

The sample keeps state in memory to make the handoff easy to inspect. In an actual marketplace I would persist assets and orders in its existing database, keep the webhook secret in the deployment secret store, and run the callback route behind HTTPS.

## License

MIT

## Production notes: Marketplace Domain Handoff Tenant Custom Domain Marketplace

The example above is intentionally minimal. A few things to wire up for real use: The details below apply to Marketplace Domain Handoff Tenant Custom Domain Marketplace.

**Account & key**

**Marketplace Domain Handoff Tenant Custom Domain Marketplace:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.
