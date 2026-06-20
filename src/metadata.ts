import type { MetadataDatabase } from "./db.ts";
import type { Album, Artist, Song } from "./types.ts";

export interface NormalizedSong {
  sourceId: string;
  trackNumber: number | null;
  title: string;
  artistName: string | null;
  artistSourceId: string | null;
  albumTitle: string | null;
  albumSourceId: string | null;
  albumArtistName: string | null;
  releaseYear: number | null;
  genre: string | null;
  duration: number | null;
  webpageUrl: string | null;
  thumbnail: string | null;
  codec: string | null;
  bitrate: number | null;
  sampleRate: number | null;
  channels: number | null;
  filesize: number | null;
  rawJson: string;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "string" ? Number.parseFloat(value) : Number(value);
  return Number.isFinite(n) ? n : null;
}

function extractArtistName(raw: Record<string, unknown>): string | null {
  if (Array.isArray(raw.artists) && raw.artists.length > 0) {
    const first = raw.artists[0];
    if (typeof first === "string") return first;
    if (typeof first === "object" && first !== null) {
      const name = (first as Record<string, unknown>).name;
      if (typeof name === "string") return name;
    }
  }

  if (typeof raw.artist === "string" && raw.artist) {
    return raw.artist;
  }

  if (typeof raw.creator === "string" && raw.creator) {
    return raw.creator;
  }

  if (typeof raw.uploader === "string" && raw.uploader) {
    return raw.uploader;
  }

  return null;
}

function extractAlbumTitle(raw: Record<string, unknown>): string | null {
  if (typeof raw.album === "string" && raw.album) return raw.album;
  if (typeof raw.album_name === "string" && raw.album_name) return raw.album_name;
  return null;
}

export function normalizeMetadata(rawJson: string): NormalizedSong {
  const raw = JSON.parse(rawJson) as Record<string, unknown>;

  const artistName = extractArtistName(raw);
  const albumArtistName =
    typeof raw.album_artist === "string" && raw.album_artist
      ? raw.album_artist
      : artistName;
  const albumTitle = extractAlbumTitle(raw);

  return {
    sourceId: String(raw.id ?? ""),
    trackNumber: toNumber(raw.track_number ?? raw.track ?? raw.playlist_index),
    title: String(raw.title ?? "Unknown Title"),
    artistName,
    artistSourceId:
      typeof raw.artist_id === "string" ? raw.artist_id : null,
    albumTitle,
    albumSourceId:
      typeof raw.album_id === "string" ? raw.album_id : null,
    albumArtistName,
    releaseYear: toNumber(raw.release_year ?? raw.release_date),
    genre: typeof raw.genre === "string" ? raw.genre : null,
    duration: toNumber(raw.duration),
    webpageUrl:
      typeof raw.webpage_url === "string" ? raw.webpage_url : null,
    thumbnail: typeof raw.thumbnail === "string" ? raw.thumbnail : null,
    codec: typeof raw.acodec === "string" ? raw.acodec : null,
    bitrate: toNumber(raw.abr),
    sampleRate: toNumber(raw.asr),
    channels: toNumber(raw.audio_channels),
    filesize: toNumber(raw.filesize ?? raw.filesize_approx),
    rawJson,
  };
}

export function saveSongMetadata(
  db: MetadataDatabase,
  playlistId: number,
  normalized: NormalizedSong,
  filepath: string | null,
  thumbnailPath: string | null,
  status: "complete" | "failed",
  errorMessage: string | null,
): Song {
  let artist: Artist | null = null;
  if (normalized.artistName) {
    artist = db.getOrCreateArtist(
      normalized.artistName,
      normalized.artistSourceId,
    );
  }

  let album: Album | null = null;
  if (normalized.albumTitle) {
    album = db.getOrCreateAlbum({
      title: normalized.albumTitle,
      artistId: artist?.id ?? null,
      sourceId: normalized.albumSourceId,
      releaseYear: normalized.releaseYear,
    });
  }

  return db.insertOrUpdateSong({
    playlistId: playlistId,
    albumId: album?.id ?? null,
    artistId: artist?.id ?? null,
    sourceId: normalized.sourceId,
    trackNumber: normalized.trackNumber,
    title: normalized.title,
    duration: normalized.duration,
    webpageUrl: normalized.webpageUrl,
    thumbnail: normalized.thumbnail,
    filepath,
    thumbnailPath,
    filesize: normalized.filesize,
    codec: normalized.codec,
    bitrate: normalized.bitrate,
    sampleRate: normalized.sampleRate,
    channels: normalized.channels,
    downloadStatus: status,
    errorMessage: errorMessage,
    rawJson: normalized.rawJson,
  });
}
