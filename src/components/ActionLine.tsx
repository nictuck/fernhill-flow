// The one action line (R2): a deep link, or a copyable command with its
// "View …" link. Commands are never links pretending to run them.

import { useRef, useState } from "react";
import type { Action } from "../engine/types.ts";
import { ExtLink } from "./ExtLink.tsx";

function selectText(el: HTMLElement | null) {
  if (!el) return;
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function Copyable({ command }: { command: string }) {
  const codeRef = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      selectText(codeRef.current);
    }
  }

  return (
    <span className="cmd">
      <code ref={codeRef}>{command}</code>
      <button type="button" aria-label={`Copy ${command}`} onClick={() => void copy()}>
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

export function ActionLine({ action }: { action: Action }) {
  if (action.copy) {
    return (
      <>
        <Copyable command={action.copy} />
        {action.secondary && <ExtLink href={action.secondary.href}>{action.secondary.text}</ExtLink>}
      </>
    );
  }
  return <ExtLink href={action.href}>{action.text}</ExtLink>;
}
