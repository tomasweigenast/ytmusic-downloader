import { render } from "ink";
import type { CliFlags } from "../types.ts";
import { App } from "./app.tsx";
import { FormApp } from "./form-app.tsx";

function enterAltScreen(): void {
  process.stdout.write("\x1b[?1049h\x1b[2J\x1b[H");
}

function exitAltScreen(): void {
  process.stdout.write("\x1b[?1049l");
}

function clearAltScreen(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}

export async function runFormTui(): Promise<CliFlags | null> {
  enterAltScreen();

  return new Promise<CliFlags | null>((resolve) => {
    let settled = false;

    const { unmount } = render(
      <FormApp
        onSubmit={(flags) => {
          if (settled) return;
          settled = true;
          unmount();
          // Stay in alt screen — download TUI will clear and reuse it
          resolve(flags);
        }}
        onCancel={() => {
          if (settled) return;
          settled = true;
          unmount();
          exitAltScreen();
          resolve(null);
        }}
      />,
      { patchConsole: false },
    );
  });
}

export function renderDownloadTui(): { unmount: () => void } {
  // Reuse the existing alt screen (entered by runFormTui) or enter a new one
  if (process.stdout.isTTY) {
    clearAltScreen();
  } else {
    enterAltScreen();
  }

  const instance = render(<App />, { patchConsole: false });

  return {
    unmount: () => {
      instance.unmount();
      exitAltScreen();
    },
  };
}
