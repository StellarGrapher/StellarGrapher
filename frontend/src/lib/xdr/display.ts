import { xdr, scValToNative } from "@stellar/stellar-sdk";

function toDisplaySafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (Array.isArray(value)) return value.map(toDisplaySafe);
  if (value instanceof Map) {
    return Object.fromEntries(
      Array.from(value.entries()).map(([k, v]) => [String(toDisplaySafe(k)), toDisplaySafe(v)])
    );
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toDisplaySafe(v)])
    );
  }
  return value;
}

/** Pairs of display-safe map entries, or an object when every key is a distinct string. */
function mapEntriesToDisplay(entries: [unknown, unknown][]): unknown {
  // scValToNative flattens map keys with String(), so a Vec key ["a","b"] and
  // the string "a,b" collide and Address/struct keys become "[object Object]".
  // Stringify non-string keys as JSON instead, and keep every entry as a
  // [key, value] pair if two keys still end up the same.
  const keys = entries.map(([k]) => (typeof k === "string" ? k : JSON.stringify(k)));
  if (new Set(keys).size !== keys.length) return entries;
  return Object.fromEntries(entries.map(([, v], i) => [keys[i], v]));
}

function scValToDisplaySafe(val: xdr.ScVal): unknown {
  const name = val.switch().name;
  if (name === "scvMap") {
    const map = val.map();
    if (map) {
      return mapEntriesToDisplay(
        map.map((e) => [scValToDisplaySafe(e.key()), scValToDisplaySafe(e.val())])
      );
    }
  }
  if (name === "scvVec") {
    const vec = val.vec();
    if (vec) return vec.map(scValToDisplaySafe);
  }
  return toDisplaySafe(scValToNative(val));
}

/** Decode an XDR ScVal into a JSON-safe native JS value (bigints/bytes normalized to strings). */
export function decodeScVal(val: xdr.ScVal): unknown {
  try {
    return scValToDisplaySafe(val);
  } catch {
    return undefined;
  }
}

/** Decode an XDR ScVal to a compact, human-readable string for display. */
export function scValToDisplay(val: xdr.ScVal): string {
  if (val.switch().name === "scvVoid") return "void";
  const decoded = decodeScVal(val);
  if (decoded === undefined) return "(unrepresentable value)";
  return typeof decoded === "string" ? decoded : JSON.stringify(decoded);
}

/** Decode a base64-encoded ScVal XDR string to a display string. Falls back to the raw base64 on failure. */
export function decodeXdr(xdrBase64: string): string {
  try {
    return scValToDisplay(xdr.ScVal.fromXDR(xdrBase64, "base64"));
  } catch {
    return xdrBase64;
  }
}

/** Decode a base64-encoded ScVal XDR string to a native JS value. */
export function decodeScValXdr(xdrBase64: string): unknown {
  try {
    return decodeScVal(xdr.ScVal.fromXDR(xdrBase64, "base64"));
  } catch {
    return undefined;
  }
}
