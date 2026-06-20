import { existsSync, readdirSync } from "fs";
import { basename, extname, join } from "path";
import type { MetadataDatabase } from "./db.ts";
import type { PlaylistEntry, Song } from "./types.ts";

export interface ResumeCheckResult {
  skip: boolean;
  existingSong: Song | null;
}

const AUDIO_EXTENSIONS = new Set([".opus", ".m4a", ".mp3", ".ogg", ".flac", ".wav", ".webm", ".aac"]);

function findAudioByStem(outputDir: string, filepath: string): string | null {
  const stem = basename(filepath, extname(filepath));
  try {
    const files = readdirSync(outputDir);
    const match = files.find((f) => {
      const ext = extname(f);
      return AUDIO_EXTENSIONS.has(ext) && f.slice(0, f.length - ext.length) === stem;
    });
    return match ? join(outputDir, match) : null;
  } catch {
    return null;
  }
}

export function checkExistingDownload(
  db: MetadataDatabase,
  playlistId: number,
  entry: PlaylistEntry,
  outputDir?: string,
): ResumeCheckResult {
  const existing = db.getSongByPlaylistAndSource(playlistId, entry.id);

  if (!existing) {
    return { skip: false, existingSong: null };
  }

  if (existing.downloadStatus === "complete" && existing.filepath) {
    if (existsSync(existing.filepath)) {
      return { skip: true, existingSong: existing };
    }

    if (outputDir) {
      const actual = findAudioByStem(outputDir, existing.filepath);
      if (actual) {
        db.updateSongFilepath(existing.id, actual);
        return { skip: true, existingSong: { ...existing, filepath: actual } };
      }
    }
  }

  return { skip: false, existingSong: existing };
}
