import { describe, expect, it } from "vitest";
import type { Question, Tag } from "../qbank";
import type { GeneratedQuestion } from "../ai";
import { buildAiCards, isAiCard, tagsByLowerName } from "./aiDraft";

function tag(id: string, name: string): Tag {
  return {
    id,
    user_id: "u",
    name,
    parent_id: null,
    path: id,
    created_at: "",
    updated_at: "",
  };
}

function draft(p: Partial<GeneratedQuestion> = {}): GeneratedQuestion {
  return {
    stem: "s",
    type: "single",
    options: [
      { label: "A", content: "a" },
      { label: "B", content: "b" },
    ],
    correct: ["A"],
    valid: true,
    validation_error: null,
    knowledge_summary: "note",
    tags: [],
    ...p,
  };
}

// deterministic id generator for tests
function ids(): () => string {
  let n = 0;
  return () => `ai-${++n}`;
}

describe("tagsByLowerName", () => {
  it("keys by trimmed lowercased name, first wins", () => {
    const m = tagsByLowerName([
      tag("1", "Algebra"),
      tag("2", "algebra"),
      tag("3", "Geometry"),
    ]);
    expect(m.get("algebra")!.id).toBe("1");
    expect(m.get("geometry")!.id).toBe("3");
    expect(m.size).toBe(2);
  });
});

describe("buildAiCards", () => {
  const tags = tagsByLowerName([tag("t1", "Algebra")]);

  it("drops invalid drafts", () => {
    const out = buildAiCards(
      [draft({ valid: false }), draft()],
      tags,
      ids(),
    );
    expect(out).toHaveLength(1);
  });

  it("each card has unique synthetic id, source ai, __ai true", () => {
    const out = buildAiCards([draft(), draft()], tags, ids());
    expect(out.map((c) => c.id)).toEqual(["ai-1", "ai-2"]);
    expect(out.every((c) => c.source === "ai")).toBe(true);
    expect(out.every((c) => c.__ai === true)).toBe(true);
  });

  it("resolves tag names case-insensitively, drops misses, dedupes, caps 3", () => {
    const many = tagsByLowerName([
      tag("a", "Algebra"),
      tag("b", "Bravo"),
      tag("c", "Charlie"),
      tag("d", "Delta"),
    ]);
    const out = buildAiCards(
      [
        draft({
          tags: ["ALGEBRA", "algebra", "Nope", "Bravo", "Charlie", "Delta"],
        }),
      ],
      many,
      ids(),
    );
    expect(out[0].tags.map((t) => t.name)).toEqual([
      "Algebra",
      "Bravo",
      "Charlie",
    ]);
  });

  it("passes knowledge_summary through; empty -> null (hidden)", () => {
    const out = buildAiCards(
      [draft({ knowledge_summary: "k" }), draft({ knowledge_summary: "" })],
      tags,
      ids(),
    );
    expect(out[0].knowledge_summary).toBe("k");
    expect(out[1].knowledge_summary).toBeNull();
  });
});

describe("isAiCard", () => {
  it("true for AI cards, false for a plain question", () => {
    const [card] = buildAiCards([draft()], tagsByLowerName([]), ids());
    expect(isAiCard(card)).toBe(true);
    const plain: Question = {
      id: "q",
      user_id: "u",
      stem: "s",
      type: "single",
      options: [],
      correct: [],
      knowledge_summary: null,
      source: "manual",
      created_at: "",
      updated_at: "",
      tags: [],
    };
    expect(isAiCard(plain)).toBe(false);
  });
});
