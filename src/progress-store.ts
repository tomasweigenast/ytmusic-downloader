export interface ActiveItem {
  id: string;
  title: string;
  startedAt: number;
  percent: number;
  speed: string;
  eta: string;
}

export interface ProgressState {
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  rateLimitDelayMs: number;
  active: Map<string, ActiveItem>;
  pending: string[];
  phase: string;
  recentErrors: string[];
}

export class ProgressStore {
  private state: ProgressState = {
    total: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    rateLimitDelayMs: 0,
    active: new Map(),
    pending: [],
    phase: "",
    recentErrors: [],
  };
  private listeners = new Set<() => void>();

  start(total: number, allTitles: string[]): void {
    this.state = {
      total,
      completed: 0,
      failed: 0,
      skipped: 0,
      rateLimitDelayMs: 0,
      active: new Map(),
      pending: allTitles.slice(),
      phase: "Downloading",
      recentErrors: [],
    };
    this.notify();
  }

  setPhase(phase: string): void {
    this.state.phase = phase;
    this.notify();
  }

  addError(message: string): void {
    this.state.recentErrors = [...this.state.recentErrors.slice(-4), message];
    this.notify();
  }

  setActive(id: string, title: string): void {
    this.state.active.set(id, {
      id,
      title,
      startedAt: Date.now(),
      percent: 0,
      speed: "",
      eta: "",
    });
    this.state.pending = this.state.pending.filter((t) => t !== title);
    this.notify();
  }

  updateProgress(id: string, percent: number, speed: string, eta: string): void {
    const item = this.state.active.get(id);
    if (!item) return;
    item.percent = percent;
    item.speed = speed;
    item.eta = eta;
    this.notify();
  }

  setComplete(id: string): void {
    this.state.active.delete(id);
    this.state.completed++;
    this.notify();
  }

  setFailed(id: string): void {
    this.state.active.delete(id);
    this.state.failed++;
    this.notify();
  }

  setSkipped(id: string, title: string): void {
    this.state.active.delete(id);
    this.state.pending = this.state.pending.filter((t) => t !== title);
    this.state.skipped++;
    this.notify();
  }

  setRateLimitDelay(ms: number): void {
    this.state.rateLimitDelayMs = Math.max(0, Math.round(ms));
    this.notify();
  }

  getState(): ProgressState {
    return { ...this.state, active: new Map(this.state.active) };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

let globalStore: ProgressStore | null = null;

export function setGlobalProgressStore(store: ProgressStore): void {
  globalStore = store;
}

export function getGlobalProgressStore(): ProgressStore | null {
  return globalStore;
}
