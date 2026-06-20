import { Box, Text, useInput, useStdout } from "ink";
import { useEffect, useMemo, useState, type JSX } from "react";
import { getGlobalLogStore, type LogEntry } from "../log-store.ts";
import { LOG_LEVEL_COLORS, LOG_LEVEL_LABELS } from "./log-colors.ts";

// Rows consumed by the header (title) and footer (scrollbar + margin)
const CHROME_HEIGHT = 3; // title + marginTop + scrollbar row
const PREFIX_WIDTH = 18; // "HH:MM:SS LEVEL "

// Border on parent (2) + padding on this box (2 each side)
const HORIZ_CHROME = 4;
const VERT_CHROME = 4;

function useLogs(): readonly LogEntry[] {
  const [logs, setLogs] = useState<readonly LogEntry[]>([]);

  useEffect(() => {
    function attach(): (() => void) | undefined {
      const store = getGlobalLogStore();
      if (!store) return undefined;
      setLogs(store.getLogs());
      return store.subscribe(() => setLogs(store.getLogs()));
    }

    const unsub = attach();
    if (unsub) return unsub;

    const interval = setInterval(() => {
      const unsub = attach();
      if (unsub) {
        clearInterval(interval);
        return unsub;
      }
    }, 50);

    return () => clearInterval(interval);
  }, []);

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

  // Available content area inside this panel
  const panelWidth = Math.max(20, Math.floor((stdout.columns ?? 80) / 2) - HORIZ_CHROME);
  const panelHeight = Math.max(6, (stdout.rows ?? 24) - VERT_CHROME);
  const visibleRows = Math.max(1, panelHeight - CHROME_HEIGHT);
  const messageWidth = Math.max(1, panelWidth - PREFIX_WIDTH);

  const [scrollX, setScrollX] = useState(0);
  const [scrollY, setScrollY] = useState(0);

  const lines = useMemo(
    () =>
      logs.map((log) => ({
        ...log,
        prefix: `${formatTime(log.timestamp)} ${LOG_LEVEL_LABELS[log.level]}`,
      })),
    [logs],
  );

  const maxMessageWidth = useMemo(
    () => lines.reduce((max, line) => Math.max(max, line.message.length), 0),
    [lines],
  );

  const maxScrollX = Math.max(0, maxMessageWidth - messageWidth);
  const maxScrollY = Math.max(0, lines.length - visibleRows);

  const safeScrollX = Math.min(scrollX, maxScrollX);
  const safeScrollY = Math.min(scrollY, maxScrollY);

  // Auto-follow: reset scrollY to 0 (newest) whenever new logs arrive
  // and the user hasn't scrolled up.
  const prevLenRef = useMemo(() => ({ current: 0 }), []);
  if (scrollY === 0 && lines.length !== prevLenRef.current) {
    prevLenRef.current = lines.length;
  }

  useInput(
    (_input, key) => {
      if (key.upArrow) setScrollY((y) => Math.min(y + 1, maxScrollY));
      else if (key.downArrow) setScrollY((y) => Math.max(y - 1, 0));
      else if (key.leftArrow) setScrollX((x) => Math.max(x - 4, 0));
      else if (key.rightArrow) setScrollX((x) => Math.min(x + 4, maxScrollX));
    },
    { isActive: true },
  );

  const visibleLines = lines
    .slice(
      Math.max(0, lines.length - visibleRows - safeScrollY),
      lines.length - safeScrollY,
    )
    .slice(-visibleRows);

  // Horizontal scrollbar
  const sbWidth = Math.max(1, messageWidth);
  const thumbSize =
    maxScrollX > 0
      ? Math.max(1, Math.floor(sbWidth * (messageWidth / (maxMessageWidth || messageWidth))))
      : sbWidth;
  const thumbStart =
    maxScrollX > 0
      ? Math.floor((safeScrollX / maxScrollX) * (sbWidth - thumbSize))
      : 0;
  const scrollbar =
    "[" +
    " ".repeat(thumbStart) +
    "█".repeat(thumbSize) +
    " ".repeat(Math.max(0, sbWidth - thumbStart - thumbSize)) +
    "]";

  return (
    <Box flexDirection="column" padding={1} overflow="hidden">
      <Text bold underline>
        Logs
      </Text>
      <Box flexDirection="column" height={visibleRows} overflow="hidden">
        {visibleLines.map((log, i) => {
          const sliced = log.message.slice(safeScrollX, safeScrollX + messageWidth);
          const padded = padEnd(sliced, messageWidth);
          return (
            <Text key={i} wrap="truncate">
              <Text color="gray">{padEnd(log.prefix, PREFIX_WIDTH)}</Text>
              <Text color={LOG_LEVEL_COLORS[log.level]}>{padded}</Text>
            </Text>
          );
        })}
      </Box>
      <Box marginTop={1} overflow="hidden">
        <Text color="gray">{padEnd("", PREFIX_WIDTH)}</Text>
        <Text color="gray">{scrollbar}</Text>
      </Box>
    </Box>
  );
}
