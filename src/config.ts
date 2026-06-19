import { homedir, platform } from "os";
import { join, resolve } from "path";
import type { CliFlags } from "./types.ts";

export interface AppConfig extends CliFlags {
  databasePath: string;
  ytdlpCacheDir: string;
  ytdlpBinPath: string;
}

function getCacheDir(): string {
  const home = homedir();

  switch (platform()) {
    case "win32": {
      const localAppData = process.env.LOCALAPPDATA;
      if (localAppData) return join(localAppData, "ytmusic-downloader");
      return join(home, "AppData", "Local", "ytmusic-downloader");
    }
    case "darwin":
      return join(home, "Library", "Caches", "ytmusic-downloader");
    default:
      return join(
        process.env.XDG_CACHE_HOME ?? join(home, ".cache"),
        "ytmusic-downloader",
      );
  }
}

export function buildConfig(flags: CliFlags): AppConfig {
  const outputDir = resolve(flags.outputDir);
  const ytdlpCacheDir = getCacheDir();
  const ytdlpBinName = platform() === "win32" ? "yt-dlp.exe" : "yt-dlp";

  return {
    ...flags,
    outputDir,
    databasePath: join(outputDir, "metadata.sqlite"),
    ytdlpCacheDir,
    ytdlpBinPath: join(ytdlpCacheDir, ytdlpBinName),
  };
}
