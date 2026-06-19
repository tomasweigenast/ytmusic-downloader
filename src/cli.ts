#!/usr/bin/env bun
import { cac } from "cac";
import { $ } from "bun";
import { mkdirSync } from "fs";
import { join } from "path";
import { cliFlagsSchema } from "./types.ts";
import { buildConfig } from "./config.ts";
import { ensureYtdlp } from "./ytdlp-manager.ts";
import { MetadataDatabase } from "./db.ts";
import { extractPlaylist } from "./extractor.ts";
import { downloadTrack } from "./downloader.ts";
import { checkExistingDownload } from "./resume.ts";
import { WorkerPool } from "./pool.ts";
import { LogStore, setGlobalLogStore } from "./log-store.ts";
import {
  ProgressStore,
  setGlobalProgressStore,
} from "./progress-store.ts";
import { renderTui } from "./tui/index.tsx";
import { Logger } from "./utils.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      trackCount: extracted.entries.length,
      rawJson: extracted.rawJson,
    });

    logger.info(`Playlist saved: ${playlist.title}`);
    progress.start(extracted.entries.length, extracted.entries.map((e) => e.title));

    const pool = new WorkerPool(config.workers, logger);

    for (const entry of extracted.entries) {
      const check = checkExistingDownload(db, playlist.id, entry);
      if (check.skip) {
        progress.setSkipped(entry.id, entry.title);
        logger.debug(`Already downloaded: ${entry.title}`);
        continue;
      }

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
              progress.updateProgress(
                entry.id,
                update.percent,
                update.speed,
                update.eta,
              );
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
            logger.warn(
              `Retry ${attempt}/${config.retries} for "${entry.title}" in ${delay}ms`,
            );
            await sleep(delay);
            progress.setActive(entry.id, entry.title);
          }
        }

        progress.setFailed(entry.id);
        logger.error(`Failed "${entry.title}": ${lastError}`);
      });
    }

    await pool.drain();
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const cli = cac("ytmusic-downloader");

  cli
    .command("download <playlist-url>", "Download a YouTube Music playlist")
    .option("--output-dir <dir>", "Directory to save downloads", {
      default: "./downloads",
    })
    .option("--workers <n>", "Number of parallel downloads", { default: 5 })
    .option("--retries <n>", "Retry attempts per song", { default: 3 })
    .option(
      "--cookies-from-browser <browser>",
      "Load cookies from browser (e.g. firefox, chrome)",
    )
    .option("--cookies <file>", "Load cookies from a cookies.txt file")
    .option(
      "--filename-template <template>",
      "yt-dlp output template for filenames",
      { default: "%(playlist_index)02d - %(title)s - %(artist)s.%(ext)s" },
    )
    .option("--skip-update", "Skip yt-dlp update check")
    .option("--verbose", "Enable verbose logging");

  const parsed = cli.parse();

  if (parsed.args.length === 0) {
    cli.outputHelp();
    process.exit(0);
  }

  const flags = cliFlagsSchema.parse({
    playlistUrl: parsed.args[0],
    ...parsed.options,
  });

  const config = buildConfig(flags);
  const logFilePath = join(process.cwd(), "log.txt");
  const logStore = new LogStore(logFilePath, config.verbose);
  const progressStore = new ProgressStore();
  setGlobalLogStore(logStore);
  setGlobalProgressStore(progressStore);

  const useTui =
    (process.stdout.isTTY ?? false) && (process.stdin.isTTY ?? false);
  const logger = new Logger(config.verbose, logStore, !useTui);

  logger.info(`Output directory: ${config.outputDir}`);
  logger.info(`Log file: ${logFilePath}`);
  mkdirSync(config.outputDir, { recursive: true });

  const ytdlpPath = await ensureYtdlp(config, logger);
  logger.debug(`yt-dlp binary: ${ytdlpPath}`);

  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) {
    logger.warn(
      "ffmpeg not found in PATH. Audio extraction and thumbnail embedding may fail.",
    );
  }

  let tuiUnmount: (() => void) | null = null;

  if (useTui) {
    tuiUnmount = renderTui().unmount;
  }

  try {
    await runDownload(config, logger, progressStore);
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

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
