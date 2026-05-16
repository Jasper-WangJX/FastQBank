// Renders a string mixing plain text and KaTeX math. Inline math is
// `$...$`, display math `$$...$$`, and `\$` is a literal dollar sign.
//
// Security: only KaTeX-generated HTML is injected via dangerouslySet-
// InnerHTML. The surrounding user text is rendered as React text nodes
// (auto-escaped), so a stem like `<img onerror=...>` can never execute.
// An unterminated `$` (user still typing in the live preview) degrades
// to plain text instead of throwing.

import { useMemo } from "react";
import katex from "katex";

interface Segment {
  kind: "text" | "math";
  value: string;
  display?: boolean;
}

function tokenize(input: string): Segment[] {
  const segs: Segment[] = [];
  let text = "";
  let i = 0;

  const flushText = () => {
    if (text) {
      segs.push({ kind: "text", value: text });
      text = "";
    }
  };

  while (i < input.length) {
    // Escaped dollar -> literal "$", never a delimiter.
    if (input[i] === "\\" && input[i + 1] === "$") {
      text += "$";
      i += 2;
      continue;
    }

    if (input[i] === "$") {
      const display = input[i + 1] === "$";
      const delim = display ? "$$" : "$";

      // Scan for the closing delimiter, skipping escaped \$.
      let j = i + delim.length;
      let close = -1;
      while (j < input.length) {
        if (input[j] === "\\" && input[j + 1] === "$") {
          j += 2;
          continue;
        }
        const hit = display
          ? input[j] === "$" && input[j + 1] === "$"
          : input[j] === "$";
        if (hit) {
          close = j;
          break;
        }
        j += 1;
      }

      if (close === -1) {
        // No closing delimiter yet — treat the remainder as plain text.
        text += input.slice(i);
        break;
      }

      flushText();
      segs.push({
        kind: "math",
        value: input.slice(i + delim.length, close),
        display,
      });
      i = close + delim.length;
      continue;
    }

    text += input[i];
    i += 1;
  }

  flushText();
  return segs;
}

export interface LatexProps {
  text: string;
  /** Optional wrapper classes (e.g. line clamping in the list rows). */
  className?: string;
}

export function Latex({ text, className }: LatexProps) {
  const segments = useMemo(() => tokenize(text ?? ""), [text]);

  return (
    <span className={className}>
      {segments.map((seg, idx) => {
        if (seg.kind === "text") {
          return <span key={idx}>{seg.value}</span>;
        }
        try {
          // throwOnError:false makes KaTeX render bad input as red inline
          // text (good while typing) instead of throwing.
          const html = katex.renderToString(seg.value, {
            throwOnError: false,
            displayMode: seg.display,
          });
          return (
            <span key={idx} dangerouslySetInnerHTML={{ __html: html }} />
          );
        } catch {
          // Last-resort guard: show the raw source as escaped text so a
          // render never crashes the page (never inject it as HTML).
          return (
            <span key={idx} className="text-red-600">
              {seg.display ? `$$${seg.value}$$` : `$${seg.value}$`}
            </span>
          );
        }
      })}
    </span>
  );
}

export default Latex;
