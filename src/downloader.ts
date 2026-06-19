import { readdir, readFile, unlink } from "fs/promises";
import { join } from "path";
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

const PROGRESS_RE = /^download:(\S+)\s+(\S+)(?:\s+(\S+))?\s*(?:\s+ETA\s+(\S+))?/;

function buildArgs(
  config: AppConfig,
  entry: PlaylistEntry,
): string[] {
  const args = [
    config.ytdlpBinPath,
    "-f",
    "bestaudio[ext=webm]/bestaudio/best",
    "--extract-audio",
    "--audio-quality",
    "0",
    "--audio-format",
    "best",
    "--embed-metadata",
    "--embed-thumbnail",
    "--convert-thumbnails",
    "jpg",
    "--write-info-json",
    "--no-clean-info-json",
    "--continue",
    "--no-overwrites",
    "--no-warnings",
    "--newline",
    "--progress-template",
    "download:%(info.id)s %(progress._percent_str)s %(progress._speed_str)s ETA %(progress._eta_str)s",
    "--parse-metadata",
    "playlist_index:%(track_number)s",
    "--output",
    join(config.outputDir, config.filenameTemplate),
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

function parseProgressLine(line: string): ProgressUpdate | null {
  const match = PROGRESS_RE.exec(line);
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

async function spawnYtdlp(
  args: string[],
  onProgress: (update: ProgressUpdate) => void,
  logger: Logger,
): Promise<{ exitCode: number; error: string }> {
  logger.debug(`Running: ${args.join(" ")}`);

  const proc = Bun.spawn(args, {
    stdout: "inherit",
    stderr: "pipe",
  });

  const decoder = new TextDecoder();
  let stderrBuffer = "";
  let errorSummary = "";

  // Bun.spawn's stderr is a ReadableStream<Uint8Array>
  const reader = proc.stderr.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      stderrBuffer += decoder.decode(value, { stream: true });
      const lines = stderrBuffer.split("\n");
      stderrBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const progress = parseProgressLine(line);
        if (progress) {
          onProgress(progress);
          continue;
        }

        // Keep the last non-progress error line for diagnostics
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("[download]") && !trimmed.startsWith("[ExtractAudio]") && !trimmed.startsWith("[Metadata]") && !trimmed.startsWith("[ThumbnailsConvertor]")) {
          errorSummary = trimmed;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

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
  const args = buildArgs(config, entry);

  const { exitCode, error } = await spawnYtdlp(
    args,
    (update) => onProgress?.(update),
    logger,
  );

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

    const info = JSON.parse(rawJson) as { _filename?: string };
    const filepath = info._filename ?? null;

    const song = saveSongMetadata(
      db,
      playlistId,
      normalized,
      filepath,
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
      "failed",
      error,
    );

    return { success: false, song, error };
  }
}
