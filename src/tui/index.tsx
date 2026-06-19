import { render } from "ink";
import { App } from "./app.tsx";

export function renderTui(): { unmount: () => void } {
  const instance = render(<App />);
  return { unmount: instance.unmount };
}
