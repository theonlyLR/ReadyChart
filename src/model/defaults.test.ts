import { describe, expect, it } from "vitest";
import { createDefaultDocument } from "./defaults";
import { seriesLengthsMatch } from "./validate";
import { isStylePath } from "./paths";

describe("model", () => {
  it("default document round-trips through JSON", () => {
    const doc = createDefaultDocument();
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
    expect(seriesLengthsMatch(doc)).toBe(true);
  });

  it("style path guard excludes data", () => {
    expect(isStylePath("/geometry/barRadius")).toBe(true);
    expect(isStylePath("/data/series/0/values")).toBe(false);
  });
});
