import type { LogLevel } from "../log-store.ts";

export const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  info: "cyan",
  success: "green",
  warn: "yellow",
  error: "red",
  debug: "gray",
};

export const LOG_LEVEL_LABELS: Record<LogLevel, string> = {
  info: "INFO ",
  success: "OK   ",
  warn: "WARN ",
  error: "ERROR",
  debug: "DEBUG",
};
