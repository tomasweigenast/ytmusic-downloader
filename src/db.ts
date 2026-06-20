import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";
import type {
  Album,
  Artist,
  DownloadStatus,
  Playlist,
  Song,
} from "./types.ts";

const MIGRATIONS = [
  `
  CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL DEFAULT 'Unknown Playlist',
    uploader TEXT,
    description TEXT,
    thumbnail TEXT,
    track_count INTEGER,
    raw_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS artists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    source_id TEXT,
    raw_json TEXT
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS albums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    artist_id INTEGER,
    source_id TEXT UNIQUE,
    release_year INTEGER,
    raw_json TEXT,
    FOREIGN KEY (artist_id) REFERENCES artists(id)
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id INTEGER NOT NULL,
    album_id INTEGER,
    artist_id INTEGER,
    source_id TEXT NOT NULL,
    track_number INTEGER,
    title TEXT NOT NULL,
    duration REAL,
    webpage_url TEXT,
    thumbnail TEXT,
    filepath TEXT,
    filesize INTEGER,
    codec TEXT,
    bitrate INTEGER,
    sample_rate INTEGER,
    channels INTEGER,
    download_status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    raw_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (playlist_id) REFERENCES playlists(id),
    FOREIGN KEY (album_id) REFERENCES albums(id),
    FOREIGN KEY (artist_id) REFERENCES artists(id),
    UNIQUE(playlist_id, source_id)
  );
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_songs_playlist ON songs(playlist_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_songs_album ON songs(album_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist_id);
  `,
];

export class MetadataDatabase {
  private readonly db: Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.run("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    for (const migration of MIGRATIONS) {
      this.db.run(migration);
    }
  }

  close(): void {
    this.db.close();
  }

  insertPlaylist(playlist: {
    url: string;
    title: string;
    uploader: string | null;
    description: string | null;
    thumbnail: string | null;
    trackCount: number;
    rawJson: string;
  }): Playlist {
    const insert = this.db.query(
      `INSERT INTO playlists (url, title, uploader, description, thumbnail, track_count, raw_json)
       VALUES ($url, $title, $uploader, $description, $thumbnail, $trackCount, $rawJson)
       ON CONFLICT(url) DO UPDATE SET
         title = excluded.title,
         uploader = excluded.uploader,
         description = excluded.description,
         thumbnail = excluded.thumbnail,
         track_count = excluded.track_count,
         raw_json = excluded.raw_json
       RETURNING *;`,
    );
    return this.mapPlaylist(
      insert.get({
        $url: playlist.url,
        $title: playlist.title,
        $uploader: playlist.uploader,
        $description: playlist.description,
        $thumbnail: playlist.thumbnail,
        $trackCount: playlist.trackCount,
        $rawJson: playlist.rawJson,
      }) as Record<string, unknown>,
    );
  }

  getOrCreateArtist(name: string, sourceId: string | null): Artist {
    const existing = this.db.query(
      "SELECT * FROM artists WHERE name = $name;",
    );
    const row = existing.get({ $name: name }) as Record<string, unknown> | null;
    if (row) return this.mapArtist(row);

    const insert = this.db.query(
      `INSERT INTO artists (name, source_id, raw_json)
       VALUES ($name, $sourceId, $rawJson)
       RETURNING *;`,
    );
    return this.mapArtist(
      insert.get({
        $name: name,
        $sourceId: sourceId,
        $rawJson: JSON.stringify({ name, sourceId }),
      }) as Record<string, unknown>,
    );
  }

  getOrCreateAlbum(album: {
    title: string;
    artistId: number | null;
    sourceId: string | null;
    releaseYear: number | null;
  }): Album {
    if (album.sourceId) {
      const bySource = this.db.query(
        "SELECT * FROM albums WHERE source_id = $sourceId;",
      );
      const row = bySource.get({
        $sourceId: album.sourceId,
      }) as Record<string, unknown> | null;
      if (row) return this.mapAlbum(row);
    }

    const byTitleArtist = this.db.query(
      "SELECT * FROM albums WHERE title = $title AND artist_id IS $artistId;",
    );
    const row = byTitleArtist.get({
      $title: album.title,
      $artistId: album.artistId,
    }) as Record<string, unknown> | null;
    if (row) return this.mapAlbum(row);

    const insert = this.db.query(
      `INSERT INTO albums (title, artist_id, source_id, release_year, raw_json)
       VALUES ($title, $artistId, $sourceId, $releaseYear, $rawJson)
       RETURNING *;`,
    );
    return this.mapAlbum(
      insert.get({
        $title: album.title,
        $artistId: album.artistId,
        $sourceId: album.sourceId,
        $releaseYear: album.releaseYear,
        $rawJson: JSON.stringify(album),
      }) as Record<string, unknown>,
    );
  }

  insertOrUpdateSong(song: {
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
    filesize: number | null;
    codec: string | null;
    bitrate: number | null;
    sampleRate: number | null;
    channels: number | null;
    downloadStatus: DownloadStatus;
    errorMessage: string | null;
    rawJson: string;
  }): Song {
    const insert = this.db.query(
      `INSERT INTO songs (
         playlist_id, album_id, artist_id, source_id, track_number, title,
         duration, webpage_url, thumbnail, filepath, filesize, codec, bitrate,
         sample_rate, channels, download_status, error_message, raw_json
       ) VALUES (
         $playlistId, $albumId, $artistId, $sourceId, $trackNumber, $title,
         $duration, $webpageUrl, $thumbnail, $filepath, $filesize, $codec, $bitrate,
         $sampleRate, $channels, $downloadStatus, $errorMessage, $rawJson
       )
       ON CONFLICT(playlist_id, source_id) DO UPDATE SET
         album_id = excluded.album_id,
         artist_id = excluded.artist_id,
         track_number = excluded.track_number,
         title = excluded.title,
         duration = excluded.duration,
         webpage_url = excluded.webpage_url,
         thumbnail = excluded.thumbnail,
         filepath = excluded.filepath,
         filesize = excluded.filesize,
         codec = excluded.codec,
         bitrate = excluded.bitrate,
         sample_rate = excluded.sample_rate,
         channels = excluded.channels,
         download_status = excluded.download_status,
         error_message = excluded.error_message,
         raw_json = excluded.raw_json,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *;`,
    );
    return this.mapSong(
      insert.get({
        $playlistId: song.playlistId,
        $albumId: song.albumId,
        $artistId: song.artistId,
        $sourceId: song.sourceId,
        $trackNumber: song.trackNumber,
        $title: song.title,
        $duration: song.duration,
        $webpageUrl: song.webpageUrl,
        $thumbnail: song.thumbnail,
        $filepath: song.filepath,
        $filesize: song.filesize,
        $codec: song.codec,
        $bitrate: song.bitrate,
        $sampleRate: song.sampleRate,
        $channels: song.channels,
        $downloadStatus: song.downloadStatus,
        $errorMessage: song.errorMessage,
        $rawJson: song.rawJson,
      }) as Record<string, unknown>,
    );
  }

  updateSongFilepath(id: number, filepath: string): void {
    this.db.run(
      "UPDATE songs SET filepath = $filepath, updated_at = CURRENT_TIMESTAMP WHERE id = $id;",
      { $id: id, $filepath: filepath },
    );
  }

  getSongByPlaylistAndSource(
    playlistId: number,
    sourceId: string,
  ): Song | null {
    const query = this.db.query(
      "SELECT * FROM songs WHERE playlist_id = $playlistId AND source_id = $sourceId;",
    );
    const row = query.get({
      $playlistId: playlistId,
      $sourceId: sourceId,
    }) as Record<string, unknown> | null;
    return row ? this.mapSong(row) : null;
  }

  private mapPlaylist(row: Record<string, unknown>): Playlist {
    return {
      id: row.id as number,
      url: row.url as string,
      title: row.title as string,
      uploader: row.uploader as string | null,
      description: row.description as string | null,
      thumbnail: row.thumbnail as string | null,
      trackCount: row.track_count as number,
      rawJson: row.raw_json as string,
    };
  }

  private mapArtist(row: Record<string, unknown>): Artist {
    return {
      id: row.id as number,
      name: row.name as string,
      sourceId: row.source_id as string | null,
    };
  }

  private mapAlbum(row: Record<string, unknown>): Album {
    return {
      id: row.id as number,
      title: row.title as string,
      artistId: row.artist_id as number | null,
      sourceId: row.source_id as string | null,
      releaseYear: row.release_year as number | null,
    };
  }

  private mapSong(row: Record<string, unknown>): Song {
    return {
      id: row.id as number,
      playlistId: row.playlist_id as number,
      albumId: row.album_id as number | null,
      artistId: row.artist_id as number | null,
      sourceId: row.source_id as string,
      trackNumber: row.track_number as number | null,
      title: row.title as string,
      duration: row.duration as number | null,
      webpageUrl: row.webpage_url as string | null,
      thumbnail: row.thumbnail as string | null,
      filepath: row.filepath as string | null,
      filesize: row.filesize as number | null,
      codec: row.codec as string | null,
      bitrate: row.bitrate as number | null,
      sampleRate: row.sample_rate as number | null,
      channels: row.channels as number | null,
      downloadStatus: row.download_status as DownloadStatus,
      errorMessage: row.error_message as string | null,
      rawJson: row.raw_json as string,
    };
  }
}
