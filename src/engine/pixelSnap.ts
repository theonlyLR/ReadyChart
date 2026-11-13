/** Snap a coordinate so a 1px stroke lands on a pixel centre (crisp at 1x and integer export scales). */
export const snap = (coord: number): number => Math.round(coord) + 0.5;
