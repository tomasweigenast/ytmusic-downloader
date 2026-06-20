import { z } from "zod";

export const cliFlagsSchema = z.object({
  playlistUrl: z.string().url(),
  outputDir: z.string().default("./downloads"),
  workers: z.coerce.number().int().min(1).max(20).default(5),
  retries: z.coerce.number().int().min(0).max(10).default(3),
  cookiesFromBrowser: z.string().optional(),
  cookies: z.string().optional(),
  filenameTemplate: z
    .string()
    .default("%(title)s - %(album)s - %(artist)s.%(ext)s"),
  skipUpdate: z.boolean().default(false),
  verbose: z.boolean().default(false),
  ytdlpChannel: z.enum(["stable", "nightly"]).default("stable"),
  opus: z.boolean().default(false),
});

export type CliFlags = z.infer<typeof cliFlagsSchema>;

export const ytdlpTrackSchema = z.object({
  id: z.string(),
  title: z.string().default("Unknown Title"),
  artist: z.string().nullable().default(null),
  album: z.string().nullable().default(null),
  album_artist: z.string().nullable().default(null),
  track: z.string().nullable().default(null),
  track_number: z.union([z.number(), z.string()]).nullable().default(null),
  release_year: z.union([z.number(), z.string()]).nullable().default(null),
  genre: z.string().nullable().default(null),
  duration: z.number().nullable().default(null),
  webpage_url: z.string().nullable().default(null),
  original_url: z.string().nullable().default(null),
  extractor: z.string().default("generic"),
  thumbnail: z.string().nullable().default(null),
  playlist_index: z.union([z.number(), z.string()]).nullable().default(null),
  filesize: z.number().nullable().default(null),
  acodec: z.string().nullable().default(null),
  abr: z.union([z.number(), z.string()]).nullable().default(null),
  asr: z.union([z.number(), z.string()]).nullable().default(null),
  audio_channels: z.union([z.number(), z.string()]).nullable().default(null),
});

export type YtdlpTrack = z.infer<typeof ytdlpTrackSchema>;

export const ytdlpPlaylistSchema = z.object({
  id: z.string(),
  title: z.string().default("Unknown Playlist"),
  uploader: z.string().nullable().default(null),
  uploader_id: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  thumbnail: z.string().nullable().default(null),
  webpage_url: z.string().nullable().default(null),
  original_url: z.string().nullable().default(null),
  extractor: z.string().default("generic"),
  playlist_count: z.union([z.number(), z.string()]).nullable().default(null),
  entries: z.array(z.unknown()).default([]),
});

export type YtdlpPlaylist = z.infer<typeof ytdlpPlaylistSchema>;

export interface PlaylistEntry {
  id: string;
  url: string;
  title: string;
  playlistIndex: number;
}

export type DownloadStatus = "pending" | "complete" | "failed";

export interface Artist {
  id: number;
  name: string;
  sourceId: string | null;
}

export interface Album {
  id: number;
  title: string;
  artistId: number | null;
  sourceId: string | null;
  releaseYear: number | null;
}

export interface Song {
  id: number;
  playlistId: number;
  albumId: number | null;
  artistId: number | null;
  sourceId: string;
  trackNumber: number | null;
  title: string;
  duration: number | null;
  webpageUrl: string | null;
  thumbnail: string | null;
  filepath: string | null;
  thumbnailPath: string | null;
  filesize: number | null;
  codec: string | null;
  bitrate: number | null;
  sampleRate: number | null;
  channels: number | null;
  downloadStatus: DownloadStatus;
  errorMessage: string | null;
  rawJson: string;
}

export interface Playlist {
  id: number;
  url: string;
  title: string;
  uploader: string | null;
  description: string | null;
  thumbnail: string | null;
  trackCount: number;
  rawJson: string;
}
