// Filter row used by QuestionListPage (header bar) and ReviewEntryPage
// (left rail). Renders selected-tag chips, an AND/OR toggle (optional),
// and either a popover or an always-visible TagSearchList depending on
// the `variant` prop.

import { useEffect, useRef, useState } from "react";
import type { Tag } from "../../lib/qbank";
import TagSearchList from "./TagSearchList";

type Variant = "popover" | "inline";

interface Props {
  tags: Tag[];
  selectedIds: string[];
  onChangeSelected: (ids: string[]) => void;
  match: "all" | "any";
  onChangeMatch: (m: "all" | "any") => void;
  /** Opens the Manage tags drawer. */
  onOpenManage: () => void;
  /** "popover" = candidate list pops below the search input on focus
   *  (QuestionListPage). "inline" = candidate list always visible
   *  (ReviewEntryPage left rail). */
  variant?: Variant;
  /** Disable the filter region (e.g. Wrong/All active in Review). */
  disabled?: boolean;
  disabledHint?: string;
}

export default function TagFilter({
  tags,
  selectedIds,
  onChangeSelected,
  match,
  onChangeMatch,
  onOpenManage,
  variant = "popover",
  disabled = false,
  disabledHint,
}: Props) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close popover on outside click / Esc.
  useEffect(() => {
    if (variant !== "popover" || !popoverOpen) return;
    function onDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPopoverOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [variant, popoverOpen]);

  function toggle(id: string) {
    onChangeSelected(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id],
    );
  }

  function clear() {
    onChangeSelected([]);
  }

  const selectedTags = selectedIds
    .map((id) => tags.find((t) => t.id === id))
    .filter((t): t is Tag => Boolean(t));

  const matchButton = (m: "all" | "any", label: string) => (
    <button
      key={m}
      type="button"
      disabled={disabled}
      onClick={() => onChangeMatch(m)}
      className={
        "px-2 py-1 text-xs " +
        (match === m
          ? "bg-slate-800 text-white"
          : "text-gray-600 hover:bg-gray-50") +
        (disabled ? " opacity-50" : "")
      }
    >
      {label}
    </button>
  );

  return (
    <div
      ref={containerRef}
      className={
        "rounded-md border border-gray-200 p-2" +
        (disabled ? " bg-gray-50" : "")
      }
    >
      {/* Top row: search trigger + AND/OR + Manage */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          {variant === "popover" ? (
            <>
              <input
                placeholder="Search tags…"
                disabled={disabled}
                onFocus={() => setPopoverOpen(true)}
                onChange={() => setPopoverOpen(true)}
                className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm outline-none focus:border-slate-500 disabled:bg-gray-100"
              />
              {popoverOpen && !disabled && (
                <div className="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-white p-2 shadow-lg">
                  <TagSearchList
                    tags={tags}
                    selectedIds={selectedIds}
                    onToggle={toggle}
                    placeholder="Search tags…"
                    maxListHeight={240}
                  />
                </div>
              )}
            </>
          ) : null}
        </div>
        <div className="flex overflow-hidden rounded-md border border-gray-300">
          {matchButton("all", "AND")}
          {matchButton("any", "OR")}
        </div>
        <button
          type="button"
          onClick={onOpenManage}
          className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
        >
          Manage tags
        </button>
      </div>

      {/* Selected chips */}
      {selectedTags.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
          <span className="text-gray-500">Selected:</span>
          {selectedTags.map((t) => (
            <span
              key={t.id}
              className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-slate-700"
            >
              {t.name}
              <button
                type="button"
                aria-label={`Remove ${t.name}`}
                onClick={() => toggle(t.id)}
                className="text-slate-500 hover:text-slate-800"
              >
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={clear}
            className="rounded-md border border-gray-300 px-2 py-0.5 hover:bg-gray-50"
          >
            Clear
          </button>
        </div>
      )}

      {/* Inline always-visible list (Review left rail) */}
      {variant === "inline" && !disabled && (
        <div className="mt-2">
          <TagSearchList
            tags={tags}
            selectedIds={selectedIds}
            onToggle={toggle}
            maxListHeight={260}
          />
        </div>
      )}

      {disabled && disabledHint && (
        <p className="mt-2 text-xs text-gray-500">{disabledHint}</p>
      )}
    </div>
  );
}
