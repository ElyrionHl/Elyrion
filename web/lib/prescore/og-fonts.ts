// Instrument Serif + JetBrains Mono TTFs for the OG image, fetched from Google Fonts at request time and kept
// in memory per instance. Any failure resolves to null: the card then renders in Satori's bundled sans.

export type OgFont = { name: string; data: ArrayBuffer; weight: 400 | 500; style: "normal" | "italic" };

const CSS_URL =
  "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&display=swap";
const TIMEOUT_MS = 4000;

let cached: Promise<OgFont[] | null> | null = null;

/** Parses Google Fonts css2 output into (family, style, weight, url) faces. Pure. */
export function parseFontCss(css: string): { name: string; style: "normal" | "italic"; weight: 400 | 500; url: string }[] {
  const out: { name: string; style: "normal" | "italic"; weight: 400 | 500; url: string }[] = [];
  for (const block of css.match(/@font-face\s*{[^}]*}/g) ?? []) {
    const name = /font-family:\s*'([^']+)'/.exec(block)?.[1];
    const style = /font-style:\s*(\w+)/.exec(block)?.[1] === "italic" ? "italic" : "normal";
    const weight = /font-weight:\s*500/.test(block) ? 500 : 400;
    const url = /src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\)/.exec(block)?.[1];
    if (name && url) out.push({ name, style, weight, url });
  }
  return out;
}

export type OgFontDeps = { fetch?: typeof fetch; now?: () => number };

/** After a failed load, skip fetching for this long so a Google Fonts outage costs nothing per request. */
export const FONT_RETRY_MS = 60_000;

async function load(f: typeof fetch): Promise<OgFont[] | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    // A plain user agent makes Google serve TrueType, which Satori can read (it cannot read woff2).
    const css = await f(CSS_URL, { signal: ctl.signal, headers: { "user-agent": "node" } }).then((r) =>
      r.ok ? r.text() : Promise.reject(new Error(`fonts css ${r.status}`)),
    );
    const faces = parseFontCss(css);
    if (faces.length < 3) return null;
    return await Promise.all(
      faces.map(async (face) => {
        const res = await f(face.url, { signal: ctl.signal });
        if (!res.ok) throw new Error(`font ${res.status}`);
        return { name: face.name, style: face.style, weight: face.weight, data: await res.arrayBuffer() };
      }),
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

let failedAt: number | null = null;

/** Brand fonts, loaded once per instance. A failure is remembered for FONT_RETRY_MS (returns null at once). */
export function getOgFonts(deps: OgFontDeps = {}): Promise<OgFont[] | null> {
  const now = deps.now ?? Date.now;
  if (!cached && failedAt !== null && now() - failedAt < FONT_RETRY_MS) return Promise.resolve(null);
  if (!cached) {
    cached = load(deps.fetch ?? fetch).then((fonts) => {
      if (fonts) failedAt = null;
      else {
        failedAt = now();
        cached = null;
      }
      return fonts;
    });
  }
  return cached;
}

/** Test hook: forget loaded fonts and any remembered failure. */
export function resetOgFonts() {
  cached = null;
  failedAt = null;
}
