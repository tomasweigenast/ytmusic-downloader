import { $ } from "bun";
import { z } from "zod";
import type { AppConfig } from "./config.ts";
import type { Logger } from "./utils.ts";
import { ytdlpPlaylistSchema, type PlaylistEntry } from "./types.ts";

export interface ExtractedPlaylist {
  title: string;
  uploader: string | null;
  description: string | null;
  thumbnail: string | null;
  webpageUrl: string | null;
  extractor: string;
  playlistCount: number | null;
  rawJson: string;
  entries: PlaylistEntry[];
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "string" ? Number.parseFloat(value) : Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildArgs(
  config: AppConfig,
  extraArgs: string[] = [],
): string[] {
  const args = [
    config.ytdlpBinPath,
    "--flat-playlist",
    "--dump-single-json",
    "--no-warnings",
    ...extraArgs,
  ];

  if (config.cookiesFromBrowser) {
    args.push("--cookies-from-browser", config.cookiesFromBrowser);
  }

  if (config.cookies) {
    args.push("--cookies", config.cookies);
  }

  args.push(config.playlistUrl);
  return args;
}

function normalizeEntries(
  parsed: z.infer<typeof ytdlpPlaylistSchema>,
  config: AppConfig,
): PlaylistEntry[] {
  let entries: PlaylistEntry[] = parsed.entries
    .map((entry, index) => {
      if (typeof entry !== "object" || entry === null) return null;

      const e = entry as Record<string, unknown>;
      const id = String(e.id ?? "");
      const url = String(
        e.url ?? e.webpage_url ?? e.original_url ?? `https://music.youtube.com/watch?v=${id}`,
      );
      const title = String(e.title ?? "Unknown Title");
      const playlistIndex =
        typeof e.playlist_index === "number" ? e.playlist_index : index + 1;

      if (!id) return null;

      return { id, url, title, playlistIndex };
    })
    .filter((e): e is PlaylistEntry => e !== null);

  // Fallback for single video URLs that don't expose an entries array.
  if (entries.length === 0 && parsed.id) {
    entries.push({
      id: parsed.id,
      url: parsed.webpage_url ?? config.playlistUrl,
      title: parsed.title,
      playlistIndex: 1,
    });
  }

  return entries;
}

async function tryExtract(
  config: AppConfig,
  extraArgs: string[],
  logger: Logger,
): Promise<ExtractedPlaylist | null> {
  const args = buildArgs(config, extraArgs);
  logger.debug(`Running: ${args.join(" ")}`);

  const result = await $`${args}`.quiet().nothrow();

  if (result.exitCode !== 0) {
    logger.debug(
      `Playlist extraction attempt failed: ${result.stderr.toString()}`,
    );
    return null;
  }

  try {
    const raw = JSON.parse(result.stdout.toString()) as unknown;
    const parsed = ytdlpPlaylistSchema.parse(raw);
    const entries = normalizeEntries(parsed, config);

    return {
      title: parsed.title,
      uploader: parsed.uploader,
      description: parsed.description,
      thumbnail: parsed.thumbnail,
      webpageUrl: parsed.webpage_url,
      extractor: parsed.extractor,
      playlistCount: toNumber(parsed.playlist_count),
      rawJson: JSON.stringify(raw),
      entries,
    };
  } catch (err) {
    logger.debug(
      `Playlist extraction attempt produced invalid output: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function extractPlaylist(
  config: AppConfig,
  logger: Logger,
): Promise<ExtractedPlaylist> {
  logger.info("Extracting playlist metadata...");

  // YouTube/yt-dlp sometimes returns only the first page (~100 items) of
  // large playlists. Retry a few times with different extractor options and
  // keep the most complete result. Single-video URLs have no playlist_count,
  // so we stop after the first successful attempt.
  const attempts: { extraArgs: string[]; label: string }[] = [
    { extraArgs: [], label: "default" },
    { extraArgs: [], label: "retry" },
    { extraArgs: ["--extractor-args", "youtubetab:skip=webpage"], label: "skip-webpage" },
  ];

  let best: ExtractedPlaylist | null = null;

  for (let i = 0; i < attempts.length; i++) {
    const { extraArgs, label } = attempts[i];

    if (i > 0) {
      const delay = 1000 * 2 ** (i - 1);
      logger.warn(
        `Playlist extraction looks incomplete (${best?.entries.length ?? 0} of ${best?.playlistCount ?? "?"}). Retrying with ${label} in ${delay}ms...`,
      );
      await sleep(delay);
    }

    const result = await tryExtract(config, extraArgs, logger);
    if (!result) continue;

    if (!best || result.entries.length > best.entries.length) {
      best = result;
    }

    // Single video or fully extracted playlist: stop retrying.
    if (
      result.playlistCount === null ||
      result.entries.length >= result.playlistCount
    ) {
      break;
    }
  }

  if (!best) {
    throw new Error("yt-dlp failed to extract playlist after multiple attempts");
  }

  if (
    best.playlistCount &&
    best.entries.length < best.playlistCount
  ) {
    logger.warn(
      `Playlist has ${best.playlistCount} tracks but only ${best.entries.length} could be extracted. ` +
        `Missing tracks may be unavailable, region-blocked, or hidden by YouTube pagination.`,
    );
  }

  logger.success(
    `Found ${best.entries.length} track${best.entries.length === 1 ? "" : "s"} in playlist`,
  );

  return best;
}
