import type { ProgressStore } from "./progress-store.ts";
import type { Logger } from "./utils.ts";

interface Task<T> {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export class WorkerPool {
  private maxConcurrency: number;
  private currentConcurrency = 0;
  private queue: Task<unknown>[] = [];
  private rateLimitDelayMs = 0;
  private active = true;

  constructor(
    initialConcurrency: number,
    private readonly logger: Logger,
    private readonly progressStore?: ProgressStore,
  ) {
    this.maxConcurrency = Math.max(1, initialConcurrency);
  }

  private async runTask<T>(task: Task<T>): Promise<void> {
    this.currentConcurrency++;

    if (this.rateLimitDelayMs > 0) {
      this.logger.warn(
        `Rate limit active: sleeping ${this.rateLimitDelayMs}ms before next download`,
      );
      await sleep(this.rateLimitDelayMs);
    }

    try {
      const result = await task.fn();
      task.resolve(result);
      this.recordSuccess();
    } catch (err) {
      task.reject(err);
    } finally {
      this.currentConcurrency--;
      this.pumpQueue();
    }
  }

  private pumpQueue(): void {
    while (
      this.active &&
      this.queue.length > 0 &&
      this.currentConcurrency < this.maxConcurrency
    ) {
      const task = this.queue.shift();
      if (!task) continue;
      void this.runTask(task);
    }
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject } as Task<unknown>);
      this.pumpQueue();
    });
  }

  private recordSuccess(): void {
    if (this.rateLimitDelayMs > 0) {
      this.rateLimitDelayMs = Math.floor(this.rateLimitDelayMs / 2);
      this.progressStore?.setRateLimitDelay(this.rateLimitDelayMs);
    }
  }

  registerRateLimit(): void {
    if (this.maxConcurrency > 1) {
      this.maxConcurrency--;
      this.logger.warn(
        `Rate limit hit. Reducing concurrency to ${this.maxConcurrency}.`,
      );
    }

    this.rateLimitDelayMs = Math.min(
      Math.max(this.rateLimitDelayMs * 2, 2000),
      60000,
    );

    this.progressStore?.setRateLimitDelay(this.rateLimitDelayMs);
  }

  async drain(): Promise<void> {
    while (this.queue.length > 0 || this.currentConcurrency > 0) {
      await sleep(100);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
