import type { Tier } from "./score";
import type { TraitId } from "./traits";

/*
 * Pre-Score profile copy. Selection lives in profile.ts.
 *
 * Rules for editing this file:
 * - Every sentence must be true for ANY data that selects it. Openers are picked by tier alone, so they speak about
 *   the reading, never about a specific metric they cannot see. Trait lines must hold at the trait's threshold
 *   (see the table at the top of traits.ts).
 * - Numbers only through slots: {firstBlock} {ageDays} {txCount} {activeDays} {tokens} {contracts} {tier}.
 *   A template with a numeric slot is only chosen when that value is at least 2 ({firstBlock}: when known), so
 *   plurals stay correct. Every pool keeps slot-free templates as a fallback.
 * - Counts come from a capped window (latest 1,000 txs), so {txCount} is described as "counted"; it may show "1,000+".
 * - {contracts} counts distinct `to` addresses (wallets included): say "addresses" or "destinations", never "contracts".
 * - The first tx may be incoming, so age is "first seen" / "first entry", not "first step taken".
 * - Openers carry no time or arrival framing ("early", "arrived", "far behind", "knows it well"): any tier opener can
 *   sit next to a Newcomer or a Veteran line. profile.test.ts enforces this with TIME_WORDS.
 * - Calm, precise, a little mythic. No hype, no price or financial language, no judgement of the wallet.
 * - Closers never imply the Pre-Score affects a credit score.
 */

export const TRAIT_LABELS: Record<TraitId, string> = {
  "early-arrival": "Early Arrival",
  veteran: "Veteran",
  newcomer: "Newcomer",
  relentless: "Relentless",
  steady: "Steady",
  burst: "Burst",
  explorer: "Explorer",
  collector: "Collector",
  focused: "Focused",
  "stable-native": "Stable-native",
  quiet: "Quiet",
  "wide-reach": "Wide Reach",
  loyal: "Loyal",
};

/** Used instead of a tier opener when the address has no history at all (spec §4). */
export const NO_HISTORY_OPENER = "No footsteps on Elysium yet.";

/** Second sentence for an address with no history. */
export const EMPTY_LINES: string[] = [
  "The gate is open, and the first step is still to come.",
  "The ledger holds no entries for this address so far.",
  "Nothing to read yet, and nothing to weigh.",
  "The fields are open; the first mark is still to be made.",
  "Every path in Elysium begins with a single transaction.",
  "The record is blank, which is where every record starts.",
];

export const OPENERS: Record<Tier, string[]> = {
  Wanderer: [
    "A Wanderer at the edge of Elysium. The record is light, and the path is open.",
    "A Wanderer's reading: a light record, with room for a great deal more.",
    "This reading sits at the threshold of the scale.",
    "A Wanderer. Every name in Elysium has stood here once.",
    "The ledger holds a little of this address. The reading is light.",
    "A faint line on the ledger, and room for a great deal more.",
    "Wanderer: the trail is faint, and the path is wide open.",
    "The constellation here has a star or two, and a dark sky around them.",
    "A Wanderer's path, lightly marked and open in every direction.",
    "Wanderer. The scale has room above, and the gate stands open.",
    "First seen at block {firstBlock}. The rest of the path is unwritten.",
    "The record spans {ageDays} days. Its fuller story is unwritten.",
  ],
  Initiate: [
    "An Initiate. The rites are done, and the path has a form.",
    "Past the threshold. The record has shape, if not depth.",
    "Initiate: the ledger remembers this address.",
    "One chapter is written. An Initiate's record, clear and unfinished.",
    "Known at the gate. The footsteps of an Initiate lead inward.",
    "An Initiate of Elysium. The outline of a reputation is visible.",
    "An Initiate. The ledger holds enough to read, and room for more.",
    "Initiate. A few stars of the constellation are lit.",
    "First seen at block {firstBlock}, this address walks as an Initiate.",
    "{activeDays} active days on record, enough for an Initiate's reading.",
    "Across {ageDays} days, the record has grown into an Initiate's.",
  ],
  Worthy: [
    "Worthy. The ledger has weighed this address and found substance.",
    "A Worthy record: enough footsteps to show a pattern.",
    "Worthy of the name. The path through Elysium is clear on the ledger.",
    "Midway up the ascent, and on firm ground.",
    "The record carries weight now. Worthy, by the measure of the ledger.",
    "Worthy. The constellation has taken a shape you can trace.",
    "Worthy: past the gate, on the road toward the Elysian fields.",
    "A Worthy presence. The ledger has a good deal to say about it.",
    "{txCount} counted transactions, and a record that reads as Worthy.",
    "Since block {firstBlock}, this address has earned a Worthy reading.",
    "{activeDays} active days have shaped a Worthy record.",
  ],
  Hero: [
    "A Hero's record. The ledger tells its story in a clear hand.",
    "Hero. The footsteps on this path are unmistakable.",
    "The ledger names this address a Hero, and the record supports it.",
    "High on the ascent. A Hero's footsteps, plain to see.",
    "Hero. The constellation is bright enough to navigate by.",
    "A Hero of Elysium, within sight of the Elysian fields.",
    "Heroes are known by their record. This one is well kept.",
    "Hero: a reading earned entry by entry, in full view of the ledger.",
    "Since block {firstBlock}, a Hero's path through the Elysian fields.",
    "{txCount} counted transactions. The record of a Hero, written in plain sight.",
    "Across {ageDays} days, the ledger has drawn the outline of a Hero.",
    "{activeDays} active days, and a reading that places this address among Heroes.",
  ],
  Immortal: [
    "Immortal. The ledger holds this name in full.",
    "An Immortal reading. The record leaves little to add.",
    "The highest reading the Pre-Score gives. This path is written plainly on the ledger.",
    "Immortal: the summit of the ascent, reached on the strength of the record.",
    "Among the Immortals. The footsteps here are plain to read.",
    "Immortal. The Elysian fields are home ground for this address.",
    "Immortal: the ledger's highest mark, earned in full view.",
    "Immortal. Few words are needed; the record speaks for itself.",
    "Since block {firstBlock}, a record that reaches the top of the scale.",
    "{txCount} counted transactions, and a reading at the summit: Immortal.",
    "Across {ageDays} days, this address has risen as high as the Pre-Score reaches.",
    "{activeDays} active days carry this address to the summit of the Pre-Score.",
  ],
};

export const TRAIT_LINES: Record<TraitId, string[]> = {
  // first tx within 3 days (either side) of mainnet launch
  "early-arrival": [
    "It appeared within three days of the mainnet launch.",
    "Present at the dawn: its record begins within days of the gates opening.",
    "An early arrival, it stood at the gate as Elysium opened.",
    "Its story begins around the first light of mainnet.",
    "It answered the dawn, first seen within three days of mainnet launch.",
    "Its first entry, at block {firstBlock}, came within days of mainnet launch.",
  ],
  // ageDays >= 21
  veteran: [
    "Three weeks or more on the ledger: a veteran's standing.",
    "Its roots in the ledger run three weeks deep, or deeper.",
    "Time is on its side, with more than twenty days since its first entry.",
    "Its record reaches back {ageDays} days.",
    "Seasoned by time, it was first seen {ageDays} days ago.",
    "A veteran presence, here since block {firstBlock}.",
  ],
  // ageDays < 3 (lines are skipped for an address with no history)
  newcomer: [
    "Newly arrived: its first entry is less than three days old.",
    "The ink is still wet. This record began within the last three days.",
    "Less than three days old, a newcomer at the gate.",
    "New to Elysium, and already on the record.",
    "Everything here is recent; the record began in the last three days.",
    "A fresh name on the ledger, first seen at block {firstBlock}.",
  ],
  // txCount >= 300
  relentless: [
    "The ledger has heard from it at least three hundred times.",
    "Three hundred transactions and more, each one on the ledger.",
    "A tireless hand, with three hundred or more transactions to its name.",
    "Relentless. {txCount} counted transactions bear its signature.",
    "Its counted record runs to {txCount} transactions.",
    "{txCount} counted transactions sent, a long line of entries on the ledger.",
  ],
  // activeDays >= 7 and >= half of the days since first seen
  steady: [
    "Steady: active on at least half the days since it first appeared.",
    "Present on at least one day in two since its first entry.",
    "Consistency is its strength, with activity on half its days or more.",
    "It shows up. Seven active days or more, spread across its time here.",
    "It keeps a rhythm, returning on {activeDays} separate days.",
    "A measured cadence across {activeDays} active days.",
  ],
  // txCount >= 10 and >= 80% of counted txs on the 2 busiest days
  burst: [
    "Its activity gathers in bursts, most of it on one or two days.",
    "At least four in five of its transactions fell on its two busiest days.",
    "Concentrated rather than scattered: most of its activity sits on one or two days.",
    "Its activity gathers on a few days, with most of it on the busiest two.",
    "Comet-like, its record shines brightest on one or two days.",
    "A burst on the ledger: {txCount} counted transactions, most within one or two days.",
  ],
  // distinctContracts (distinct `to` addresses) >= 10
  explorer: [
    "Its footsteps lead in many directions, to at least ten distinct addresses.",
    "Curious by nature, it has found its way to ten or more corners of Elysium.",
    "No single road holds it. Its transactions reach ten addresses or more.",
    "An explorer: its transactions reach {contracts} different addresses.",
    "It ranges wide across Elysium, with {contracts} distinct destinations.",
    "A map-maker's record: {contracts} distinct corners of Elysium visited.",
  ],
  // distinctTokens >= 8
  collector: [
    "Eight tokens or more have moved through this address.",
    "Many tokens have crossed its path, eight distinct kinds or more.",
    "A collector's ledger, with at least eight different tokens in its transfers.",
    "A collector: {tokens} distinct tokens appear in its transfers.",
    "Its token record is varied, with {tokens} different tokens.",
    "{tokens} kinds of token have moved to or from this address.",
  ],
  // distinctContracts <= 2 and txCount >= 20
  focused: [
    "Focused: many transactions, no more than two destinations.",
    "Single-minded, its transactions go to two destinations at most.",
    "Depth over breadth: twenty transactions or more, all on a narrow path.",
    "It knows where it is going. At least twenty transactions, at most two destinations.",
    "It keeps to a narrow path: {txCount} counted transactions, at most two destinations.",
    "A devoted path, walked {txCount} times.",
  ],
  // USDC in >= 5 fetched token transfers
  "stable-native": [
    "USDC appears in at least five of its token transfers.",
    "USDC is among the tokens it has moved, in five transfers or more.",
    "Five or more of its token transfers carry USDC.",
    "USDC has moved to or from this address at least five times.",
    "Stable-native: USDC is part of its record, in at least five transfers.",
    "Its token transfers include USDC, five times or more.",
  ],
  // txCount < 5 (may be 0 when only incoming activity exists)
  quiet: [
    "Quiet so far, with fewer than five of its own transactions landed.",
    "It speaks rarely. Fewer than five successful transactions carry its signature.",
    "More presence than motion: fewer than five counted transactions.",
    "The quiet kind, with fewer than five landed transactions.",
    "Its voice on the ledger is soft so far, under five counted transactions.",
  ],
  // distinctTokens + distinctContracts >= 16
  "wide-reach": [
    "Its reach spans sixteen or more distinct tokens and destinations combined.",
    "A broad footprint across Elysium: sixteen tokens and destinations or more.",
    "It reaches far. Tokens and destinations together number sixteen or more.",
    "Breadth is its mark, with at least sixteen distinct tokens and destinations.",
    "Wide reach: {tokens} tokens and {contracts} destinations in its record.",
    "Its constellation is wide, drawn across {tokens} tokens and {contracts} addresses.",
  ],
  // activeDays >= 14
  loyal: [
    "It has come back again and again, on fourteen active days or more.",
    "Its loyalty is written in days, at least fourteen of them active.",
    "Two weeks' worth of active days, or more.",
    "Loyal: it has returned on {activeDays} separate days.",
    "Faithful to Elysium, active on {activeDays} different days.",
    "A familiar presence: the ledger has seen it on {activeDays} days.",
  ],
};

/** Final sentence. Points toward a real credit score without pressure; never implies the Pre-Score affects it. */
export const CLOSERS: string[] = [
  "A Pre-Score reads activity. A credit score is earned by a registered agent.",
  "When you are ready, register an agent to begin a real credit score on Elyrion.",
  "The credit score is a separate path, and it begins with a registered agent.",
  "Pre-Score reads footsteps. Elyrion's credit score reads promises kept.",
  "The {tier} tier measures activity alone. A credit score is a separate path.",
  "This reading moves as the path does. A credit score begins with a registered agent.",
  "Nothing here touches a credit score. Register an agent when you want one of your own.",
  "An agent registered on Elyrion earns a credit score of its own, built from what it does.",
  "A Pre-Score is a mirror, not a verdict. Credit is earned by registered agents.",
  "The registry is open whenever an agent is ready to take its oath.",
  "The credit score is a separate record, earned by registered agents.",
  "Elyrion keeps its credit score apart from this reading. It belongs to registered agents.",
  "The Pre-Score reads activity only. The credit score belongs to agents registered on Elyrion.",
  "This reading stands on its own. A credit score is earned separately, by a registered agent.",
  "To be scored for credit, an agent must first be registered. The gate is open.",
];
