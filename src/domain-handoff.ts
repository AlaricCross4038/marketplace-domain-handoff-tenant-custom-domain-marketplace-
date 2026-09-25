import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { InfraiClient, infrai } from "./infrai-client.js";

export const sellerAssetSchema = z.object({
  sellerId: z.string().min(1),
  assetId: z.string().min(1),
  originHostname: z.string().min(1).regex(/^[a-z0-9.-]+$/i),
});

export const buyerDomainSchema = z.object({
  orderId: z.string().min(1),
  assetId: z.string().min(1),
  buyerId: z.string().min(1),
  domain: z.string().min(3).regex(/^[a-z0-9.-]+$/i),
});

const verifiedEventSchema = z.object({
  event: z.literal("dns.domain.verified"),
  data: z.object({ domain: z.string(), zone_id: z.string() }),
});

export type SellerAsset = z.infer<typeof sellerAssetSchema>;
export type BuyerDomain = z.infer<typeof buyerDomainSchema>;
export type Handoff = BuyerDomain & { zoneId: string; state: "awaiting_verification" | "ready_for_delivery" };

export class DomainHandoffStore {
  readonly assets = new Map<string, SellerAsset>();
  readonly handoffs = new Map<string, Handoff>();

  addAsset(asset: SellerAsset): SellerAsset {
    this.assets.set(asset.assetId, asset);
    return asset;
  }

  addHandoff(handoff: Handoff): Handoff {
    this.handoffs.set(handoff.orderId, handoff);
    return handoff;
  }

  markVerified(domain: string, zoneId: string): Handoff | undefined {
    const handoff = [...this.handoffs.values()].find((item) => item.domain === domain && item.zoneId === zoneId);
    if (!handoff) return undefined;
    handoff.state = "ready_for_delivery";
    return handoff;
  }
}

export async function startDomainHandoff(client: InfraiClient, store: DomainHandoffStore, input: BuyerDomain): Promise<Handoff> {
  const asset = store.assets.get(input.assetId);
  if (!asset) throw new Error("Seller asset does not exist");

  const added = await infrai.dns.domain.add(client, {
    domain: input.domain,
    account_id: input.buyerId,
    metadata: { order_id: input.orderId, asset_id: input.assetId },
  });
  await infrai.dns.record.upsert(client, {
    zone_id: added.zone_id,
    record_type: "CNAME",
    name: input.domain,
    content: asset.originHostname,
    ttl: 300,
    metadata: { order_id: input.orderId },
  });
  await infrai.dns.domain.verify(client, { domain: input.domain });

  return store.addHandoff({ ...input, zoneId: added.zone_id, state: "awaiting_verification" });
}

export function acceptVerifiedWebhook(store: DomainHandoffStore, rawBody: Buffer, signature: string, secret: string): Handoff | undefined {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const supplied = Buffer.from(signature, "hex");
  const wanted = Buffer.from(expected, "hex");
  if (supplied.length !== wanted.length || !timingSafeEqual(supplied, wanted)) throw new Error("Invalid webhook signature");
  const event = verifiedEventSchema.parse(JSON.parse(rawBody.toString("utf8")));
  return store.markVerified(event.data.domain, event.data.zone_id);
}
