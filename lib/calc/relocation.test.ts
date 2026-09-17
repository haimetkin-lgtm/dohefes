import { describe, expect, it } from "vitest";
import { computeRelocationMovingCostNis, computeRelocationRentNis, relocationMonthlyRentByYear } from "./engine";

describe("relocationMonthlyRentByYear", () => {
  it("returns the base rent unchanged when there is a single year", () => {
    expect(relocationMonthlyRentByYear(4500, [{ months: 18, increasePct: 0 }])).toEqual([4500]);
  });

  it("compounds each year relative to the previous year's rent, not the first year", () => {
    const years = [
      { months: 12, increasePct: 0 },
      { months: 12, increasePct: 0.1 },
      { months: 12, increasePct: 0.1 },
    ];
    const rents = relocationMonthlyRentByYear(1000, years);
    expect(rents[0]).toBe(1000);
    expect(rents[1]).toBeCloseTo(1100, 6);
    expect(rents[2]).toBeCloseTo(1210, 6);
  });

  it("returns an empty array when there are no years", () => {
    expect(relocationMonthlyRentByYear(4500, [])).toEqual([]);
  });
});

describe("computeRelocationRentNis", () => {
  it("matches the flat single-year formula when there is no escalation", () => {
    const total = computeRelocationRentNis({
      relocationUnitsCount: 4,
      relocationBaseMonthlyRentPerUnitNis: 4500,
      relocationYears: [{ months: 18, increasePct: 0 }],
    });
    expect(total).toBe(4 * 18 * 4500);
  });

  it("sums units × months × the compounded per-year rent across multiple years", () => {
    const total = computeRelocationRentNis({
      relocationUnitsCount: 2,
      relocationBaseMonthlyRentPerUnitNis: 1000,
      relocationYears: [
        { months: 12, increasePct: 0 },
        { months: 6, increasePct: 0.1 },
      ],
    });
    // שנה 1: 2 * 12 * 1000 = 24000, שנה 2: 2 * 6 * 1100 = 13200
    expect(total).toBe(24000 + 13200);
  });

  it("returns 0 when relocationYears is empty", () => {
    expect(
      computeRelocationRentNis({
        relocationUnitsCount: 4,
        relocationBaseMonthlyRentPerUnitNis: 4500,
        relocationYears: [],
      })
    ).toBe(0);
  });

  it("returns 0 when there are no relocation units", () => {
    expect(
      computeRelocationRentNis({
        relocationUnitsCount: 0,
        relocationBaseMonthlyRentPerUnitNis: 4500,
        relocationYears: [{ months: 18, increasePct: 0 }],
      })
    ).toBe(0);
  });
});

describe("computeRelocationMovingCostNis", () => {
  it("multiplies units by the per-unit moving cost", () => {
    expect(
      computeRelocationMovingCostNis({ relocationUnitsCount: 4, relocationMovingCostPerUnitNis: 3000 })
    ).toBe(12000);
  });

  it("returns 0 when there are no relocation units", () => {
    expect(
      computeRelocationMovingCostNis({ relocationUnitsCount: 0, relocationMovingCostPerUnitNis: 3000 })
    ).toBe(0);
  });
});
