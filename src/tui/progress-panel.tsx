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

function renderBar(pct: number, width: number): string {
  const filled = Math.round(width * pct);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

export function ProgressPanel(): JSX.Element {
  const state = useProgressState();
  const { stdout } = useStdout();
  const width = Math.max(40, (stdout.columns ?? 80) - 4);
  const barWidth = Math.max(20, width - 16);

  const activeItems = Array.from(state.active.values());
  const isStarting = state.total === 0;
  const pct = state.total === 0 ? 0 : (state.completed + state.failed) / state.total;
  const done = state.completed + state.failed;

  return (
    <Box flexDirection="column" padding={1} width={width}>

      {/* Phase / status line */}
      {state.phase ? (
        <Box marginBottom={1}>
          <Text color="cyan">⟳ </Text>
          <Text bold>{state.phase}</Text>
        </Box>
      ) : null}

      {/* Overall progress — hidden until downloading starts */}
      {!isStarting && (
        <>
          <Box marginBottom={1}>
            <Text color="green">{renderBar(pct, barWidth)}</Text>
            <Text> {Math.round(pct * 100)}%</Text>
          </Box>
          <Box marginBottom={1} gap={2}>
            <Text><Text color="green">✓ {state.completed}</Text> done</Text>
            <Text><Text color="red">✗ {state.failed}</Text> failed</Text>
            <Text><Text color="blue">⊘ {state.skipped}</Text> skipped</Text>
            <Text><Text color="yellow">⟳ {state.active.size}</Text> active</Text>
            <Text color="gray">◦ {state.pending.length} pending</Text>
            <Text color="gray">{done}/{state.total}</Text>
          </Box>
        </>
      )}

      {/* Rate limit warning */}
      {state.rateLimitDelayMs > 0 && (
        <Box marginBottom={1}>
          <Text color="yellow">⚠ Rate limit — next download waits {(state.rateLimitDelayMs / 1000).toFixed(1)}s</Text>
        </Box>
      )}

      {/* Active downloads */}
      {activeItems.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold underline>Active</Text>
          {activeItems.map((item) => {
            const elapsed = formatDuration((Date.now() - item.startedAt) / 1000);
            const itemBarWidth = Math.max(10, width - 52);
            const itemPct = item.percent / 100;
            const bar = renderBar(itemPct, itemBarWidth);
            return (
              <Box key={item.id} flexDirection="column">
                <Box gap={1}>
                  <Text color="yellow">▸</Text>
                  <Text color="gray">{elapsed}</Text>
                  <Text>{truncate(item.title, width - 14)}</Text>
                </Box>
                {item.percent > 0 && (
                  <Box gap={1} paddingLeft={2}>
                    <Text color="green">{bar}</Text>
                    <Text color="cyan">{item.percent.toFixed(1)}%</Text>
                    {item.speed ? <Text color="gray">{item.speed}</Text> : null}
                    {item.eta ? <Text color="gray">ETA {item.eta}</Text> : null}
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      {/* Pending queue */}
      {state.pending.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold underline>Up next</Text>
          {state.pending.slice(0, 5).map((title, i) => (
            <Text key={i} color="gray">◦ {truncate(title, width - 4)}</Text>
          ))}
          {state.pending.length > 5 && (
            <Text color="gray">  … and {state.pending.length - 5} more</Text>
          )}
        </Box>
      )}

      {/* Recent errors */}
      {state.recentErrors.length > 0 && (
        <Box flexDirection="column">
          <Text bold underline color="red">Recent failures</Text>
          {state.recentErrors.map((err, i) => (
            <Text key={i} color="red">✗ {truncate(err, width - 4)}</Text>
          ))}
        </Box>
      )}

    </Box>
  );
}
