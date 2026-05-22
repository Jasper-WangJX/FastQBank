import { describe, expect, it } from "vitest";
import type { Question } from "../qbank";
import {
  allSelected,
  applyRandomCap,
  buildDeck,
  isAnswerCorrect,
  shuffleWithRng,
  toggleId,
} from "./session";

function q(id: string, partial: Partial<Question> = {}): Question {
  return {
    id,
    user_id: "u",
    stem: `stem ${id}`,
    type: "single",
    options: [
      { label: "A", content: "a" },
      { label: "B", content: "b" },
      { label: "C", content: "c" },
    ],
    correct: ["A"],
    knowledge_summary: null,
    source: "manual",
    created_at: "",
    updated_at: "",
    tags: [],
    ...partial,
  };
}

describe("toggleId / allSelected — global selection set", () => {
  it("adds then removes an id", () => {
    const s = new Set<string>();
    expect([...toggleId(s, "x")]).toEqual(["x"]);
    expect([...toggleId(new Set(["x"]), "x")]).toEqual([]);
  });

  it("allSelected is true only when every id is in the set", () => {
    expect(allSelected(["a", "b"], new Set(["a", "b", "z"]))).toBe(true);
    expect(allSelected(["a", "b"], new Set(["a"]))).toBe(false);
    expect(allSelected([], new Set())).toBe(false); // nothing to select
  });
});

describe("isAnswerCorrect — order-independent exact set", () => {
  it("single: exact one match", () => {
    expect(isAnswerCorrect(q("1", { correct: ["A"] }), ["A"])).toBe(true);
    expect(isAnswerCorrect(q("1", { correct: ["A"] }), ["B"])).toBe(false);
  });
  it("multi: set equality regardless of order", () => {
    const m = q("1", { type: "multi", correct: ["A", "C"] });
    expect(isAnswerCorrect(m, ["C", "A"])).toBe(true);
    expect(isAnswerCorrect(m, ["A"])).toBe(false);
    expect(isAnswerCorrect(m, ["A", "B", "C"])).toBe(false);
  });
  it("judge: T/F", () => {
    const j = q("1", {
      type: "judge",
      options: [
        { label: "T", content: "True" },
        { label: "F", content: "False" },
      ],
      correct: ["T"],
    });
    expect(isAnswerCorrect(j, ["T"])).toBe(true);
    expect(isAnswerCorrect(j, ["F"])).toBe(false);
  });
  it("empty selection is never correct", () => {
    expect(isAnswerCorrect(q("1"), [])).toBe(false);
  });
});

describe("shuffleWithRng — deterministic with injected rng", () => {
  it("reverses with a max rng and never mutates input", () => {
    const arr = [1, 2, 3, 4];
    const out = shuffleWithRng(arr, () => 0.9999);
    expect(out).toHaveLength(4);
    expect([...arr]).toEqual([1, 2, 3, 4]); // input untouched
    expect(out.slice().sort()).toEqual([1, 2, 3, 4]); // a permutation
  });
  it("rng()->0 keeps order (each swap picks itself)", () => {
    expect(shuffleWithRng([1, 2, 3], () => 0)).toEqual([1, 2, 3]);
  });
});

describe("applyRandomCap", () => {
  it("returns all when count >= length", () => {
    expect(applyRandomCap([1, 2], 5, Math.random)).toHaveLength(2);
  });
  it("returns exactly count items, all from the input", () => {
    const out = applyRandomCap([1, 2, 3, 4, 5], 3, () => 0);
    expect(out).toHaveLength(3);
    for (const x of out) expect([1, 2, 3, 4, 5]).toContain(x);
  });
});

describe("buildDeck — order + per-card option shuffle", () => {
  const qs = [q("1"), q("2"), q("3")];

  it("keeps selection order when not randomized", () => {
    const deck = buildDeck(qs, {
      randomOrder: false,
      shuffleOptions: false,
      rng: () => 0,
    });
    expect(deck.map((c) => c.question.id)).toEqual(["1", "2", "3"]);
  });

  it("shuffles option CONTENT but keeps labels sequential (A,B,C)", () => {
    // rng 0.9999 shuffles contents [a,b,c] -> [b,c,a]; labels are then
    // re-assigned by position so they read A,B,C with shuffled content.
    const deck = buildDeck([q("1", { correct: ["A"] })], {
      randomOrder: false,
      shuffleOptions: true,
      rng: () => 0.9999,
    });
    expect(deck[0].options.map((o) => o.label)).toEqual(["A", "B", "C"]);
    expect(deck[0].options.map((o) => o.content)).toEqual(["b", "c", "a"]);
    // Original correct "A" (content "a") landed at the last position -> "C".
    expect(deck[0].correct).toEqual(["C"]);
  });

  it("never shuffles judge and keeps its canonical labels + correct", () => {
    const judge = q("j", {
      type: "judge",
      options: [
        { label: "T", content: "True" },
        { label: "F", content: "False" },
      ],
      correct: ["T"],
    });
    const deck = buildDeck([judge], {
      randomOrder: false,
      shuffleOptions: true,
      rng: () => 0.9999,
    });
    expect(deck[0].options.map((o) => o.label)).toEqual(["T", "F"]);
    expect(deck[0].correct).toEqual(["T"]);
  });

  it("does not shuffle options or remap labels when the flag is off", () => {
    const deck = buildDeck([q("1", { correct: ["A"] })], {
      randomOrder: false,
      shuffleOptions: false,
      rng: () => 0.9999,
    });
    expect(deck[0].options.map((o) => o.label)).toEqual(["A", "B", "C"]);
    expect(deck[0].correct).toEqual(["A"]);
  });
});
