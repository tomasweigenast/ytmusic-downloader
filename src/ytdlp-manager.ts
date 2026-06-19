import { mkdirSync, chmodSync, existsSync } from "fs";
import { platform, arch } from "os";
import { $ } from "bun";
import type { AppConfig } from "./config.ts";
import type { Logger } from "./utils.ts";

const GITHUB_API_LATEST =
  "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const GITHUB_API_LATEST_NIGHTLY =
  "https://api.github.com/repos/yt-dlp/yt-dlp-nightly-builds/releases/latest";

interface BinarySpec {
  assetName: string;
  executableName: string;
}

function getBinarySpec(): BinarySpec {
  const isWindows = platform() === "win32";
  const isMac = platform() === "darwin";
  const isArm64 = arch() === "arm64";

  if (isWindows) {
    return {
      assetName: isArm64 ? "yt-dlp_arm64.exe" : "yt-dlp.exe",
      executableName: "yt-dlp.exe",
    };
  }

  if (isMac) {
    // yt-dlp_macos is a universal/amd64 standalone binary that also runs on
    // Apple Silicon via Rosetta 2. There is no separate arm64 macOS asset.
    return { assetName: "yt-dlp_macos", executableName: "yt-dlp" };
  }

  return {
    assetName: isArm64 ? "yt-dlp_linux_aarch64" : "yt-dlp_linux",
    executableName: "yt-dlp",
  };
}

function downloadUrl(
  assetName: string,
  version: string,
  channel: "stable" | "nightly",
): string {
  const repo =
    channel === "nightly"
      ? "yt-dlp/yt-dlp-nightly-builds"
      : "yt-dlp/yt-dlp";
  return `https://github.com/${repo}/releases/download/${version}/${assetName}`;
}

function latestVersionUrl(channel: "stable" | "nightly"): string {
  return channel === "nightly" ? GITHUB_API_LATEST_NIGHTLY : GITHUB_API_LATEST;
}

async function fetchLatestVersion(
  channel: "stable" | "nightly",
): Promise<string | null> {
  try {
    const response = await fetch(latestVersionUrl(channel), {
      headers: { Accept: "application/vnd.github+json" },
    });

    if (!response.ok) return null;

    const data = (await response.json()) as { tag_name?: string };
    return data.tag_name ?? null;
  } catch {
    return null;
  }
}

async function getLocalVersion(binPath: string): Promise<string | null> {
  if (!existsSync(binPath)) return null;

  try {
    const result = await $`"${binPath}" --version`.quiet();
    return result.stdout.toString().trim() || null;
  } catch {
    return null;
  }
}

async function downloadBinary(
  url: string,
  destination: string,
  logger: Logger,
): Promise<void> {
  logger.info(`Downloading yt-dlp from ${url}`);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to download yt-dlp: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.arrayBuffer();
  await Bun.write(destination, data);
}

export async function ensureYtdlp(
  config: AppConfig,
  logger: Logger,
): Promise<string> {
  const spec = getBinarySpec();
  const binPath = config.ytdlpBinPath;

  mkdirSync(config.ytdlpCacheDir, { recursive: true });

  if (config.skipUpdate) {
    if (!existsSync(binPath)) {
      throw new Error(
        `yt-dlp not found at ${binPath} and --no-update is set. Install it manually.`,
      );
    }
    logger.info(`Using existing yt-dlp (skipping update)`);
    return binPath;
  }

  logger.info(`Checking for yt-dlp ${config.ytdlpChannel} updates...`);
  const latestVersion = await fetchLatestVersion(config.ytdlpChannel);
  const localVersion = await getLocalVersion(binPath);
  // Stable releases are tagged like "2026.06.09"; nightly builds report
  // "2026.06.18.235958" (four dot-separated numeric groups).
  const localIsNightly =
    localVersion?.split(".").length === 4 &&
    /^\d+$/.test(localVersion.split(".").pop() ?? "");

  if (latestVersion && localVersion) {
    const channelMatches =
      config.ytdlpChannel === "nightly" ? localIsNightly : !localIsNightly;

    if (latestVersion === localVersion && channelMatches) {
      logger.success(`yt-dlp is up to date (${localVersion})`);
      return binPath;
    }

    // Avoid silently downgrading from a nightly build when stable is selected.
    // The user can explicitly switch back to stable by deleting the binary.
    if (config.ytdlpChannel === "stable" && localIsNightly) {
      logger.warn(
        `yt-dlp nightly (${localVersion}) is installed while stable channel is selected. ` +
          `Keeping nightly to avoid downgrading. Use --ytdlp-channel nightly to receive nightly updates.`,
      );
      return binPath;
    }
  }

  if (latestVersion) {
    logger.info(
      localVersion
        ? `Updating yt-dlp ${localVersion} → ${latestVersion}`
        : `Installing yt-dlp ${latestVersion}`,
    );
  } else {
    logger.warn(
      "Could not check latest yt-dlp version; attempting fresh download",
    );
  }

  const version = latestVersion ?? "latest";
  const url = downloadUrl(spec.assetName, version, config.ytdlpChannel);
  await downloadBinary(url, binPath, logger);

  if (platform() !== "win32") {
    chmodSync(binPath, 0o755);
  }

  const verifiedVersion = await getLocalVersion(binPath);
  if (!verifiedVersion) {
    throw new Error(`Downloaded yt-dlp binary at ${binPath} does not work`);
  }

  logger.success(`yt-dlp ready (${verifiedVersion})`);
  return binPath;
}
