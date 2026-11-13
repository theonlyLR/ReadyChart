import { describe, expect, it } from "vitest";
import { createDefaultDocument } from "./defaults";
import { confirmAll, confirmCell, setCell, unverifiedCount } from "./dataOps";

describe("provenance verification", () => {
  const mk = () => {
    const doc = createDefaultDocument();
    doc.data.series[0]!.provenance = ["PARSED", "OCR_EXACT", "LOW_CONFIDENCE", "MISSING"];
    return doc;
  };
  it("counts only unverified cells", () => expect(unverifiedCount(mk().data)).toBe(3));
  it("setCell marks a cell as manual", () => {
    const doc = mk();
    setCell(doc.data, 0, 0, 5);
    expect(doc.data.series[0]!.provenance[0]).toBe("USER_INPUT");
  });
  it("confirmCell / confirmAll clear unverified status but leave MISSING", () => {
    const doc = mk();
    confirmCell(doc.data, 0, 1);
    expect(unverifiedCount(doc.data)).toBe(2);
    confirmAll(doc.data);
    expect(unverifiedCount(doc.data)).toBe(0);
    expect(doc.data.series[0]!.provenance[3]).toBe("MISSING");
  });
});

import { computeFrameState } from "../engine/motion/frameState";

describe("provenance never affects rendering", () => {
  it("computeFrameState is identical whatever the provenance tags are", () => {
    const a = createDefaultDocument();
    const b = createDefaultDocument();
    b.data.series[0]!.provenance = ["PARSED", "OCR_EXACT", "LOW_CONFIDENCE", "AXIS_MEASURED"];
    b.motion.enabled = true;
    a.motion.enabled = true;
    for (const t of [0, 400, 1200]) expect(computeFrameState(b, t)).toEqual(computeFrameState(a, t));
  });
});
