import { existsSync } from "fs";
import type { MetadataDatabase } from "./db.ts";
import type { PlaylistEntry, Song } from "./types.ts";

export interface ResumeCheckResult {
  skip: boolean;
  existingSong: Song | null;
}

export function checkExistingDownload(
  db: MetadataDatabase,
  playlistId: number,
  entry: PlaylistEntry,
): ResumeCheckResult {
  const existing = db.getSongByPlaylistAndSource(playlistId, entry.id);

  if (!existing) {
    return { skip: false, existingSong: null };
  }

  if (existing.downloadStatus === "complete" && existing.filepath) {
    if (existsSync(existing.filepath)) {
      return { skip: true, existingSong: existing };
    }
  }

  return { skip: false, existingSong: existing };
}
