/** JSON response with CORS and bigint-as-decimal-string serialisation. */
export function json(body: unknown, status = 200): Response {
  return new Response(
    JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
      },
    },
  );
}
