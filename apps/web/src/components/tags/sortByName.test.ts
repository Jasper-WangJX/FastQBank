import { describe, expect, it } from "vitest";
import { sortByName } from "./sortByName";
import type { Tag } from "../../lib/qbank";

function t(name: string, id = name): Tag {
  return {
    id,
    user_id: "u",
    name,
    created_at: "",
    updated_at: "",
  };
}

describe("sortByName", () => {
  it("sorts ascending by locale-aware name", () => {
    const out = sortByName([t("calculus"), t("Algebra"), t("derivative")]);
    expect(out.map((x) => x.name)).toEqual([
      "Algebra",
      "calculus",
      "derivative",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [t("b"), t("a")];
    sortByName(input);
    expect(input.map((x) => x.name)).toEqual(["b", "a"]);
  });
});
