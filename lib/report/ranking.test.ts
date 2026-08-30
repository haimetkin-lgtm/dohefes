import { describe, expect, it } from "vitest";
import { availableNewUnits, calculateValueGap, coefficientIssue, rankUnits, totalCoefficient, validateRankingInputs, type RankingCriterion, type RankingUnit } from "../ranking";
import { buildRankingWorkbook } from "./exportRankingExcel";

const criteria: RankingCriterion[] = [
  { id: "floor", name: "קומה", weight: 1 },
  { id: "view", name: "נוף", weight: 0.5 },
];

function unit(id: string, floor: number, view: number, basePriceNis = 1_000_000): RankingUnit {
  return { id, name: id, basePriceNis, coefficients: { floor, view } };
}

describe("ranking engine", () => {
  it("preserves multiplication at full weight and applies fractional weights geometrically", () => {
    expect(totalCoefficient(unit("a", 1.1, 1.21), criteria)).toBeCloseTo(1.21, 8);
  });

  it("a zero weight makes a criterion neutral", () => {
    expect(totalCoefficient(unit("a", 1.1, 2), [{ ...criteria[1], weight: 0 }])).toBe(1);
  });

  it("marks every member of a tie and gives them the same competition rank", () => {
    const ranked = rankUnits([unit("a", 1, 1), unit("b", 1, 1), unit("c", 0.9, 1)], criteria);
    expect(ranked.map(({ rank, tie }) => ({ rank, tie }))).toEqual([
      { rank: 1, tie: true },
      { rank: 1, tie: true },
      { rank: 3, tie: false },
    ]);
  });

  it("breaks the value gap into base and quality effects", () => {
    const gap = calculateValueGap(unit("old", 1, 1, 1_000_000), unit("new", 1.1, 1, 1_200_000), criteria);
    expect(gap.basePriceGapNis).toBe(200_000);
    expect(gap.coefficientGapPercent).toBeCloseTo(0.1);
    expect(gap.valueGapNis).toBeCloseTo(320_000);
  });

  it("distinguishes invalid coefficients from unusual but usable inputs", () => {
    expect(coefficientIssue(0)).toBe("invalid");
    expect(coefficientIssue(0.7)).toBe("unusual");
    expect(coefficientIssue(1)).toBeNull();
  });

  it("prevents a new unit from being offered to two owners", () => {
    const units = [unit("new-a", 1, 1), unit("new-b", 1, 1)];
    expect(availableNewUnits(units, { oldA: "new-a" }, "").map((candidate) => candidate.id)).toEqual(["new-b"]);
    expect(availableNewUnits(units, { oldA: "new-a" }, "new-a").map((candidate) => candidate.id)).toEqual(["new-a", "new-b"]);
  });

  it("exports the method, weights and detailed result breakdown", () => {
    const oldUnit = unit("old", 1, 1);
    const newUnit = unit("new", 1.1, 1, 1_200_000);
    const workbook = buildRankingWorkbook(criteria, [oldUnit], [newUnit], { old: "new" });
    expect(workbook.SheetNames).toEqual(["שיטה ומשקלים", "דירות ישנות", "דירות חדשות", "סדר בחירה ופער ערך"]);
    expect(workbook.Sheets["סדר בחירה ופער ערך"].L1.v).toBe("פער ערך (₪)");
  });

  it("blocks ambiguous names, negative values and stale or duplicate selections", () => {
    const oldA = unit("old-a", 1, 1, -1);
    oldA.name = "";
    const result = validateRankingInputs(
      [{ id: "floor", name: " קומה ", weight: 1 }, { id: "view", name: "קומה", weight: 1 }],
      [oldA, unit("old-b", 1, 1)],
      [unit("new-a", 1, 1)],
      { "old-a": "new-a", "old-b": "new-a", missing: "missing" }
    );
    expect(result.blockingErrors.join(" ")).toMatch(/ייחודיים|שם|שלילי|יותר מדייר|אינה קיימת/);
    expect(() => buildRankingWorkbook(
      [{ id: "floor", name: "קומה", weight: 1 }],
      [unit("old", 1, 1, -1)],
      [unit("new", 1, 1)],
      {}
    )).toThrow(/לא ניתן לייצא/);
  });

  it("warns, but does not block, when values are missing or unusual", () => {
    const old = unit("old", 0.7, 1, 0);
    const result = validateRankingInputs(criteria, [old], [unit("new", 1, 1)], {});
    expect(result.blockingErrors).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/שווי בסיס|טווח הבקרה/);
  });
});
