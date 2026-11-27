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
  "Nothing to read yet, and nothing held against it.",
  "The fields are open; the first mark is still to be made.",
  "Every path in Elysium begins with a single transaction.",
  "The record is blank, which is where every record starts.",
];

export const OPENERS: Record<Tier, string[]> = {
  Wanderer: [
    "A Wanderer at the edge of Elysium. The record is light, and the path is open.",
    "The first marks are on the ledger. The shape of this path is still forming.",
    "This address stands at the threshold, not yet far inside.",
    "A Wanderer for now. Every name in Elysium began as one.",
    "The ledger knows this address, though not yet well.",
    "The trail is still being drawn, one entry at a time.",
    "Wanderer: a reading taken early, before the path has found its shape.",
    "Elysium has seen this address arrive. What it builds here is still to come.",
    "The gate has opened for this address. The longer walk is still ahead.",
    "A faint line on the ledger, and room for a great deal more.",
    "First seen at block {firstBlock}. The rest of the path is unwritten.",
    "The record spans {ageDays} days so far. Its fuller story is still unwritten.",
  ],
  Initiate: [
    "An Initiate. The first rites are done, and the path is taking form.",
    "Past the threshold now. The record has shape, if not yet depth.",
    "Initiate: the ledger has started to remember this address.",
    "The first chapter is written. An Initiate's record, clear and unfinished.",
    "Known at the gate. The footsteps of an Initiate lead inward.",
    "An Initiate of Elysium. The outline of a reputation is visible.",
    "An Initiate. The ledger holds enough to read, and room for more.",
    "Initiate. The constellation has its first few stars.",
    "First seen at block {firstBlock}, this address now walks as an Initiate.",
    "{activeDays} active days on record. An Initiate, finding its pace.",
    "Across {ageDays} days, the record has grown into an Initiate's.",
  ],
  Worthy: [
    "Worthy. The ledger has weighed this address and found substance.",
    "A Worthy record: enough footsteps to show a pattern.",
    "Worthy of the name. The path through Elysium is clear on the ledger.",
    "Midway up the ascent, and on firm ground.",
    "The record carries weight now. Worthy, by the measure of the ledger.",
    "Worthy. The constellation has taken a shape you can trace.",
    "Worthy: past the gate, with the fields opening ahead.",
    "A Worthy presence. The ledger has a good deal to say about it.",
    "{txCount} counted transactions, and a record that reads as Worthy.",
    "Since block {firstBlock}, this address has earned a Worthy reading.",
    "{activeDays} active days have shaped a Worthy record.",
  ],
  Hero: [
    "A Hero's record. The ledger tells its story in a clear hand.",
    "Hero. The footsteps on this path are deep and unmistakable.",
    "The ledger names this address a Hero, and the record supports it.",
    "High on the ascent. A Hero's footsteps, plain to see.",
    "Hero. The constellation is bright enough to navigate by.",
    "A Hero of Elysium. The gate is far behind; the fields are close.",
    "Heroes are known by their record. This one is well kept.",
    "Hero: a reading earned entry by entry, in full view of the ledger.",
    "Since block {firstBlock}, a Hero's path through the Elysian fields.",
    "{txCount} counted transactions. The record of a Hero, written in plain sight.",
    "Across {ageDays} days, the ledger has drawn the outline of a Hero.",
    "{activeDays} active days, and a reading that places this address among Heroes.",
  ],
  Immortal: [
    "Immortal. The ledger holds this name in full.",
    "An Immortal record. Elysium knows this address well.",
    "The highest reading the Pre-Score gives. This path is written deep into the ledger.",
    "Immortal: the summit of the ascent, reached on the strength of the record.",
    "Among the Immortals. The footsteps here are deep and plain to read.",
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
    "Volume is its signature: {txCount} counted transactions sent.",
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
    "When it moves, it moves at once. Its two busiest days hold most of its record.",
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
    "USDC appears in at least five of its transfers.",
    "At home with USDC, which appears in five or more of its transfers.",
    "Its ledger speaks in USDC; five transfers or more carry it.",
    "Fluent in USDC, a regular presence in its token transfers.",
    "USDC runs through its record like a familiar current.",
    "A stable-native address: USDC is part of how it moves.",
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
  "Only the worthy enter Elysium. On Elyrion, worth is earned by agents, one kept promise at a time.",
  "The {tier} tier measures activity alone. A credit score is a separate path.",
  "This reading moves as the path does. A credit score begins with a registered agent.",
  "Nothing here touches a credit score. Register an agent when you want one of your own.",
  "An agent registered on Elyrion earns a credit score of its own, built from what it does.",
  "A Pre-Score is a mirror, not a verdict. Credit is earned by registered agents.",
  "The registry is open whenever an agent is ready to take its oath.",
  "Activity is the first chapter. Registered agents write the rest into a credit record.",
  "From here the path leads to the registry, where agents earn a real credit score.",
  "Pre-Score is a first reading. The credit score belongs to agents registered on Elyrion.",
  "Take this reading as a starting point. A real credit score starts with a registered agent.",
  "To be scored for credit, an agent must first be registered. The gate is open.",
];
