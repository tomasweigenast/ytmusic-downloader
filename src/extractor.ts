import { $ } from "bun";
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
  rawJson: string;
  entries: PlaylistEntry[];
}

function buildArgs(config: AppConfig): string[] {
  const args = [
    config.ytdlpBinPath,
    "--flat-playlist",
    "--dump-single-json",
    "--no-warnings",
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

export async function extractPlaylist(
  config: AppConfig,
  logger: Logger,
): Promise<ExtractedPlaylist> {
  logger.info("Extracting playlist metadata...");

  const args = buildArgs(config);
  logger.debug(`Running: ${args.join(" ")}`);

  const result = await $`${args}`.nothrow();

  if (result.exitCode !== 0) {
    throw new Error(
      `yt-dlp failed to extract playlist:\n${result.stderr.toString()}`,
    );
  }

  const raw = JSON.parse(result.stdout.toString()) as unknown;
  const parsed = ytdlpPlaylistSchema.parse(raw);

  let entries: PlaylistEntry[] = parsed.entries
    .map((entry, index) => {
      if (typeof entry !== "object" || entry === null) return null;

      const e = entry as Record<string, unknown>;
      const id = String(e.id ?? "");
      const url = String(
        e.url ?? e.webpage_url ?? e.original_url ?? `https://youtu.be/${id}`,
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

  logger.success(
    `Found ${entries.length} track${entries.length === 1 ? "" : "s"} in playlist`,
  );

  return {
    title: parsed.title,
    uploader: parsed.uploader,
    description: parsed.description,
    thumbnail: parsed.thumbnail,
    webpageUrl: parsed.webpage_url,
    extractor: parsed.extractor,
    rawJson: JSON.stringify(raw),
    entries,
  };
}
