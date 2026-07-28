/**
 * Structured log levels for hot paths (desk, x402, schedulers).
 * P2-10: sample/debug chatty ticks at info only when LOG_LEVEL=debug.
 *
 * Levels: debug < info < warn < error
 * Default: info in production, debug in development.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveDefaultLevel(): LogLevel {
  const raw = (process.env["LOG_LEVEL"] ?? "").trim().toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return (process.env["NODE_ENV"] ?? "development") === "production" ? "info" : "debug";
}

let activeLevel: LogLevel = resolveDefaultLevel();

export function setLogLevel(level: LogLevel): void {
  activeLevel = level;
}

export function getLogLevel(): LogLevel {
  return activeLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[activeLevel];
}

export interface Logger {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
  child: (namespace: string) => Logger;
}

function emit(
  level: LogLevel,
  namespace: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  if (!shouldLog(level)) return;

  const payload =
    meta && Object.keys(meta).length > 0
      ? { level, ns: namespace, msg: message, ...meta }
      : { level, ns: namespace, msg: message };

  const line = JSON.stringify(payload);

  switch (level) {
    case "debug":
      console.debug(line);
      break;
    case "info":
      console.info(line);
      break;
    case "warn":
      console.warn(line);
      break;
    case "error":
      console.error(line);
      break;
  }
}

export function createLogger(namespace: string): Logger {
  return {
    debug: (message, meta) => emit("debug", namespace, message, meta),
    info: (message, meta) => emit("info", namespace, message, meta),
    warn: (message, meta) => emit("warn", namespace, message, meta),
    error: (message, meta) => emit("error", namespace, message, meta),
    child: (childNs) => createLogger(`${namespace}.${childNs}`),
  };
}

/** Shared hot-path loggers */
export const deskLog = createLogger("desk");
export const capitalLog = createLogger("desk.capital");
export const x402Log = createLogger("x402");
export const rateLimitLog = createLogger("rate-limit");
