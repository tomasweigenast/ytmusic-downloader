import { appendFileSync, writeFileSync } from "fs";

export type LogLevel = "info" | "success" | "warn" | "error" | "debug";

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
}

const LEVEL_PREFIX: Record<LogLevel, string> = {
  info: "[INFO]",
  success: "[OK]",
  warn: "[WARN]",
  error: "[ERROR]",
  debug: "[DEBUG]",
};

export class LogStore {
  private logs: LogEntry[] = [];
  private listeners = new Set<() => void>();
  private readonly filePath: string;
  private readonly verbose: boolean;

  constructor(filePath: string, verbose: boolean) {
    this.filePath = filePath;
    this.verbose = verbose;
    writeFileSync(this.filePath, "", { flag: "w" });
  }

  log(level: LogLevel, message: string): void {
    if (level === "debug" && !this.verbose) return;

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      message,
    };

    this.logs.push(entry);
    this.writeToFile(entry);
    this.notify();
  }

  getLogs(): readonly LogEntry[] {
    return this.logs;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private writeToFile(entry: LogEntry): void {
    try {
      const time = entry.timestamp.toISOString();
      const line = `${time} ${LEVEL_PREFIX[entry.level]} ${entry.message}\n`;
      appendFileSync(this.filePath, line);
    } catch {
      // ignore file write errors
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

let globalStore: LogStore | null = null;

export function setGlobalLogStore(store: LogStore): void {
  globalStore = store;
}

export function getGlobalLogStore(): LogStore | null {
  return globalStore;
}
