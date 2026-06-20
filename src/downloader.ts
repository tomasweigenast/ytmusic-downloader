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
}

const PROGRESS_RE = /^(\S+)\s+(\S+%)\s+(\S+)\s+ETA\s+(\S+)/;

function buildArgs(
  config: AppConfig,
  entry: PlaylistEntry,
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

  let errorSummary = "";

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
      // Keep the last non-progress error line for diagnostics
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("[download]") && !trimmed.startsWith("[ExtractAudio]") && !trimmed.startsWith("[Metadata]") && !trimmed.startsWith("[ThumbnailsConvertor]")) {
        errorSummary = trimmed;
      }
    });
  };

  await Promise.all([readStdout(), readStderr()]);
  const exitCode = await proc.exited;

  return { exitCode, error: errorSummary };
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
  const args = buildArgs(config, entry);

  const { exitCode, error } = await spawnYtdlp(
    args,
    (update) => onProgress?.(update),
    logger,
  );

  const thumbDir = join(config.outputDir, "thumbnails");

  if (exitCode !== 0) {
    const message = error || "yt-dlp exited with errors";
    const normalized = normalizeMetadata(JSON.stringify({
      id: entry.id,
      title: entry.title,
      playlist_index: entry.playlistIndex,
    }));

    const song = saveSongMetadata(
      db,
      playlistId,
      normalized,
      null,
      null,
      "failed",
      message,
    );

    return { success: false, song, error: message };
  }

  try {
    const infoJsonPath = await findInfoJson(config.outputDir, entry.id);
    if (!infoJsonPath) {
      throw new Error(
        `Could not find info JSON for track ${entry.id} after download`,
      );
    }

    const rawJson = await readFile(infoJsonPath, "utf-8");
    const normalized = normalizeMetadata(rawJson);

    const [filepath, thumbnailPath] = await Promise.all([
      findAudioFile(config.outputDir, infoJsonPath),
      findThumbnailFile(thumbDir, entry.id),
    ]);

    const song = saveSongMetadata(
      db,
      playlistId,
      normalized,
      filepath,
      thumbnailPath,
      "complete",
      null,
    );

    await unlink(infoJsonPath);
    logger.debug(`Deleted info JSON: ${infoJsonPath}`);

    return { success: true, song, error: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const normalized = normalizeMetadata(JSON.stringify({
      id: entry.id,
      title: entry.title,
      playlist_index: entry.playlistIndex,
    }));

    const song = saveSongMetadata(
      db,
      playlistId,
      normalized,
      null,
      null,
      "failed",
      error,
    );

    return { success: false, song, error };
  }
}
