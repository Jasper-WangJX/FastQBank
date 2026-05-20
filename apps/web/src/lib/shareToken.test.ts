import { describe, expect, it } from "vitest";
import { extractShareToken } from "./shareToken";

describe("extractShareToken", () => {
  it("extracts from a https URL with /s/<token>", () => {
    expect(
      extractShareToken("https://fastqbank.com/s/AbCdEf123_-x"),
    ).toBe("AbCdEf123_-x");
  });

  it("extracts from a URL with extra path / query after the token", () => {
    expect(
      extractShareToken("https://fastqbank.com/s/AbCdEf123_-x?ref=foo"),
    ).toBe("AbCdEf123_-x");
  });

  it("accepts a bare 12-char token", () => {
    expect(extractShareToken("AbCdEf123_-x")).toBe("AbCdEf123_-x");
  });

  it("trims surrounding whitespace", () => {
    expect(extractShareToken("  AbCdEf123_-x  ")).toBe("AbCdEf123_-x");
  });

  it("returns null for empty string", () => {
    expect(extractShareToken("")).toBeNull();
    expect(extractShareToken("   ")).toBeNull();
  });

  it("returns null for a too-short bare string", () => {
    expect(extractShareToken("short")).toBeNull();
  });

  it("returns null for arbitrary text without /s/", () => {
    expect(
      extractShareToken("see https://example.com/AAAAAAAAAAAA"),
    ).toBeNull();
  });

  it("returns null for a URL whose token segment is the wrong length", () => {
    expect(
      extractShareToken("https://fastqbank.com/s/tooshort"),
    ).toBeNull();
  });
});
