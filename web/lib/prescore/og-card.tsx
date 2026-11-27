// Satori JSX for the 1200×630 Pre-Score card (OG image + "Download PNG"). Inline styles only;
// every element with more than one child is display:flex. Colours mirror the tokens in app/globals.css.
import type { CardModel } from "./card";

export const OG_SIZE = { width: 1200, height: 630 } as const;

const C = {
  obsidian: "#0b0a08",
  glow: "#1a160f",
  gold: "#e2c58b",
  gold2: "#b8925a",
  goldDeep: "#8a6a3c",
  marble: "#f4efe6",
  mute: "rgba(244, 239, 230, 0.55)",
  line: "rgba(231, 206, 150, 0.14)",
};

/** Font family names registered with ImageResponse; without them Satori uses its bundled sans. */
export type OgFonts = { serif: string; mono: string };
const FALLBACK: OgFonts = { serif: "sans-serif", mono: "sans-serif" };

function Gate({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" stroke={C.gold} strokeWidth={4} strokeLinecap="round">
      <path d="M22 92 V44 A28 28 0 0 1 78 44 V92" />
      <path d="M34 92 V48 A16 16 0 0 1 50 32" />
      <path d="M66 92 V48 A16 16 0 0 0 50 32" />
      <line x1="12" y1="92" x2="88" y2="92" />
      <circle cx="50" cy="60" r="4.5" fill={C.gold} stroke="none" />
    </svg>
  );
}

/** Gold ring filled to total/1000, the same geometry as <ScoreRing>. */
function Ring({ total, size }: { total: number; size: number }) {
  const r = 46;
  const circ = 2 * Math.PI * r;
  const frac = Math.min(1, Math.max(0, total / 1000));
  const a = frac * 2 * Math.PI - Math.PI / 2;
  const hx = 60 + r * Math.cos(a);
  const hy = 60 + r * Math.sin(a);
  return (
    <svg width={size} height={size} viewBox="0 0 120 120">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={C.goldDeep} />
          <stop offset="55%" stopColor={C.gold2} />
          <stop offset="100%" stopColor={C.gold} />
        </linearGradient>
      </defs>
      {Array.from({ length: 10 }, (_, i) => {
        const t = (i / 10) * 2 * Math.PI - Math.PI / 2;
        return (
          <line
            key={i}
            x1={60 + 53 * Math.cos(t)}
            y1={60 + 53 * Math.sin(t)}
            x2={60 + 55.5 * Math.cos(t)}
            y2={60 + 55.5 * Math.sin(t)}
            stroke={C.line}
            strokeWidth={0.6}
          />
        );
      })}
      <circle cx="60" cy="60" r={r} fill="none" stroke={C.line} strokeWidth={2.4} />
      {frac > 0 ? (
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="url(#g)"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeDasharray={`${frac * circ} ${circ}`}
          transform="rotate(-90 60 60)"
        />
      ) : null}
      {frac > 0 ? <circle cx={hx} cy={hy} r={4.2} fill={C.gold} fillOpacity={0.14} /> : null}
      {frac > 0 ? <circle cx={hx} cy={hy} r={1.9} fill={C.gold} /> : null}
    </svg>
  );
}

export function OgCard({ model, host, fonts = FALLBACK }: { model: CardModel; host: string; fonts?: OgFonts }) {
  const mono = { fontFamily: fonts.mono };
  const serif = { fontFamily: fonts.serif };
  const scored = model.variant === "score";

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "56px 64px 48px",
        color: C.marble,
        backgroundColor: C.obsidian,
        backgroundImage: `radial-gradient(70% 90% at 78% 42%, ${C.glow} 0%, ${C.obsidian} 62%)`,
        ...mono,
      }}
    >
      {/* Brand row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Gate size={44} />
          <span style={{ ...serif, fontSize: 28, letterSpacing: "0.34em", color: C.marble }}>ELYRION</span>
        </div>
        <span style={{ fontSize: 15, letterSpacing: "0.22em", color: C.gold }}>PRE-SCORE · ELYSIUM</span>
      </div>

      {scored ? (
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "space-between", gap: 48 }}>
          <div style={{ display: "flex", flexDirection: "column", maxWidth: 640 }}>
            <span style={{ fontSize: 22, letterSpacing: "0.04em", color: C.mute }}>{model.shortAddress}</span>
            <span style={{ ...serif, fontStyle: "italic", fontSize: 148, lineHeight: 1, letterSpacing: "-0.02em", color: C.gold, marginTop: 18 }}>
              {model.tier}
            </span>
            {model.traits.length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 34 }}>
                {model.traits.map((t) => (
                  <span
                    key={t}
                    style={{
                      display: "flex",
                      border: "1px solid rgba(226, 197, 139, 0.38)",
                      borderRadius: 999,
                      padding: "9px 18px",
                      fontSize: 15,
                      letterSpacing: "0.16em",
                      textTransform: "uppercase",
                      color: "rgba(244, 239, 230, 0.85)",
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div style={{ display: "flex", position: "relative", width: 330, height: 330, alignItems: "center", justifyContent: "center" }}>
            <div style={{ display: "flex", position: "absolute", left: 0, top: 0 }}>
              <Ring total={model.total} size={330} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <span style={{ fontSize: 104, lineHeight: 1, letterSpacing: "-0.04em", color: C.marble }}>{model.total}</span>
              <span style={{ fontSize: 14, letterSpacing: "0.2em", color: C.gold, marginTop: 14 }}>/ 1000</span>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", ...serif, fontSize: 96, lineHeight: 1.02, letterSpacing: "-0.02em" }}>
            <div style={{ display: "flex" }}>
              <span>Check your</span>
              <span style={{ fontStyle: "italic", color: C.gold, marginLeft: 20 }}>Elysium</span>
            </div>
            <span>Pre-Score</span>
          </div>
          <span style={{ fontSize: 20, letterSpacing: "0.04em", color: C.mute, marginTop: 30 }}>
            {model.variant === "contract"
              ? `${model.shortAddress} is a contract · Pre-Score is for wallets`
              : "Any Elysium address · scored 0–1000 from public activity"}
          </span>
        </div>
      )}

      {/* Footer row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderTop: `1px solid ${C.line}`,
          paddingTop: 22,
          fontSize: 15,
          letterSpacing: "0.12em",
        }}
      >
        <span style={{ color: C.mute }}>{model.disclaimer}</span>
        {host ? <span style={{ color: C.gold }}>{host}</span> : null}
      </div>
    </div>
  );
}
