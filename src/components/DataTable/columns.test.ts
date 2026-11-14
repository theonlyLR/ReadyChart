import { describe, expect, it } from "vitest";
import { useDocumentStore } from "../../store/documentStore";
import { useUiStore } from "../../store/uiStore";
import { LABEL_MAX, LABEL_MIN, PANEL_DEFAULT, PANEL_MAX, PANEL_MIN, SERIES_DEFAULT, SERIES_MAX, SERIES_MIN, autoFit, clampLabel, clampPanel, clampSeries, dragWidth } from "./columns";

describe("column sizing rules", () => {
  it("numeric columns default compact (64-72 px) so Label gets the rest", () => {
    expect(SERIES_DEFAULT).toBeGreaterThanOrEqual(64);
    expect(SERIES_DEFAULT).toBeLessThanOrEqual(72);
    expect(PANEL_DEFAULT).toBeGreaterThanOrEqual(PANEL_MIN);
  });
  it("clamps Label to 64..320, series to 52..180 and the panel to 240..460", () => {
    expect([clampLabel(10), clampLabel(200), clampLabel(999)]).toEqual([64, 200, 320]);
    expect([clampSeries(10), clampSeries(100), clampSeries(999)]).toEqual([52, 100, 180]);
    expect([clampPanel(10), clampPanel(300), clampPanel(999)]).toEqual([240, 300, 460]);
    expect([LABEL_MIN, LABEL_MAX, SERIES_MIN, SERIES_MAX, PANEL_MIN, PANEL_MAX]).toEqual([64, 320, 52, 180, 240, 460]);
  });
  it("dragging adds the pointer travel to the starting width, then clamps", () => {
    expect(dragWidth(100, 40, clampLabel)).toBe(140);
    expect(dragWidth(100, -500, clampLabel)).toBe(64);
    expect(dragWidth(100, 500, clampSeries)).toBe(180);
  });
  it("auto-fit snaps to the widest content inside the allowed range", () => {
    expect(autoFit([80, 143.2, 120], LABEL_MIN, LABEL_MAX)).toBe(144);
    expect(autoFit([10, 20], LABEL_MIN, LABEL_MAX)).toBe(64);
    expect(autoFit([900], SERIES_MIN, SERIES_MAX)).toBe(180);
    expect(autoFit([], SERIES_MIN, SERIES_MAX)).toBe(52);
  });
});

describe("column widths live in UI state, not the document", () => {
  it("store setters clamp, remember per series, and never create an undo step", () => {
    const depth = useDocumentStore.getState().past.length;
    const ui = useUiStore.getState();
    expect(ui.labelColWidth).toBeNull();
    ui.setLabelColWidth(5000);
    ui.setSeriesColWidth("s1", 3);
    ui.setSeriesColWidth("s2", 120);
    ui.setDataPanelWidth(100);
    const s = useUiStore.getState();
    expect(s.labelColWidth).toBe(320);
    expect(s.seriesColWidths).toEqual({ s1: 52, s2: 120 });
    expect(s.dataPanelWidth).toBe(240);
    expect(useDocumentStore.getState().past.length).toBe(depth);
    s.setDataPanelWidth(10_000);
    expect(useUiStore.getState().dataPanelWidth).toBe(460);
  });
});
