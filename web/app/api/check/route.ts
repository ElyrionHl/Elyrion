import { isAddress } from "viem";
import { json } from "@/lib/api";
import { checkView, getAgent, getAgentsByOwner } from "@/lib/indexer";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const agent = q.get("agent");
  const address = q.get("address");

  if (agent !== null) {
    if (!/^\d{1,12}$/.test(agent)) return json({ ok: false, error: "invalid agent id" }, 400);
    const { item, ...fresh } = await getAgent(Number(agent));
    return json({ ...fresh, agents: item ? [checkView(item)] : [] });
  }
  if (address !== null) {
    if (!isAddress(address)) return json({ ok: false, error: "invalid address" }, 400);
    const { items, ...fresh } = await getAgentsByOwner(address);
    return json({ ...fresh, agents: items.map(checkView) });
  }
  return json({ ok: false, error: "provide ?agent=<id> or ?address=<0x>" }, 400);
}
