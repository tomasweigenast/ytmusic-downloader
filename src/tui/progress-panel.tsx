import { Box, Text, useStdout } from "ink";
import { useEffect, useState, type JSX } from "react";
import { formatDuration } from "../format.ts";
import {
  getGlobalProgressStore,
  type ProgressState,
} from "../progress-store.ts";

const EMPTY_STATE: ProgressState = {
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

function useProgressState(): ProgressState {
  const [state, setState] = useState<ProgressState>(EMPTY_STATE);

  useEffect(() => {
    function attach(): (() => void) | undefined {
      const store = getGlobalProgressStore();
      if (!store) return undefined;
      setState(store.getState());
      return store.subscribe(() => setState(store.getState()));
    }

    const unsub = attach();
    if (unsub) return unsub;

    const interval = setInterval(() => {
      const unsub = attach();
      if (unsub) clearInterval(interval);
    }, 50);

    return () => clearInterval(interval);
  }, []);

  return state;
}

function bar(pct: number, width: number): string {
  const filled = Math.round(Math.min(1, pct) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function trunc(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

export function ProgressPanel(): JSX.Element {
  const state = useProgressState();
  const { stdout } = useStdout();
  const cols = Math.max(40, (stdout?.columns ?? 80) - 4);

  const activeItems = Array.from(state.active.values());
  const downloading = state.total > 0;
  const done = state.completed + state.failed;
  const overallPct = state.total === 0 ? 0 : done / state.total;
  const overallBarWidth = Math.max(20, cols - 12);

  return (
    <Box flexDirection="column" padding={1}>

      {/* Phase */}
      {state.phase ? (
        <Box marginBottom={1}>
          <Text color="cyan">⟳ </Text><Text bold>{state.phase}</Text>
        </Box>
      ) : null}

      {/* Overall bar */}
      {downloading && (
        <Box flexDirection="column" marginBottom={1}>
          <Box>
            <Text color="green">{bar(overallPct, overallBarWidth)}</Text>
            <Text> </Text>
            <Text bold>{Math.round(overallPct * 100)}%</Text>
          </Box>
          <Box>
            <Text color="green">✓ {state.completed}</Text>
            <Text> done  </Text>
            <Text color="red">✗ {state.failed}</Text>
            <Text> failed  </Text>
            <Text color="blue">⊘ {state.skipped}</Text>
            <Text> skipped  </Text>
            <Text color="yellow">⟳ {state.active.size}</Text>
            <Text> active  </Text>
            <Text color="gray">◦ {state.pending.length} pending  </Text>
            <Text color="gray">{done}/{state.total}</Text>
          </Box>
        </Box>
      )}

      {/* Rate limit */}
      {state.rateLimitDelayMs > 0 && (
        <Box marginBottom={1}>
          <Text color="yellow">⚠ Rate limit — next waits {(state.rateLimitDelayMs / 1000).toFixed(1)}s</Text>
        </Box>
      )}

      {/* Active downloads with per-song bars */}
      {activeItems.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold underline>Downloading</Text>
          {activeItems.map((item) => {
            const elapsed = formatDuration((Date.now() - item.startedAt) / 1000);
            const pct = item.percent / 100;
            const songBar = bar(pct, 12);
            const pctStr = item.percent > 0 ? `${item.percent.toFixed(0)}%` : "---%";
            const speed = item.speed || "";
            const titleWidth = Math.max(10, cols - 40);
            return (
              <Box key={item.id}>
                <Text color="yellow">▸ </Text>
                <Text color="gray">{elapsed} </Text>
                <Text>{trunc(item.title, titleWidth)} </Text>
                <Text color={item.percent > 0 ? "green" : "gray"}>{songBar}</Text>
                <Text color="cyan"> {pctStr}</Text>
                {speed ? <Text color="gray">  {speed}</Text> : null}
              </Box>
            );
          })}
        </Box>
      )}

      {/* Pending */}
      {state.pending.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold underline>Up next</Text>
          {state.pending.slice(0, 4).map((title, i) => (
            <Text key={i} color="gray">◦ {trunc(title, cols - 4)}</Text>
          ))}
          {state.pending.length > 4 && (
            <Text color="gray">  … and {state.pending.length - 4} more</Text>
          )}
        </Box>
      )}

      {/* Recent errors */}
      {state.recentErrors.length > 0 && (
        <Box flexDirection="column">
          <Text bold underline color="red">Recent failures</Text>
          {state.recentErrors.map((err, i) => (
            <Text key={i} color="red">✗ {trunc(err, cols - 4)}</Text>
          ))}
        </Box>
      )}

    </Box>
  );
}
