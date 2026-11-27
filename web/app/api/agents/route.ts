import { json } from "@/lib/api";
import { getAgents } from "@/lib/indexer";

export const dynamic = "force-dynamic";

export async function GET() {
  return json(await getAgents());
}
