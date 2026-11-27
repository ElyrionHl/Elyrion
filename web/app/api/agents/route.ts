import { json } from "@/lib/api";
import { getAgents, publicAgent } from "@/lib/indexer";

export const dynamic = "force-dynamic";

export async function GET() {
  const { items, ...fresh } = await getAgents();
  return json({ ...fresh, items: items.map(publicAgent) });
}
