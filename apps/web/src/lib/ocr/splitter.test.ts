import { describe, expect, it } from "vitest";
import { looksLikeFormula, splitQuestion } from "./splitter";

describe("splitQuestion — lettered markers (the reliable path)", () => {
  it("splits 'A. B. C. D.' and keeps only the FIRST question", () => {
    // Verbatim shape of the Step-0 spike's test3 (two questions in one
    // screenshot, dot markers, no space after some dots).
    const r = splitQuestion([
      "1. Which planet is the largest in our solar system?",
      "A. Earth",
      "B. Mars",
      "C. Jupiter",
      "D. Venus",
      "2. What is the chemical formula for water?",
      "A.CO2",
      "B.H2O",
      "C.O2",
      "D.NaCl",
    ]);
    expect(r.matched).toBe(true);
    expect(r.type).toBe("single");
    expect(r.stem).toBe("Which planet is the largest in our solar system?");
    expect(r.options).toEqual([
      { label: "A", content: "Earth" },
      { label: "B", content: "Mars" },
      { label: "C", content: "Jupiter" },
      { label: "D", content: "Venus" },
    ]);
    expect(r.correct).toEqual([]);
  });

  it("handles lowercase '(a) (b)' and strips a 'P1-1.' prefix", () => {
    // Shape of the spike's test2 worksheet.
    const r = splitQuestion([
      "P1-1. Let A = {a1, a2, a3, a4, a5, a6}",
      "(a) How many subsets of A contain a1?",
      "(b) How many subsets of A contain a2 and a3 but not a4?",
      "P1-2. Expand the following using the binomial theorem:",
    ]);
    expect(r.matched).toBe(true);
    expect(r.stem).toBe("Let A = {a1, a2, a3, a4, a5, a6}");
    expect(r.options.map((o) => o.label)).toEqual(["A", "B"]);
    expect(r.options[0].content).toBe("How many subsets of A contain a1?");
  });

  it("accepts 'A)' and '(A)' marker variants", () => {
    expect(
      splitQuestion([
        "Which gas do plants absorb?",
        "A) Oxygen",
        "B) Carbon dioxide",
        "C) Nitrogen",
      ]).options,
    ).toEqual([
      { label: "A", content: "Oxygen" },
      { label: "B", content: "Carbon dioxide" },
      { label: "C", content: "Nitrogen" },
    ]);

    const paren = splitQuestion([
      "Capital of France?",
      "(A) Paris",
      "(B) London",
      "(C) Rome",
    ]);
    expect(paren.matched).toBe(true);
    expect(paren.options[0]).toEqual({ label: "A", content: "Paris" });
  });

  it("joins a stem that wrapped across lines before the markers", () => {
    const r = splitQuestion([
      "What is the longest that an elephant has",
      "ever lived in captivity?",
      "A. 17 years",
      "B. 49 years",
      "C. 86 years",
      "D. 142 years",
    ]);
    expect(r.stem).toBe(
      "What is the longest that an elephant has ever lived in captivity?",
    );
    expect(r.options).toHaveLength(4);
  });

  it("appends a wrapped option continuation to the previous option", () => {
    const r = splitQuestion([
      "Pick the correct statement.",
      "A. The mitochondria is the",
      "powerhouse of the cell",
      "B. Water boils at 50 C",
    ]);
    expect(r.options).toEqual([
      { label: "A", content: "The mitochondria is the powerhouse of the cell" },
      { label: "B", content: "Water boils at 50 C" },
    ]);
  });

  it("stops the option run when a marker is out of sequence", () => {
    const r = splitQuestion(["Q?", "A. one", "B. two", "D. four"]);
    expect(r.matched).toBe(true);
    expect(r.options.map((o) => o.label)).toEqual(["A", "B"]);
  });

  it("anchors the run at 'A' — a list starting at B is not trusted", () => {
    const r = splitQuestion(["Question?", "B. wrong", "C. also"]);
    expect(r.matched).toBe(false);
  });
});

describe("splitQuestion — type inference", () => {
  it("maps a True/False option pair to a judge question", () => {
    const r = splitQuestion(["The earth is flat.", "A. True", "B. False"]);
    expect(r.type).toBe("judge");
    expect(r.options).toEqual([
      { label: "T", content: "True" },
      { label: "F", content: "False" },
    ]);
    expect(r.correct).toEqual([]);
  });

  it("detects 'True or False:' in the stem even without markers", () => {
    const r = splitQuestion(["True or False: The sun is a star."]);
    expect(r.type).toBe("judge");
    expect(r.matched).toBe(false);
  });

  it("detects 'select all that apply' as multi", () => {
    const r = splitQuestion([
      "Which are prime numbers? (Select all that apply)",
      "A. 2",
      "B. 3",
      "C. 4",
      "D. 5",
    ]);
    expect(r.type).toBe("multi");
    expect(r.matched).toBe(true);
    expect(r.options).toHaveLength(4);
  });
});

describe("splitQuestion — honest fallback (no reliable markers)", () => {
  it("puts wrapped, marker-less text in the stem with matched=false", () => {
    // The spike's test1: bare options + a stem that wrapped — cannot be
    // split reliably, so we don't pretend to.
    const r = splitQuestion([
      "1. What is the longest that an elephant has ever lived? (That we",
      "know of)",
      "17 years",
      "49 years",
      "86 years",
      "142 years",
    ]);
    expect(r.matched).toBe(false);
    expect(r.type).toBe("single");
    expect(r.stem).toBe(
      "What is the longest that an elephant has ever lived? (That we know of) 17 years 49 years 86 years 142 years",
    );
    expect(r.options).toEqual([
      { label: "A", content: "" },
      { label: "B", content: "" },
    ]);
    expect(r.correct).toEqual([]);
  });

  it("returns a blank draft for empty / whitespace-only input", () => {
    for (const input of [[], ["   ", ""]]) {
      const r = splitQuestion(input);
      expect(r.matched).toBe(false);
      expect(r.stem).toBe("");
      expect(r.options).toHaveLength(2);
    }
  });

  it("treats a single line as an un-split stem", () => {
    const r = splitQuestion(["What is 2 + 2?"]);
    expect(r.matched).toBe(false);
    expect(r.stem).toBe("What is 2 + 2?");
  });

  it("strips a leading question number in the fallback path too", () => {
    expect(splitQuestion(["Q3. Name the capital of Japan"]).stem).toBe(
      "Name the capital of Japan",
    );
    expect(splitQuestion(["2) Define entropy"]).stem).toBe("Define entropy");
  });
});

describe("looksLikeFormula — nudge toward 'Improve with AI'", () => {
  it("flags math-ish text", () => {
    expect(looksLikeFormula("Evaluate $\\int x^2 dx$")).toBe(true);
    expect(looksLikeFormula("Solve x^2 = 4")).toBe(true);
    expect(looksLikeFormula("What is 3/4 of 12?")).toBe(true);
    expect(looksLikeFormula("Compute the lim of sin(x)/x")).toBe(true);
    expect(looksLikeFormula("Area of a circle with radius r (use √)")).toBe(
      true,
    );
  });

  it("leaves plain prose alone", () => {
    expect(looksLikeFormula("Which planet is the largest?")).toBe(false);
    expect(looksLikeFormula("The capital of Japan is Tokyo")).toBe(false);
  });
});
