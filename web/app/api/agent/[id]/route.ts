import { json } from "@/lib/api";
import { getAgent } from "@/lib/indexer";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^\d{1,12}$/.test(id)) return json({ ok: false, error: "invalid agent id" }, 400);
  return json(await getAgent(Number(id)));
}
