import { isAddress } from "viem";
import { json } from "@/lib/api";
import { getAgent, getAgentsByOwner, type AgentRow } from "@/lib/indexer";

export const dynamic = "force-dynamic";

const view = (a: AgentRow) => ({
  id: a.id,
  score: a.score,
  repaidCount: a.repaidCount,
  qualifiedRepaid: a.qualifiedRepaid,
  defaulted: a.defaulted,
  lineAmount: a.lineAmount,
});

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const agent = q.get("agent");
  const address = q.get("address");

  if (agent !== null) {
    if (!/^\d{1,12}$/.test(agent)) return json({ ok: false, error: "invalid agent id" }, 400);
    const r = await getAgent(Number(agent));
    return json({ ok: r.ok, agents: r.item ? [view(r.item)] : [] });
  }
  if (address !== null) {
    if (!isAddress(address)) return json({ ok: false, error: "invalid address" }, 400);
    const r = await getAgentsByOwner(address);
    return json({ ok: r.ok, agents: r.items.map(view) });
  }
  return json({ ok: false, error: "provide ?agent=<id> or ?address=<0x>" }, 400);
}
