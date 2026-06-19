import type { LogLevel, LogStore } from "./log-store.ts";

export class Logger {
  constructor(
    private readonly verbose: boolean,
    private readonly store?: LogStore,
    private readonly consoleMode = false,
  ) {}

  private log(level: LogLevel, message: string): void {
    this.store?.log(level, message);
    if (this.consoleMode) {
      const prefix = `[${level}]`;
      if (level === "error") console.error(prefix, message);
      else if (level === "warn") console.warn(prefix, message);
      else console.log(prefix, message);
    }
  }

  info(message: string): void {
    this.log("info", message);
  }

  success(message: string): void {
    this.log("success", message);
  }

  warn(message: string): void {
    this.log("warn", message);
  }

  error(message: string): void {
    this.log("error", message);
  }

  debug(message: string): void {
    if (this.verbose) {
      this.log("debug", message);
    }
  }
}
