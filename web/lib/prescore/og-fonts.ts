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

async function load(): Promise<OgFont[] | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    // A plain user agent makes Google serve TrueType, which Satori can read (it cannot read woff2).
    const css = await fetch(CSS_URL, { signal: ctl.signal, headers: { "user-agent": "node" } }).then((r) =>
      r.ok ? r.text() : Promise.reject(new Error(`fonts css ${r.status}`)),
    );
    const faces = parseFontCss(css);
    if (faces.length < 3) return null;
    return await Promise.all(
      faces.map(async (f) => {
        const res = await fetch(f.url, { signal: ctl.signal });
        if (!res.ok) throw new Error(`font ${res.status}`);
        return { name: f.name, style: f.style, weight: f.weight, data: await res.arrayBuffer() };
      }),
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function getOgFonts(): Promise<OgFont[] | null> {
  if (!cached) {
    cached = load().then((fonts) => {
      if (!fonts) cached = null; // retry on a later request
      return fonts;
    });
  }
  return cached;
}
