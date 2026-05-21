import { describe, expect, it } from "vitest";
import { shouldShowOnboarding } from "./shouldShowOnboarding";

describe("shouldShowOnboarding", () => {
  it("returns true when both tags and questions are empty", () => {
    expect(shouldShowOnboarding({ tagCount: 0, questionTotal: 0 })).toBe(true);
  });

  it("returns false when there is at least one tag", () => {
    expect(shouldShowOnboarding({ tagCount: 1, questionTotal: 0 })).toBe(false);
  });

  it("returns false when there is at least one question", () => {
    expect(shouldShowOnboarding({ tagCount: 0, questionTotal: 1 })).toBe(false);
  });

  it("returns false when both are non-empty", () => {
    expect(shouldShowOnboarding({ tagCount: 3, questionTotal: 12 })).toBe(false);
  });

  it("returns false when either count is unknown (null)", () => {
    expect(shouldShowOnboarding({ tagCount: null, questionTotal: 0 })).toBe(false);
    expect(shouldShowOnboarding({ tagCount: 0, questionTotal: null })).toBe(false);
  });
});
