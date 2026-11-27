/**
 * ERC-8004-compatible registration file stored on-chain as a data URI. Mirrors
 * web/lib/agent-uri.ts exactly so agents registered here look identical on the site.
 */

export const REGISTRATION_TYPE = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";
export const DATA_URI_PREFIX = "data:application/json;base64,";
export const NAME_MIN = 2;
export const NAME_MAX = 64;
export const DESCRIPTION_MAX = 280;

export interface RegistrationInput {
  name: string;
  description: string;
  endpoint: string;
}

/** Length in user-visible code points (an emoji counts once). */
const len = (s: string) => [...s].length;

export function isHttpsUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !!u.hostname;
  } catch {
    return false;
  }
}

export function normalizeRegistration(input: RegistrationInput): RegistrationInput {
  return {
    name: input.name.trim(),
    description: input.description.trim(),
    endpoint: input.endpoint.trim(),
  };
}

/** Human-readable problems; empty array when valid. */
export function validateRegistration(input: RegistrationInput): string[] {
  const v = normalizeRegistration(input);
  const errors: string[] = [];
  const n = len(v.name);
  if (n < NAME_MIN || n > NAME_MAX) errors.push(`name must be ${NAME_MIN}-${NAME_MAX} characters`);
  if (len(v.description) > DESCRIPTION_MAX)
    errors.push(`description must be at most ${DESCRIPTION_MAX} characters`);
  if (v.endpoint && !isHttpsUrl(v.endpoint))
    errors.push("endpoint must be an https:// URL, or empty");
  return errors;
}

/** Builds the agentURI passed to `ElyrionIdentity.register`. Call on validated input. */
export function buildAgentURI(input: RegistrationInput): string {
  const v = normalizeRegistration(input);
  const json = JSON.stringify({
    name: v.name,
    description: v.description,
    endpoint: v.endpoint,
    type: REGISTRATION_TYPE,
  });
  return DATA_URI_PREFIX + Buffer.from(json, "utf8").toString("base64");
}
