import { Box } from "ink";
import type { JSX } from "react";
import { LogPanel } from "./log-panel.tsx";
import { ProgressPanel } from "./progress-panel.tsx";

export function App(): JSX.Element {
  return (
    <Box width="100%" height="100%">
      <Box width="50%" borderStyle="single" borderColor="gray">
        <ProgressPanel />
      </Box>
      <Box width="50%" borderStyle="single" borderColor="gray">
        <LogPanel />
      </Box>
    </Box>
  );
}
