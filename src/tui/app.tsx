import { Box } from "ink";
import type { JSX } from "react";
import { ProgressPanel } from "./progress-panel.tsx";

export function App(): JSX.Element {
  return (
    <Box width="100%" height="100%" borderStyle="single" borderColor="gray">
      <ProgressPanel />
    </Box>
  );
}
