// commit 8d: הופך את שלושת ה-fixtures שנבנו עבור ה-audit (פינוי בינוי / קומבינצית תמורות / מעורב
// שימושים - שלושת סוגי העסקה שלא היה להם כיסוי קודם ב-feasibility.test.ts) לבדיקות רגרסיה קבועות
// לדור 1 (computeProject). לא בודק ערכים ספציפיים (snapshot שביר) - בודק אינווריאנטים מבניים
// (סופיות, דטרמיניזם, אי-מוטציה, יחסי הכנסה/עלות/רווח) שנכונים לכל תוצאה תקינה של computeProject,
// ללא תלות במספרים המדויקים. אינו נוגע בנוסחאות דור 1 עצמן.

import { describe, expect, it } from "vitest";
import { computeProject } from "./engine";
import type { CostInputs, LandInputs, ProjectInputs, ProjectResult, UnitType } from "./types";

function baseCosts(overrides: Partial<CostInputs> = {}): CostInputs {
  return {
    balconyWeight: 0.5,
    mainConstructionCostPerSqm: 7000,
    premiumConstructionCostPerSqm: 8500,
    commercialConstructionCostPerSqm: 6000,
    officeConstructionCostPerSqm: 6500,
    publicBuildingConstructionCostPerSqm: 5500,
    reinforcementCostPerSqm: 3500,
    undergroundConstructionCostPerSqm: 4000,
    balconyConstructionCostRatio: 0.5,
    developmentCostPerSqm: 300,
    undergroundAreaSqm: 200,
    netPlotAreaSqm: 500,
    demolitionFlatNis: 250000,
    municipalFees: {
      buildingFeeRatePerSqm: 50,
      waterConnectionRatePerSqm: 20,
      sewageConnectionRatePerSqm: 20,
      roadDrainagePlotRatePerSqm: 30,
      roadDrainageBuildingRatePerSqm: 15,
      roadDrainageUndergroundRatePerSqm: 10,
    },
    relocationUnitsCount: 4,
    relocationMonths: 18,
    relocationRentPerUnitMonthlyNis: 4500,
    brokerageRate: 0.01,
    purchaseTaxRate: 0.06,
    electricConnectionPerUnitNis: 3000,
    planningFlatNis: 20000,
    planningConsultantsRate: 0.025,
    engineeringInspectionFlatNis: 50000,
    marketingRate: 0.02,
    legalRate: 0.005,
    legalRefundPerUnitNis: 1000,
    financialSupervisionFlatNis: 50000,
    overheadRate: 0.02,
    managementFeeRate: 0.03,
    contingencyRate: 0.03,
    guaranteeCommissionRate: 0.0085,
    unusedCreditCommissionRate: 0.0035,
    accountOpeningCommissionRate: 0.0045,
    annualInterestRate: 0.04,
    constructionMonths: 20,
    permitMonths: 8,
    equityNis: 2000000,
    presaleRate: 0.15,
    organizerFeeNis: 0,
    ...overrides,
  };
}

function baseLand(overrides: Partial<LandInputs> = {}): LandInputs {
  return { landPurchaseNis: 0, bettermentLevyNis: 100000, combinationOwnerShare: 0, combinationLandValueForTaxNis: 0, ...overrides };
}

function unit(overrides: Partial<UnitType> = {}): UnitType {
  return { name: "דירת 4 חדרים", count: 10, areaSqm: 95, mamadSqm: 12, balconySqm: 12, roofBalconySqm: 0, priceNis: 2200000, ...overrides };
}

const fixtures: Record<string, ProjectInputs> = {
  pinuyBinui: {
    dealType: "pinuyBinui",
    projectName: "audit-pinuyBinui",
    units: [
      unit({ name: "תמורה לדייר קיים", count: 6, isCompensationUnit: true, priceNis: 2_100_000 }),
      unit({ name: "דירה למכירה", count: 20, priceNis: 2_400_000 }),
      unit({ name: "מבנה קיים מחוזק", count: 2, isExistingStructure: true, priceNis: 0, areaSqm: 80 }),
    ],
    costs: baseCosts(),
    land: baseLand(),
  },
  kombinatsiaTemurot: {
    dealType: "kombinatsiaTemurot",
    projectName: "audit-kombinatsiaTemurot",
    units: [unit({ count: 16 })],
    costs: baseCosts(),
    land: baseLand({ combinationOwnerShare: 0.35, combinationLandValueForTaxNis: 8_000_000 }),
  },
  mixedUse: {
    dealType: "mixedUse",
    projectName: "audit-mixedUse",
    units: [
      unit({ name: "מגורים", count: 10, category: "residential", priceNis: 2_200_000 }),
      unit({ name: "מסחר", count: 3, category: "commercial", priceNis: 1_500_000, areaSqm: 60 }),
      unit({ name: "משרדים", count: 4, category: "office", priceNis: 1_300_000, areaSqm: 55 }),
      unit({ name: 'מב"צ', count: 1, category: "publicBuilding", priceNis: 0, areaSqm: 120 }),
    ],
    costs: baseCosts(),
    land: baseLand({ combinationOwnerShare: 0.3, combinationLandValueForTaxNis: 6_000_000 }),
  },
};

/** סורק רקורסיבית כל שדה מספרי בעץ התוצאה - לא רק את שדות הסיכום ברמה העליונה */
function collectNumbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === "number") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectNumbers(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectNumbers(v, out);
  }
  return out;
}

describe.each(Object.entries(fixtures))("רגרסיית דור 1: dealType=%s (audit gen2-cashflow-engine)", (name, inputs) => {
  it("computeProject מחזיר תוצאה סופית לחלוטין - אין NaN/Infinity בשום שדה מספרי", () => {
    const result = computeProject(inputs);
    const numbers = collectNumbers(result);
    expect(numbers.length).toBeGreaterThan(0);
    for (const n of numbers) {
      expect(Number.isFinite(n)).toBe(true);
    }
  });

  it("זהות דטרמיניסטית: שתי הרצות על אותו קלט מחזירות תוצאה זהה בדיוק", () => {
    const first = computeProject(inputs);
    const second = computeProject(inputs);
    expect(second).toEqual(first);
  });

  it("אין מוטציה של ProjectInputs", () => {
    const snapshot = JSON.parse(JSON.stringify(inputs));
    computeProject(inputs);
    expect(inputs).toEqual(snapshot);
  });

  it("אינווריאנטים: currentProfitNis = revenueNis - totalCostNis, profitToCostRatio עקבי", () => {
    const result: ProjectResult = computeProject(inputs);
    const { revenueNis, totalCostNis, currentProfitNis, profitToCostRatio, profitToRevenueRatio } = result.profitability;
    expect(currentProfitNis).toBeCloseTo(revenueNis - totalCostNis, 6);
    if (totalCostNis !== 0) expect(profitToCostRatio).toBeCloseTo(currentProfitNis / totalCostNis, 10);
    if (revenueNis !== 0) expect(profitToRevenueRatio).toBeCloseTo(currentProfitNis / revenueNis, 10);
  });

  it("אינווריאנטים: totalInclFinancingNis = totalExclFinancingNis + financingNis, ושניהם >= 0", () => {
    const result = computeProject(inputs);
    const { totalExclFinancingNis, totalInclFinancingNis, financingNis } = result.costs;
    expect(totalInclFinancingNis).toBeCloseTo(totalExclFinancingNis + financingNis, 6);
    expect(totalExclFinancingNis).toBeGreaterThanOrEqual(0);
    expect(financingNis).toBeGreaterThanOrEqual(0);
  });

  it("אינווריאנטים: areas.unitCount שווה לסך count של כל שורות היחידות בקלט", () => {
    const result = computeProject(inputs);
    const expectedUnitCount = inputs.units.reduce((sum, u) => sum + u.count, 0);
    expect(result.areas.unitCount).toBe(expectedUnitCount);
  });

  it("אין אזהרות חוסמות בלתי-צפויות (warnings הוא מערך, לא נזרקת שגיאה)", () => {
    expect(() => computeProject(inputs)).not.toThrow();
    const result = computeProject(inputs);
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});
