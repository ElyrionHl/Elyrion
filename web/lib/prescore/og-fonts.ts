// Brand fonts for the OG image. Instrument Serif (regular + italic) and JetBrains Mono (regular) are vendored as TTF
// under web/assets/fonts (SIL Open Font License 1.1; license texts next to them) and read from disk, so the card
// does not depend on Google Fonts at request time. Google Fonts remains only as a fallback if the files cannot be
// read. Any failure resolves to null: the card then renders in Satori's bundled sans.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type OgFont = { name: string; data: ArrayBuffer; weight: 400 | 500; style: "normal" | "italic" };

/** The faces the card uses (og-card.tsx sets no font weight, so 400 only). */
export const OG_FONT_FILES = [
  { file: "InstrumentSerif-Regular.ttf", name: "Instrument Serif", style: "normal", weight: 400 },
  { file: "InstrumentSerif-Italic.ttf", name: "Instrument Serif", style: "italic", weight: 400 },
  { file: "JetBrainsMono-Regular.ttf", name: "JetBrains Mono", style: "normal", weight: 400 },
] as const;

/*
 * Literal paths, one per file, so the build traces exactly these files into the server output (a computed path
 * would make Turbopack trace the whole project). Same order as OG_FONT_FILES.
 */
const VENDORED: (() => Promise<Buffer>)[] = [
  () => readFile(join(process.cwd(), "assets", "fonts", "InstrumentSerif-Regular.ttf")),
  () => readFile(join(process.cwd(), "assets", "fonts", "InstrumentSerif-Italic.ttf")),
  () => readFile(join(process.cwd(), "assets", "fonts", "JetBrainsMono-Regular.ttf")),
];

const CSS_URL = "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400&display=swap";
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

/** `readLocal` replaces reading the vendored files (test hook; index into OG_FONT_FILES). */
export type OgFontDeps = { fetch?: typeof fetch; now?: () => number; readLocal?: (index: number) => Promise<Buffer> };

/** After a failed load, skip loading for this long so an outage costs nothing per request. */
export const FONT_RETRY_MS = 60_000;

const toArrayBuffer = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** The vendored TTFs, or null if any cannot be read. */
async function loadLocal(read: (index: number) => Promise<Buffer>): Promise<OgFont[] | null> {
  try {
    return await Promise.all(
      OG_FONT_FILES.map(async (f, i) => ({ name: f.name, style: f.style, weight: f.weight, data: toArrayBuffer(await read(i)) })),
    );
  } catch {
    return null;
  }
}

/** Fallback: Google Fonts css2 (a plain user agent makes it serve TrueType, which Satori can read; not woff2). */
async function loadRemote(f: typeof fetch): Promise<OgFont[] | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
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
    cached = loadLocal(deps.readLocal ?? ((i) => VENDORED[i]()))
      .then((local) => local ?? loadRemote(deps.fetch ?? fetch))
      .then((fonts) => {
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
