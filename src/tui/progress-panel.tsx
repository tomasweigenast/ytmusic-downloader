import { Box, Text } from "ink";
import { useEffect, useState, type JSX } from "react";
import { formatDuration } from "../format.ts";
import {
  getGlobalProgressStore,
  type ProgressState,
} from "../progress-store.ts";

function renderBar(pct: number): string {
  const width = 30;
  const filled = Math.round(width * pct);
  const empty = width - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

function useProgressState(): ProgressState {
  const store = getGlobalProgressStore();
  const [state, setState] = useState<ProgressState>(() =>
    store?.getState() ?? {
      total: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      active: new Map(),
      pending: [],
    }
  );

  useEffect(() => {
    if (!store) return;
    return store.subscribe(() => {
      setState(store.getState());
    });
  }, [store]);

  return state;
}

export function ProgressPanel(): JSX.Element {
  const state = useProgressState();
  const pct = state.total === 0 ? 0 : (state.completed + state.failed) / state.total;
  const bar = renderBar(pct);
  const activeItems = Array.from(state.active.values());

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan">Downloading</Text>
      <Text>
        {state.completed + state.failed}/{state.total} {" "}
        <Text color="green">{bar}</Text> {" "}
        {Math.round(pct * 100)}%
      </Text>
      <Text>
        active:{" "}
        <Text color="yellow">{state.active.size}</Text> completed:{" "}
        <Text color="green">{state.completed}</Text> skipped:{" "}
        <Text color="blue">{state.skipped}</Text> failed:{" "}
        <Text color="red">{state.failed}</Text> pending: {state.pending.length}
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text bold underline>
          Active
        </Text>
        {activeItems.length === 0 && <Text color="gray">No active downloads</Text>}
        {activeItems.slice(0, 5).map((item) => {
          const elapsed = formatDuration((Date.now() - item.startedAt) / 1000);
          const progress =
            item.percent > 0
              ? `${item.percent.toFixed(1).padStart(5, " ")}% ${item.speed} ETA ${item.eta}`.trim()
              : "";
          return (
            <Text key={item.id}>
              <Text color="yellow">▸</Text>{" "}
              <Text color="gray">{elapsed}</Text>{" "}
              {truncate(item.title, 40)}
              {progress && <Text color="cyan">  {progress}</Text>}
            </Text>
          );
        })}
        {activeItems.length > 5 && (
          <Text color="gray">... and {activeItems.length - 5} more</Text>
        )}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold underline>
          Pending
        </Text>
        {state.pending.length === 0 && <Text color="gray">No pending downloads</Text>}
        {state.pending.slice(0, 5).map((title, i) => (
          <Text key={i} color="gray">
            ◦ {truncate(title, 60)}
          </Text>
        ))}
        {state.pending.length > 5 && (
          <Text color="gray">... and {state.pending.length - 5} more</Text>
        )}
      </Box>
    </Box>
  );
}
