// Helpers for unpacking KeeperHub Event Tracker serialized args

/**
 * Event Tracker serializes args as `{ value, type }` wrappers. Workflow
 * templates may also expand them to flat primitives. Accept both shapes.
 */
export function unwrapArg(arg: unknown): unknown {
  if (arg === null || arg === undefined) return arg;
  if (typeof arg === "object" && !Array.isArray(arg) && "value" in arg) {
    return (arg as { value: unknown }).value;
  }
  return arg;
}

export function argAsString(arg: unknown): string | undefined {
  const value = unwrapArg(arg);
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

export function argAsBigInt(arg: unknown): bigint | undefined {
  const value = unwrapArg(arg);
  if (value === null || value === undefined) return undefined;
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    try {
      return BigInt(value.trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

export function scaleTokenAmount(raw: bigint, decimals: number): number {
  const abs = absBigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = abs % base;
  // Keep ~8 decimal places of precision without floating bigint overflow for large values
  const fracStr = fraction.toString().padStart(decimals, "0").slice(0, 8);
  return Number(whole) + Number(`0.${fracStr}`);
}
