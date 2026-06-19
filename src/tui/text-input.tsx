import { Text, useInput } from "ink";
import { useState, type JSX } from "react";

export interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  isActive: boolean;
  visibleWidth: number;
}

export function TextInput({
  value,
  onChange,
  placeholder,
  isActive,
  visibleWidth,
}: TextInputProps): JSX.Element {
  const [cursor, setCursor] = useState(() => value.length);

  useInput(
    (input, key) => {
      // Let navigation keys bubble to the parent form handler
      if (key.tab || key.escape || key.upArrow || key.downArrow) return;

      if (key.return) return;

      if (key.backspace) {
        if (cursor > 0) {
          onChange(value.slice(0, cursor - 1) + value.slice(cursor));
          setCursor((c) => c - 1);
        }
        return;
      }
      if (key.delete) {
        if (cursor < value.length) {
          onChange(value.slice(0, cursor) + value.slice(cursor + 1));
        }
        return;
      }
      if (key.leftArrow) {
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.rightArrow) {
        setCursor((c) => Math.min(value.length, c + 1));
        return;
      }
      if (key.ctrl) {
        if (input === "a") { setCursor(0); return; }
        if (input === "e") { setCursor(value.length); return; }
        if (input === "k") { onChange(value.slice(0, cursor)); return; }
        if (input === "u") { onChange(value.slice(cursor)); setCursor(0); return; }
        return;
      }
      if (input && !key.meta) {
        const next = value.slice(0, cursor) + input + value.slice(cursor);
        onChange(next);
        setCursor((c) => c + 1);
      }
    },
    { isActive },
  );

  const w = Math.max(1, visibleWidth);
  // Scroll the view so the cursor is always visible
  const scrollStart = cursor >= w ? cursor - w + 1 : 0;
  const visible = value.slice(scrollStart, scrollStart + w);
  const localCursor = cursor - scrollStart;

  if (value === "" && !isActive) {
    return <Text color="gray">{(placeholder ?? "").slice(0, w)}</Text>;
  }

  const before = visible.slice(0, localCursor);
  const at = visible[localCursor] ?? " ";
  const after = visible.slice(localCursor + 1);

  return (
    <Text>
      {before}
      {isActive ? <Text inverse>{at}</Text> : <Text>{at}</Text>}
      {after}
    </Text>
  );
}
