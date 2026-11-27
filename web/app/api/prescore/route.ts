import { getPreScore, type PreScoreResult } from "../../../lib/prescore/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT = 20;
const WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

/** Best-effort per-IP limiter (in-memory, per instance). */
function limited(ip: string, now: number): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
  return false;
}

function reply(body: PreScoreResult, status: number, cache: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });
}

export async function GET(req: Request): Promise<Response> {
  const raw = new URL(req.url).searchParams.get("address") ?? "";
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  if (limited(ip, Date.now())) return reply({ ok: false, address: "", reason: "rate-limited" }, 429, "no-store");

  const result = await getPreScore(raw);
  if (result.ok) return reply(result, 200, "public, s-maxage=300, stale-while-revalidate=600");
  if (result.reason === "invalid") return reply(result, 400, "no-store");
  return reply(result, 502, "public, s-maxage=30");
}
