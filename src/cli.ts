#!/usr/bin/env bun
import { cac } from "cac";
import { $ } from "bun";
import { writeFileSync } from "fs";
import { mkdirSync } from "fs";
import { join } from "path";
import { cliFlagsSchema, type CliFlags } from "./types.ts";
import { buildConfig } from "./config.ts";
import { ensureYtdlp } from "./ytdlp-manager.ts";
import { MetadataDatabase } from "./db.ts";
import { extractPlaylist } from "./extractor.ts";
import { downloadTrack } from "./downloader.ts";
import { checkExistingDownload } from "./resume.ts";
import { WorkerPool } from "./pool.ts";
import { LogStore, setGlobalLogStore } from "./log-store.ts";
import { ProgressStore, setGlobalProgressStore } from "./progress-store.ts";
import { runFormTui, renderDownloadTui } from "./tui/index.tsx";
import { Logger } from "./utils.ts";
import { startBgutilServer } from "./bgutil-manager.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startPlainProgress(progressStore: ProgressStore): () => void {
  const isTTY = process.stdout.isTTY ?? false;
  let linesWritten = 0;

  const render = () => {
    const state = progressStore.getState();
    const active = [...state.active.values()];
    const lines: string[] = [];

    const done = state.completed + state.failed + state.skipped;
    lines.push(`Progress: ${done}/${state.total}  (✓${state.completed} ✗${state.failed} ⊘${state.skipped})`);

    if (state.rateLimitDelayMs > 0) {
      const seconds = (state.rateLimitDelayMs / 1000).toFixed(1);
      lines.push(`  ⚠ Rate limit active: next download waits ${seconds}s`);
    }

    for (const item of active) {
      const bar = buildBar(item.percent, 30);
      const speed = item.speed ? `  ${item.speed}` : "";
      const eta = item.eta ? `  ETA ${item.eta}` : "";
      lines.push(`  ↓ ${item.title.slice(0, 50).padEnd(50)} ${bar} ${String(item.percent.toFixed(1)).padStart(5)}%${speed}${eta}`);
    }

    if (state.pending.length > 0) {
      const preview = state.pending.slice(0, 3).map((t) => t.slice(0, 40)).join(", ");
      const more = state.pending.length > 3 ? ` +${state.pending.length - 3} more` : "";
      lines.push(`  Next: ${preview}${more}`);
    }

    if (isTTY && linesWritten > 0) {
      process.stdout.write(`\x1b[${linesWritten}A\x1b[0J`);
    }

    process.stdout.write(lines.join("\n") + "\n");
    linesWritten = lines.length;
  };

  const unsub = progressStore.subscribe(render);
  return unsub;
}

function buildBar(percent: number, width: number): string {
  const filled = Math.round((percent / 100) * width);
  return "[" + "█".repeat(filled) + "░".repeat(width - filled) + "]";
}

function isRateLimitError(error: string | null): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return (
    lower.includes("429") ||
    lower.includes("too many requests") ||
    lower.includes("rate limit") ||
    lower.includes("sign in to confirm") ||
    lower.includes("unable to extract uploader id")
  );
}

async function checkFfmpeg(): Promise<boolean> {
  try {
    const result = await $`ffmpeg -version`.quiet().nothrow();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

async function runDownload(
  config: ReturnType<typeof buildConfig>,
  logger: Logger,
  progress: ProgressStore,
): Promise<void> {
  const db = new MetadataDatabase(config.databasePath);

  try {
    const extracted = await extractPlaylist(config, logger);

    const playlist = db.insertPlaylist({
      url: config.playlistUrl,
      title: extracted.title,
      uploader: extracted.uploader,
      description: extracted.description,
      thumbnail: extracted.thumbnail,
      trackCount: extracted.playlistCount ?? extracted.entries.length,
      rawJson: extracted.rawJson,
    });

    logger.info(`Playlist saved: ${playlist.title}`);

    progress.setPhase("Checking existing downloads…");
    const checks = extracted.entries.map((entry) => ({
      entry,
      check: checkExistingDownload(db, playlist.id, entry, config.outputDir),
    }));
    const toDownload = checks.filter(({ check }) => !check.skip);
    const skipped = checks.filter(({ check }) => check.skip);

    logger.info(`${toDownload.length} to download, ${skipped.length} already done`);
    progress.start(toDownload.length, toDownload.map(({ entry }) => entry.title));

    const pool = new WorkerPool(config.workers, logger, progress);

    for (const { entry } of skipped) {
      logger.debug(`Already downloaded: ${entry.title}`);
    }

    for (const { entry } of toDownload) {

      pool.run(async () => {
        progress.setActive(entry.id, entry.title);
        let attempt = 0;
        let lastError: string | null = null;

        while (attempt <= config.retries) {
          const result = await downloadTrack(
            config,
            db,
            playlist.id,
            entry,
            logger,
            (update) => {
              progress.updateProgress(entry.id, update.percent, update.speed, update.eta);
            },
          );

          if (result.success && result.song) {
            progress.setComplete(entry.id);
            logger.debug(`Downloaded: ${result.song.title}`);
            return;
          }

          lastError = result.error;
          attempt++;

          if (isRateLimitError(lastError)) {
            pool.registerRateLimit();
          }

          if (attempt <= config.retries) {
            const delay = Math.min(1000 * 2 ** attempt, 30000);
            logger.warn(`Retry ${attempt}/${config.retries} for "${entry.title}" in ${delay}ms`);
            await sleep(delay);
            progress.setActive(entry.id, entry.title);
          }
        }

        progress.setFailed(entry.id);
        const errMsg = `"${entry.title}": ${lastError}`;
        logger.error(`Failed ${errMsg}`);
        progress.addError(errMsg);
      });
    }

    await pool.drain();
  } finally {
    db.close();
  }
}

async function runWithFlags(flags: CliFlags, useTui: boolean): Promise<void> {
  const config = buildConfig(flags);
  const logFilePath = join(process.cwd(), "log.txt");
  const logStore = new LogStore(logFilePath, config.verbose);
  const progressStore = new ProgressStore();
  setGlobalLogStore(logStore);
  setGlobalProgressStore(progressStore);

  const logger = new Logger(config.verbose, logStore, !useTui);

  mkdirSync(config.outputDir, { recursive: true });

  // Render download TUI early so all subsequent logs appear in the panel
  let tuiUnmount: (() => void) | null = null;
  if (useTui) {
    tuiUnmount = renderDownloadTui().unmount;
  } else {
    tuiUnmount = startPlainProgress(progressStore);
  }

  logger.info(`Output directory: ${config.outputDir}`);
  logger.info(`Log file: ${logFilePath}`);

  try {
    progressStore.setPhase("Checking yt-dlp…");
    const ytdlpPath = await ensureYtdlp(config, logger);
    logger.debug(`yt-dlp binary: ${ytdlpPath}`);

    progressStore.setPhase("Checking ffmpeg…");
    const hasFfmpeg = await checkFfmpeg();
    if (!hasFfmpeg) {
      logger.warn("ffmpeg not found in PATH. Audio extraction and thumbnail embedding may fail.");
    }

    progressStore.setPhase("Starting POT server…");
    const bgutil = await startBgutilServer(logger);

    progressStore.setPhase("Fetching playlist…");
    try {
      await runDownload(config, logger, progressStore);
    } finally {
      bgutil?.stop();
    }
  } finally {
    tuiUnmount?.();
  }

  const finalState = progressStore.getState();
  console.log("");
  console.log("Download complete");
  console.log(`  Completed: ${finalState.completed}`);
  console.log(`  Skipped:   ${finalState.skipped}`);
  console.log(`  Failed:    ${finalState.failed}`);
  console.log(`  Log file:  ${logFilePath}`);
}

async function main(): Promise<void> {
  const cli = cac("ytmusic-downloader");

  cli
    .command("download <playlist-url>", "Download a YouTube Music playlist")
    .option("--output-dir <dir>", "Directory to save downloads", { default: "./downloads" })
    .option("--workers <n>", "Number of parallel downloads", { default: 5 })
    .option("--retries <n>", "Retry attempts per song", { default: 3 })
    .option("--cookies-from-browser <browser>", "Load cookies from browser (e.g. firefox, chrome)")
    .option("--cookies <file>", "Load cookies from a cookies.txt file")
    .option("--filename-template <template>", "yt-dlp output template for filenames", {
      default: "%(title)s - %(album)s - %(artist)s.%(ext)s",
    })
    .option("--skip-update", "Skip yt-dlp update check")
    .option("--opus", "Use Opus format instead of M4A (smaller files, less compatible cover art)")
    .option("--verbose", "Enable verbose logging")
    .option("--no-tui", "Disable the TUI and print logs to stdout")
    .option(
      "--ytdlp-channel <channel>",
      "yt-dlp release channel to use: stable or nightly (default: stable)",
    );

  cli
    .command("export-failed <db-path>", "Export failed song URLs to a text file")
    .option("--output <file>", "Output file path", { default: "failed.txt" })
    .action((dbPath: string, options: { output: string }) => {
      const db = new MetadataDatabase(dbPath);
      const failed = db.getFailedSongs();
      db.close();

      if (failed.length === 0) {
        console.log("No failed songs.");
        return;
      }

      const lines = failed.map(
        ({ title, sourceId, errorMessage }) =>
          `https://music.youtube.com/watch?v=${sourceId}\t${title}\t${errorMessage ?? ""}`,
      );
      writeFileSync(options.output, lines.join("\n") + "\n");
      console.log(`Exported ${failed.length} failed songs to ${options.output}`);
    });

  const parsed = cli.parse();

  const useTui =
    (process.stdout.isTTY ?? false) &&
    (process.stdin.isTTY ?? false) &&
    parsed.options.tui !== false;

  if (parsed.args.length === 0) {
    if (useTui) {
      // Interactive mode: show form TUI to collect settings
      const flags = await runFormTui();
      if (!flags) process.exit(0);
      await runWithFlags(flags, useTui);
    } else {
      cli.outputHelp();
      process.exit(0);
    }
    return;
  }

  const flags = cliFlagsSchema.parse({
    playlistUrl: parsed.args[0],
    ...parsed.options,
  });

  await runWithFlags(flags, useTui);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
