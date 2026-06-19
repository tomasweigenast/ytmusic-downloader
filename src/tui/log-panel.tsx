import { Box, Text, useInput, useStdout } from "ink";
import { useEffect, useMemo, useState, type JSX } from "react";
import { getGlobalLogStore, type LogEntry } from "../log-store.ts";
import { LOG_LEVEL_COLORS, LOG_LEVEL_LABELS } from "./log-colors.ts";

const PADDING = 2;
const HEADER_HEIGHT = 2;
const PREFIX_WIDTH = 18; // "HH:MM:SS LEVEL "

function useLogs(): readonly LogEntry[] {
  const store = getGlobalLogStore();
  const [logs, setLogs] = useState<readonly LogEntry[]>(() => store?.getLogs() ?? []);

  useEffect(() => {
    if (!store) return;
    return store.subscribe(() => {
      setLogs(store.getLogs());
    });
  }, [store]);

  return logs;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour12: false });
}

function padEnd(str: string, len: number): string {
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}

export function LogPanel(): JSX.Element {
  const logs = useLogs();
  const { stdout } = useStdout();
  const panelWidth = Math.max(20, Math.floor((stdout.columns ?? 80) / 2) - PADDING);
  const panelHeight = Math.max(6, (stdout.rows ?? 24) - PADDING);
  const visibleRows = Math.max(1, panelHeight - HEADER_HEIGHT);
  const messageWidth = Math.max(1, panelWidth - PREFIX_WIDTH);

  const [scrollX, setScrollX] = useState(0);
  const [scrollY, setScrollY] = useState(0);

  const lines = useMemo(() => {
    return logs.map((log) => ({
      ...log,
      prefix: `${formatTime(log.timestamp)} ${LOG_LEVEL_LABELS[log.level]}`,
      message: log.message,
    }));
  }, [logs]);

  const maxMessageWidth = useMemo(() => {
    return lines.reduce((max, line) => Math.max(max, line.message.length), 0);
  }, [lines]);

  const maxScrollX = Math.max(0, maxMessageWidth - messageWidth);
  const maxScrollY = Math.max(0, lines.length - visibleRows);

  const safeScrollX = Math.min(scrollX, maxScrollX);
  const safeScrollY = Math.min(scrollY, maxScrollY);

  useInput((_input, key) => {
    if (key.upArrow) {
      setScrollY((y) => Math.min(y + 1, maxScrollY));
    } else if (key.downArrow) {
      setScrollY((y) => Math.max(y - 1, 0));
    } else if (key.leftArrow) {
      setScrollX((x) => Math.max(x - 4, 0));
    } else if (key.rightArrow) {
      setScrollX((x) => Math.min(x + 4, maxScrollX));
    }
  });

  const visibleLines = lines
    .slice(Math.max(0, lines.length - visibleRows - safeScrollY), lines.length - safeScrollY)
    .slice(-visibleRows);

  const scrollbarWidth = Math.max(1, messageWidth);
  const thumbSize = maxScrollX > 0
    ? Math.max(1, Math.floor(scrollbarWidth * (messageWidth / (maxMessageWidth || messageWidth))))
    : scrollbarWidth;
  const thumbStart = maxScrollX > 0
    ? Math.floor((safeScrollX / maxScrollX) * (scrollbarWidth - thumbSize))
    : 0;
  const scrollbar =
    "[" +
    " ".repeat(thumbStart) +
    "█".repeat(thumbSize) +
    " ".repeat(Math.max(0, scrollbarWidth - thumbStart - thumbSize)) +
    "]";

  return (
    <Box flexDirection="column" padding={1} width={panelWidth + PADDING}>
      <Text bold underline>
        Logs
      </Text>
      <Box flexDirection="column" height={visibleRows}>
        {visibleLines.map((log, i) => {
          const sliced = log.message.slice(safeScrollX, safeScrollX + messageWidth);
          const padded = padEnd(sliced, messageWidth);
          return (
            <Text key={i}>
              <Text color="gray">{padEnd(log.prefix, PREFIX_WIDTH)}</Text>
              <Text color={LOG_LEVEL_COLORS[log.level]}>{padded}</Text>
            </Text>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text color="gray">{padEnd("", PREFIX_WIDTH)}</Text>
        <Text color="gray">{scrollbar}</Text>
      </Box>
    </Box>
  );
}
