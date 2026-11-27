import { json } from "@/lib/api";
import { getStats } from "@/lib/indexer";

export const dynamic = "force-dynamic";

export async function GET() {
  return json(await getStats());
}
