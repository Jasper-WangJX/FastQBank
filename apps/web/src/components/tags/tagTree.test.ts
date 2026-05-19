import { describe, expect, it } from "vitest";
import type { Tag } from "../../lib/qbank";
import {
  byParent,
  depthOf,
  flattenInTreeOrder,
  inSubtree,
  sortByPath,
} from "./tagTree";

function t(id: string, parent_id: string | null, path: string): Tag {
  return {
    id,
    user_id: "u",
    name: id,
    parent_id,
    path,
    created_at: "",
    updated_at: "",
  };
}

const A = t("A", null, "A");
const B = t("B", "A", "A/B");
const C = t("C", "A", "A/C");
const D = t("D", "B", "A/B/D");
const E = t("E", null, "E");
const all = [D, B, A, C, E];

describe("depthOf", () => {
  it("counts path segments - 1", () => {
    expect(depthOf(A)).toBe(0);
    expect(depthOf(B)).toBe(1);
    expect(depthOf(D)).toBe(2);
  });
});

describe("sortByPath", () => {
  it("orders by path and does not mutate input", () => {
    const out = sortByPath(all);
    expect(out.map((x) => x.id)).toEqual(["A", "B", "D", "C", "E"]);
    expect(all.map((x) => x.id)).toEqual(["D", "B", "A", "C", "E"]);
  });
});

describe("byParent", () => {
  it("groups children under parent id (null = roots), siblings by name", () => {
    const m = byParent(all);
    expect((m.get(null) ?? []).map((x) => x.id)).toEqual(["A", "E"]);
    expect((m.get("A") ?? []).map((x) => x.id)).toEqual(["B", "C"]);
    expect((m.get("B") ?? []).map((x) => x.id)).toEqual(["D"]);
    expect(m.get("D")).toBeUndefined();
  });
});

describe("inSubtree", () => {
  it("true for self and descendants by path prefix", () => {
    expect(inSubtree(A, A)).toBe(true);
    expect(inSubtree(D, A)).toBe(true);
    expect(inSubtree(C, A)).toBe(true);
    expect(inSubtree(E, A)).toBe(false);
    expect(inSubtree(A, B)).toBe(false);
  });
});

describe("flattenInTreeOrder", () => {
  it("depth-first, roots & siblings by name", () => {
    expect(flattenInTreeOrder(all).map((x) => x.id)).toEqual([
      "A",
      "B",
      "D",
      "C",
      "E",
    ]);
  });
});
