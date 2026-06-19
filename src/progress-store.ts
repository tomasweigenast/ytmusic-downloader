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
  active: Map<string, ActiveItem>;
  pending: string[];
}

export class ProgressStore {
  private state: ProgressState = {
    total: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    active: new Map(),
    pending: [],
  };
  private listeners = new Set<() => void>();

  start(total: number, allTitles: string[]): void {
    this.state = {
      total,
      completed: 0,
      failed: 0,
      skipped: 0,
      active: new Map(),
      pending: allTitles.slice(),
    };
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

  getState(): ProgressState {
    return this.state;
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
