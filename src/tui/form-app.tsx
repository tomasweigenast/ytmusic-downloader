import { Box, Text, useInput, useStdout } from "ink";
import { useState, type JSX } from "react";
import type { CliFlags } from "../types.ts";
import { TextInput } from "./text-input.tsx";

// Field indices
const F_URL = 0;
const F_OUTPUT = 1;
const F_WORKERS = 2;
const F_RETRIES = 3;
const F_BROWSER = 4;
const F_COOKIES = 5;
const F_VERBOSE = 6;
const F_SKIP_UPDATE = 7;
const FIELD_COUNT = 8;

interface FormState {
  url: string;
  outputDir: string;
  workers: string;
  retries: string;
  cookiesFromBrowser: string;
  cookies: string;
  verbose: boolean;
  skipUpdate: boolean;
}

export interface FormAppProps {
  onSubmit: (flags: CliFlags) => void;
  onCancel: () => void;
}

export function FormApp({ onSubmit, onCancel }: FormAppProps): JSX.Element {
  const { stdout } = useStdout();
  const [focused, setFocused] = useState(F_URL);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    url: "",
    outputDir: "./downloads",
    workers: "5",
    retries: "3",
    cookiesFromBrowser: "",
    cookies: "",
    verbose: false,
    skipUpdate: false,
  });

  const termWidth = stdout?.columns ?? 80;
  const contentWidth = Math.min(termWidth - 4, 90);
  const inputWidth = contentWidth - 4; // 2 for border + 2 inner padding

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.tab || key.downArrow) {
      setFocused((f) => (f + 1) % FIELD_COUNT);
      setError(null);
      return;
    }
    if (key.upArrow) {
      setFocused((f) => (f - 1 + FIELD_COUNT) % FIELD_COUNT);
      setError(null);
      return;
    }

    if (input === " " && focused === F_VERBOSE) {
      setForm((f) => ({ ...f, verbose: !f.verbose }));
      return;
    }
    if (input === " " && focused === F_SKIP_UPDATE) {
      setForm((f) => ({ ...f, skipUpdate: !f.skipUpdate }));
      return;
    }

    if (key.return) {
      const url = form.url.trim();
      if (!url) {
        setError("Playlist URL is required");
        setFocused(F_URL);
        return;
      }
      try {
        new URL(url);
      } catch {
        setError("Invalid URL — must start with https://");
        setFocused(F_URL);
        return;
      }

      const workers = parseInt(form.workers, 10);
      if (!Number.isFinite(workers) || workers < 1 || workers > 20) {
        setError("Workers must be a number between 1 and 20");
        setFocused(F_WORKERS);
        return;
      }
      const retries = parseInt(form.retries, 10);
      if (!Number.isFinite(retries) || retries < 0 || retries > 10) {
        setError("Retries must be a number between 0 and 10");
        setFocused(F_RETRIES);
        return;
      }

      onSubmit({
        playlistUrl: url,
        outputDir: form.outputDir.trim() || "./downloads",
        workers,
        retries,
        cookiesFromBrowser: form.cookiesFromBrowser.trim() || undefined,
        cookies: form.cookies.trim() || undefined,
        filenameTemplate: "%(title)s - %(album)s - %(artist)s.%(ext)s",
        skipUpdate: form.skipUpdate,
        verbose: form.verbose,
        ytdlpChannel: "stable",
        opus: false,
      });
    }
  });

  function textField(
    index: number,
    label: string,
    key: keyof Pick<FormState, "url" | "outputDir" | "cookiesFromBrowser" | "cookies">,
    placeholder?: string,
  ): JSX.Element {
    const active = focused === index;
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color={active ? "cyan" : "white"}>{label}</Text>
        <Box
          borderStyle="single"
          borderColor={active ? "cyan" : "gray"}
          paddingX={1}
          width={contentWidth}
        >
          <TextInput
            value={form[key]}
            onChange={(v) => setForm((f) => ({ ...f, [key]: v }))}
            placeholder={placeholder}
            isActive={active}
            visibleWidth={inputWidth}
          />
        </Box>
      </Box>
    );
  }

  function numberField(
    index: number,
    label: string,
    key: keyof Pick<FormState, "workers" | "retries">,
  ): JSX.Element {
    const active = focused === index;
    return (
      <Box flexDirection="column" marginRight={4}>
        <Text color={active ? "cyan" : "white"}>{label}</Text>
        <Box
          borderStyle="single"
          borderColor={active ? "cyan" : "gray"}
          paddingX={1}
          width={14}
        >
          <TextInput
            value={form[key]}
            onChange={(v) => {
              // Only allow digits
              if (/^\d*$/.test(v)) setForm((f) => ({ ...f, [key]: v }));
            }}
            isActive={active}
            visibleWidth={10}
          />
        </Box>
      </Box>
    );
  }

  function toggleField(index: number, label: string, value: boolean): JSX.Element {
    const active = focused === index;
    return (
      <Box marginBottom={1} marginRight={4}>
        <Text color={active ? "cyan" : "white"}>
          {active ? "▸ " : "  "}
          <Text color={value ? "green" : "gray"}>{value ? "● " : "○ "}</Text>
          {label}
          <Text color="gray"> (space)</Text>
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={2}>
      <Text bold color="cyan">
        YT Music Downloader
      </Text>
      <Box marginBottom={1} />

      {textField(F_URL, "Playlist URL  (required)", "url", "https://music.youtube.com/playlist?list=...")}
      {textField(F_OUTPUT, "Output Directory", "outputDir", "./downloads")}

      <Box marginBottom={1}>
        {numberField(F_WORKERS, "Workers", "workers")}
        {numberField(F_RETRIES, "Retries", "retries")}
      </Box>

      {textField(F_BROWSER, "Cookies from browser  (e.g. firefox, chrome)", "cookiesFromBrowser", "optional")}
      {textField(F_COOKIES, "Cookies file path", "cookies", "optional")}

      <Box>
        {toggleField(F_VERBOSE, "Verbose logging", form.verbose)}
        {toggleField(F_SKIP_UPDATE, "Skip yt-dlp update", form.skipUpdate)}
      </Box>

      {error != null && (
        <Box marginTop={1}>
          <Text color="red">⚠  {error}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color="gray">
          Tab/↑↓ navigate · Space toggle · Enter start · Esc quit
        </Text>
      </Box>
    </Box>
  );
}
