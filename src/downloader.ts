import { readdir, readFile, unlink, mkdir } from "fs/promises";
import { join, basename, extname } from "path";
import type { AppConfig } from "./config.ts";
import type { MetadataDatabase } from "./db.ts";
import { normalizeMetadata, saveSongMetadata } from "./metadata.ts";
import type { PlaylistEntry, Song } from "./types.ts";
import type { Logger } from "./utils.ts";

export interface DownloadResult {
  success: boolean;
  song: Song | null;
  error: string | null;
}

export interface ProgressUpdate {
  percent: number;
  speed: string;
  eta: string;
  actualId: string | null;
}

const PROGRESS_RE = /^(\S+)\s+(\S+%)\s+(\S+)\s+ETA\s+(\S+)/;

const PLAYER_CLIENT_FALLBACK_ORDER = [
  "web_music",
  "android_music",
  "ios",
  "android",
  "web",
] as const;

type PlayerClient = (typeof PLAYER_CLIENT_FALLBACK_ORDER)[number];

function buildArgs(
  config: AppConfig,
  entry: PlaylistEntry,
  playerClient: PlayerClient = "web_music",
): string[] {
  const args = [
    config.ytdlpBinPath,
    "-f",
    config.opus
      ? "bestaudio[ext=webm]/bestaudio[ext=opus]/bestaudio/best"
      : "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best",
    "--extract-audio",
    "--audio-quality",
    "0",
    "--audio-format",
    config.opus ? "opus" : "m4a",
    "--embed-metadata",
    "--embed-thumbnail",
    "--convert-thumbnails",
    "jpg",
    "--write-thumbnail",
    "--write-info-json",
    "--no-clean-info-json",
    "--continue",
    "--no-overwrites",
    "--no-colors",
    "--newline",
    "--extractor-args",
    `youtube:player_client=${playerClient}`,
    "--progress-template",
    "download:%(info.id)s %(progress._percent_str)s %(progress._speed_str)s ETA %(progress._eta_str)s",
    "--parse-metadata",
    "playlist_index:%(track_number)s",
    "--output",
    join(config.outputDir, config.filenameTemplate),
    "--output",
    `thumbnail:${join(config.outputDir, "thumbnails", "%(id)s.%(ext)s")}`,
  ];

  if (config.cookiesFromBrowser) {
    args.push("--cookies-from-browser", config.cookiesFromBrowser);
  }

  if (config.cookies) {
    args.push("--cookies", config.cookies);
  }

  args.push(entry.url);
  return args;
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function parseProgressLine(line: string): ProgressUpdate | null {
  const cleaned = stripAnsi(line.trim());
  const match = PROGRESS_RE.exec(cleaned);
  if (!match) return null;

  const percentStr = match[2];
  const percent = Number.parseFloat(percentStr.replace("%", ""));
  if (!Number.isFinite(percent)) return null;

  return {
    percent,
    speed: match[3] ?? "",
    eta: match[4] ?? "",
    actualId: match[1] ?? null,
  };
}

const AUDIO_EXTENSIONS = new Set([".opus", ".m4a", ".mp3", ".ogg", ".flac", ".wav", ".webm", ".aac"]);

async function findInfoJson(outputDir: string, sourceId: string): Promise<string | null> {
  const files = await readdir(outputDir);
  const candidates = files.filter((f) => f.endsWith(".info.json"));

  for (const file of candidates) {
    const path = join(outputDir, file);
    try {
      const content = await readFile(path, "utf-8");
      const data = JSON.parse(content) as { id?: string };
      if (data.id === sourceId) {
        return path;
      }
    } catch {
      // ignore malformed files
    }
  }

  return null;
}

async function findAudioFile(outputDir: string, infoJsonPath: string): Promise<string | null> {
  const stem = basename(infoJsonPath, ".info.json");
  const files = await readdir(outputDir);
  const match = files.find((f) => {
    const ext = extname(f);
    return AUDIO_EXTENSIONS.has(ext) && f.slice(0, f.length - ext.length) === stem;
  });
  return match ? join(outputDir, match) : null;
}

const THUMBNAIL_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

async function findThumbnailFile(thumbDir: string, sourceId: string): Promise<string | null> {
  try {
    const files = await readdir(thumbDir);
    const match = files.find((f) => {
      const ext = extname(f);
      return THUMBNAIL_EXTENSIONS.has(ext) && basename(f, ext) === sourceId;
    });
    return match ? join(thumbDir, match) : null;
  } catch {
    return null;
  }
}

async function readLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        onLine(line);
      }
    }

    if (buffer) {
      onLine(buffer);
    }
  } finally {
    reader.releaseLock();
  }
}

async function spawnYtdlp(
  args: string[],
  onProgress: (update: ProgressUpdate) => void,
  logger: Logger,
): Promise<{ exitCode: number; error: string }> {
  logger.debug(`Running: ${args.join(" ")}`);

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
  });

  let errorLine = "";
  let lastRelevantLine = "";

  const readStdout = async (): Promise<void> => {
    await readLines(proc.stdout, (line) => {
      const progress = parseProgressLine(line);
      if (progress) {
        onProgress(progress);
      }
    });
  };

  const readStderr = async (): Promise<void> => {
    await readLines(proc.stderr, (line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("[download]") || trimmed.startsWith("[ExtractAudio]") || trimmed.startsWith("[Metadata]")) return;
      if (!errorLine && trimmed.startsWith("ERROR:")) {
        errorLine = trimmed;
      }
      lastRelevantLine = trimmed;
    });
  };

  await Promise.all([readStdout(), readStderr()]);
  const exitCode = await proc.exited;

  return { exitCode, error: errorLine || lastRelevantLine };
}

async function resolveRedirect(
  config: AppConfig,
  entry: PlaylistEntry,
  logger: Logger,
): Promise<PlaylistEntry> {
  // Try each player client — some clients surface the redirected video ID
  // while others fail on geo-restricted or replaced tracks.
  for (const client of PLAYER_CLIENT_FALLBACK_ORDER) {
    const resolveArgs = [
      config.ytdlpBinPath,
      "--no-download",
      "--print", "webpage_url",
      "--no-warnings",
      "--extractor-args", `youtube:player_client=${client}`,
    ];

    if (config.cookiesFromBrowser) {
      resolveArgs.push("--cookies-from-browser", config.cookiesFromBrowser);
    }
    if (config.cookies) {
      resolveArgs.push("--cookies", config.cookies);
    }

    resolveArgs.push(entry.url);

    const proc = Bun.spawn(resolveArgs, { stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const resolvedUrl = stdout.trim();
    if (!resolvedUrl) {
      logger.debug(`Redirect probe "${entry.title}" [${client}]: no output`);
      continue;
    }

    const match = /[?&]v=([a-zA-Z0-9_-]{11})/.exec(resolvedUrl);
    const resolvedId = match?.[1] ?? null;

    if (!resolvedId) {
      logger.debug(`Redirect probe "${entry.title}" [${client}]: unparseable URL: ${resolvedUrl}`);
      continue;
    }

    if (resolvedId !== entry.id) {
      logger.info(`Redirect resolved via ${client}: "${entry.title}" ${entry.id} → ${resolvedId}`);
      return { ...entry, id: resolvedId, url: `https://music.youtube.com/watch?v=${resolvedId}` };
    }

    // Same ID — no redirect, no need to try other clients
    logger.debug(`Redirect probe "${entry.title}" [${client}]: no redirect (${resolvedId})`);
    return entry;
  }

  return entry;
}

export async function downloadTrack(
  config: AppConfig,
  db: MetadataDatabase,
  playlistId: number,
  entry: PlaylistEntry,
  logger: Logger,
  onProgress?: (update: ProgressUpdate) => void,
): Promise<DownloadResult> {
  await mkdir(join(config.outputDir, "thumbnails"), { recursive: true });

  if (config.manualFollowRedirects) {
    entry = await resolveRedirect(config, entry, logger);
  }

  const thumbDir = join(config.outputDir, "thumbnails");
  let lastError = "";

  for (const playerClient of PLAYER_CLIENT_FALLBACK_ORDER) {
    const args = buildArgs(config, entry, playerClient);

    let resolvedId = entry.id;
    const { exitCode, error } = await spawnYtdlp(
      args,
      (update) => {
        if (update.actualId) resolvedId = update.actualId;
        onProgress?.(update);
      },
      logger,
    );

    if (resolvedId !== entry.id) {
      logger.info(`Track "${entry.title}" resolved by yt-dlp [${playerClient}]: ${entry.id} → ${resolvedId}`);
    }

    if (exitCode !== 0) {
      lastError = error || "yt-dlp exited with errors";
      const isUnavailable = lastError.includes("Video unavailable") || lastError.includes("This video is not available");

      const infoJsonPath = await findInfoJson(config.outputDir, resolvedId);
      if (infoJsonPath) {
        const stem = basename(infoJsonPath, ".info.json");
        await Promise.allSettled([
          unlink(infoJsonPath),
          ...Array.from(THUMBNAIL_EXTENSIONS).map((ext) => unlink(join(config.outputDir, stem + ext))),
          ...Array.from(AUDIO_EXTENSIONS).map((ext) => unlink(join(config.outputDir, stem + ext))),
        ]);
      }

      if (isUnavailable && playerClient !== PLAYER_CLIENT_FALLBACK_ORDER.at(-1)) {
        logger.warn(`"${entry.title}" unavailable with [${playerClient}], trying next client…`);
        continue;
      }

      const normalized = normalizeMetadata(JSON.stringify({
        id: entry.id,
        title: entry.title,
        playlist_index: entry.playlistIndex,
      }));

      const song = saveSongMetadata(db, playlistId, normalized, null, null, "failed", lastError);
      return { success: false, song, error: lastError };
    }

    try {
      const infoJsonPath = await findInfoJson(config.outputDir, resolvedId);
      if (!infoJsonPath) {
        throw new Error(`Could not find info JSON for track ${entry.id} (resolved: ${resolvedId}) after download`);
      }

      const rawJson = await readFile(infoJsonPath, "utf-8");
      const normalized = normalizeMetadata(rawJson);

      const [filepath, thumbnailPath] = await Promise.all([
        findAudioFile(config.outputDir, infoJsonPath),
        findThumbnailFile(thumbDir, resolvedId),
      ]);

      const song = saveSongMetadata(db, playlistId, normalized, filepath, thumbnailPath, "complete", null);

      await unlink(infoJsonPath);
      logger.debug(`Deleted info JSON: ${infoJsonPath}`);

      return { success: true, song, error: null };
    } catch (err) {
      const catchError = err instanceof Error ? err.message : String(err);
      const normalized = normalizeMetadata(JSON.stringify({
        id: entry.id,
        title: entry.title,
        playlist_index: entry.playlistIndex,
      }));

      const song = saveSongMetadata(db, playlistId, normalized, null, null, "failed", catchError);
      return { success: false, song, error: catchError };
    }
  }

  // Exhausted all player clients
  const normalized = normalizeMetadata(JSON.stringify({
    id: entry.id,
    title: entry.title,
    playlist_index: entry.playlistIndex,
  }));
  const song = saveSongMetadata(db, playlistId, normalized, null, null, "failed", lastError);
  return { success: false, song, error: lastError };
}
