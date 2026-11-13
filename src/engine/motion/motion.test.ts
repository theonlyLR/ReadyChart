import { describe, expect, it } from "vitest";
import { MICRO_SLICE_PIE_FIXTURE } from "../../../fixtures/goldenDatasets";
import { createDocumentFromColumns } from "../../model/defaults";
import type { ChartDocument } from "../../model/types";
import { createApproxMeasurer } from "../textMeasure";
import { buildScene } from "../scene";
import { cubicBezier, springProgress, springSettleMs } from "./easing";
import { FINAL_FRAME, computeFrameState } from "./frameState";
import { buildTimeline, staggerRanks } from "./timeline";

const m = createApproxMeasurer();
const mk = (type: ChartDocument["geometry"]["type"] = "bar", values = [10, 40, 20, 30, 5]): ChartDocument => {
  const d = createDocumentFromColumns(["A", "B", "C", "D", "E"].slice(0, values.length), values, "T", type);
  d.motion.enabled = true;
  return d;
};

describe("easing", () => {
  it("bezier hits endpoints, is linear for [0,0,1,1], and is monotone for the default ease-out", () => {
    const e = cubicBezier(0.22, 1, 0.36, 1);
    expect(e(0)).toBe(0);
    expect(e(1)).toBe(1);
    let prev = 0;
    for (let i = 1; i <= 100; i++) {
      const v = e(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    const lin = cubicBezier(0, 0, 1, 1);
    expect(lin(0.37)).toBeCloseTo(0.37, 5);
  });
  it("back-easing bezier overshoots 1", () => {
    const e = cubicBezier(0.34, 1.56, 0.64, 1);
    expect(Math.max(...Array.from({ length: 100 }, (_, i) => e(i / 100)))).toBeGreaterThan(1);
  });
  it("spring: starts at 0, settles at 1, overshoots only when underdamped", () => {
    expect(springProgress(0, 170, 22)).toBe(0);
    expect(springProgress(10, 170, 22)).toBeCloseTo(1, 5);
    const peak = (k: number, c: number) => Math.max(...Array.from({ length: 400 }, (_, i) => springProgress(i / 100, k, c)));
    expect(peak(260, 10)).toBeGreaterThan(1.05);
    expect(peak(100, 20)).toBeLessThanOrEqual(1 + 1e-9); // critically damped (zeta = 1)
    expect(peak(100, 60)).toBeLessThanOrEqual(1 + 1e-9); // overdamped
  });
  it("spring settle time matches the curve", () => {
    for (const [k, c] of [[170, 22], [260, 16], [170, 26]] as const) {
      const ms = springSettleMs(k, c);
      expect(Math.abs(springProgress(ms / 1000, k, c) - 1)).toBeLessThan(0.01);
    }
  });
});

describe("computeFrameState", () => {
  it("is pure: same (doc, t) gives deep-equal output", () => {
    const d = mk();
    expect(computeFrameState(d, 777)).toEqual(computeFrameState(d, 777));
  });
  it("disabled motion is the final frame at any t", () => {
    const d = mk();
    d.motion.enabled = false;
    expect(computeFrameState(d, 123)).toEqual(FINAL_FRAME);
  });
  it("choreography: stage first, then hero, then hold, then reset", () => {
    const d = mk();
    const tl = buildTimeline(d);
    const early = computeFrameState(d, tl.stageMs * 0.5);
    expect(early.grid).toBeGreaterThan(0);
    expect(early.items.every((p) => p === 0)).toBe(true);
    const mid = computeFrameState(d, tl.heroStartMs + tl.trackMs * 0.5);
    expect(mid.items[0]).toBeGreaterThan(0);
    expect(mid.items[0]).toBeLessThan(1);
    expect(tl.heroEndMs).toBeLessThan(tl.holdEndMs);
    expect(tl.holdEndMs).toBeLessThan(tl.totalMs);
  });
  it("hold frames are identical and equal the settled frame", () => {
    const d = mk();
    const tl = buildTimeline(d);
    const a = computeFrameState(d, tl.heroEndMs);
    const b = computeFrameState(d, tl.holdEndMs - 1);
    expect({ ...a, timeMs: 0 }).toEqual({ ...b, timeMs: 0 });
    expect(a.items.every((p) => p === 1)).toBe(true);
    expect(a.fade).toBe(1);
  });
  it("loop seam: frame(totalMs) equals frame(0) and the reset fades to nothing", () => {
    const d = mk();
    const tl = buildTimeline(d);
    expect(computeFrameState(d, tl.totalMs)).toEqual(computeFrameState(d, 0));
    const end = computeFrameState(d, tl.totalMs - 1);
    expect(end.fade).toBeLessThan(0.05);
    expect(end.grid).toBeLessThan(0.05);
  });
  it("roll-up is monotone and clamped to 1 even when a spring overshoots", () => {
    const d = mk();
    d.motion.physicsMode = "spring";
    d.motion.springStiffness = 260;
    d.motion.springDamping = 10;
    const tl = buildTimeline(d);
    let prev = 0;
    let sawOvershoot = false;
    for (let t = 0; t <= tl.heroEndMs; t += 10) {
      const f = computeFrameState(d, t);
      if (f.items[0]! > 1) sawOvershoot = true;
      expect(f.roll[0]!).toBeLessThanOrEqual(1);
      expect(f.roll[0]!).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = f.roll[0]!;
    }
    expect(sawOvershoot).toBe(true);
  });
  it("numberRollUp off keeps displayed values final", () => {
    const d = mk();
    d.motion.numberRollUp = false;
    const tl = buildTimeline(d);
    expect(computeFrameState(d, tl.heroStartMs + 100).roll.every((r) => r === 1)).toBe(true);
  });
});

describe("stagger", () => {
  it("left-to-right, center-out and smallest-to-largest rank items", () => {
    const d = mk("bar", [10, 40, 20, 30, 5]);
    d.motion.staggerDirection = "left-to-right";
    expect(staggerRanks(d, 5)).toEqual([0, 1, 2, 3, 4]);
    d.motion.staggerDirection = "center-out";
    expect(staggerRanks(d, 5)[2]).toBe(0);
    expect(staggerRanks(d, 5)[0]).toBeGreaterThan(staggerRanks(d, 5)[1]!);
    d.motion.staggerDirection = "smallest-to-largest";
    expect(staggerRanks(d, 5)).toEqual([1, 4, 2, 3, 0]);
  });
  it("total stagger never exceeds maxTotalStaggerMs", () => {
    const d = mk();
    d.motion.staggerMs = 500;
    d.motion.maxTotalStaggerMs = 600;
    expect(Math.max(...buildTimeline(d).delays)).toBeLessThanOrEqual(600);
  });
  it("pie slices use slice values for smallest-to-largest", () => {
    const d = createDocumentFromColumns(MICRO_SLICE_PIE_FIXTURE.labels, MICRO_SLICE_PIE_FIXTURE.values, "P", "pie");
    d.motion.enabled = true;
    d.motion.staggerDirection = "smallest-to-largest";
    const f = computeFrameState(d, 500);
    expect(f.items.length).toBe(buildTimeline(d).delays.length);
  });
});

describe("scene at a frame", () => {
  it("the default frame is deep-equal to the M1 static scene", () => {
    for (const type of ["bar", "horizontal-bar", "stacked-bar", "line", "area", "pie", "donut"] as const) {
      const d = mk(type);
      expect(buildScene(d, m, FINAL_FRAME).nodes).toEqual(buildScene(d, m).nodes);
    }
  });
  it("a settled frame inside the hold draws the same geometry as the static scene", () => {
    const d = mk();
    const tl = buildTimeline(d);
    expect(buildScene(d, m, computeFrameState(d, tl.heroEndMs + 10)).nodes).toEqual(buildScene(d, m).nodes);
  });
  it("bars grow in proportion to progress", () => {
    const d = mk("bar", [10]);
    d.geometry.barRadius = [0, 0, 0, 0];
    d.geometry.showDataLabels = false;
    const tl = buildTimeline(d);
    const full = buildScene(d, m).nodes.filter((n) => n.kind === "path");
    const half = buildScene(d, m, { ...computeFrameState(d, tl.heroEndMs), items: [0.5], roll: [0.5] }).nodes.filter((n) => n.kind === "path");
    const heightOf = (n: (typeof full)[number]) => {
      const ys = [...(n.kind === "path" ? n.d : "").matchAll(/[HV]([-\d.]+)/g)];
      return ys.length;
    };
    expect(half.length).toBe(full.length);
    expect(heightOf(half[0]!)).toBe(heightOf(full[0]!));
    expect(half[0]).not.toEqual(full[0]);
  });
  it("gridlines stay pixel-snapped at .5 mid-animation and only fade", () => {
    const d = mk();
    const nodes = buildScene(d, m, { ...FINAL_FRAME, grid: 0.4 }).nodes;
    const lines = nodes.filter((n) => n.kind === "line");
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) if (l.kind === "line" && l.y1 === l.y2) expect(l.y1 % 1).toBe(0.5);
  });
  it("pie slices sweep open", () => {
    const d = createDocumentFromColumns(["a", "b"], [1, 1], "P", "pie");
    const full = buildScene(d, m).nodes.filter((n) => n.kind === "path");
    const part = buildScene(d, m, { ...FINAL_FRAME, items: [0.5, 0], roll: [0.5, 0] }).nodes.filter((n) => n.kind === "path");
    expect(part.length).toBe(full.length - 1);
  });
});
