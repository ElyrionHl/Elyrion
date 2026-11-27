/**
 * ERC-8004-compatible agent registration file, stored on-chain as a data URI:
 * `data:application/json;base64,<base64 of UTF-8 JSON>`. Pure; runs in the
 * browser, on the server and in tests.
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

export interface AgentMeta {
  name?: string;
  description?: string;
  endpoint?: string;
}

export type RegistrationErrors = Partial<Record<keyof RegistrationInput, string>>;

/** Length in user-visible code points (an emoji counts once). */
const len = (s: string) => [...s].length;

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/** True for an absolute https:// URL. */
export function isHttpsUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !!u.hostname;
  } catch {
    return false;
  }
}

/** Trims every field. */
export function normalizeRegistration(input: RegistrationInput): RegistrationInput {
  return {
    name: input.name.trim(),
    description: input.description.trim(),
    endpoint: input.endpoint.trim(),
  };
}

/** Field errors for the register form; empty object when valid. Validates the normalized values. */
export function validateRegistration(input: RegistrationInput): RegistrationErrors {
  const v = normalizeRegistration(input);
  const errors: RegistrationErrors = {};
  const n = len(v.name);
  if (n < NAME_MIN || n > NAME_MAX) errors.name = `Name must be ${NAME_MIN}–${NAME_MAX} characters.`;
  if (len(v.description) > DESCRIPTION_MAX)
    errors.description = `Description must be at most ${DESCRIPTION_MAX} characters.`;
  if (v.endpoint && !isHttpsUrl(v.endpoint))
    errors.endpoint = "Endpoint must be an https:// URL, or leave it empty.";
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
  return DATA_URI_PREFIX + toBase64(json);
}

const clean = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\s+/g, " ").trim();
  if (!s) return undefined;
  const chars = [...s];
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : s;
};

/**
 * Reads name / description / endpoint from an on-chain agentURI. Only
 * `data:application/json` URIs (base64 or percent-encoded) are decoded; any
 * other URI, or malformed JSON, gives `{}`. Never throws. The endpoint is kept
 * only when it is an https:// URL, so it is safe to render as a link.
 */
export function parseAgentMeta(uri: string): AgentMeta {
  try {
    if (typeof uri !== "string" || !/^data:application\/json/i.test(uri)) return {};
    const comma = uri.indexOf(",");
    if (comma < 0) return {};
    const header = uri.slice(0, comma);
    const body = uri.slice(comma + 1);
    const text = /;base64$/i.test(header) ? fromBase64(body) : decodeURIComponent(body);
    const obj: unknown = JSON.parse(text);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    const o = obj as Record<string, unknown>;
    const endpoint = clean(o.endpoint, 2048);
    return {
      name: clean(o.name, NAME_MAX),
      description: clean(o.description, DESCRIPTION_MAX),
      endpoint: endpoint && isHttpsUrl(endpoint) ? endpoint : undefined,
    };
  } catch {
    return {};
  }
}

/** agentURIs longer than this are treated as having no metadata (never stored or parsed). */
export const MAX_URI_BYTES = 8 * 1024;

/** parseAgentMeta for an untrusted on-chain value; oversized or non-string URIs count as none. */
export function metaOf(uri: unknown): AgentMeta {
  if (typeof uri !== "string" || uri.length > MAX_URI_BYTES) return {};
  return parseAgentMeta(uri);
}

/** Display name: the registration file's name when readable, else "Agent #id". */
export function agentName(uri: string, id: number): string {
  return parseAgentMeta(uri).name ?? `Agent #${id}`;
}
