import { describe, expect, it } from "vitest";
import { computeProject, computeResidualLandValue, computeSensitivityMatrix, profitToCostBenchmark } from "./engine";
import type { CostInputs, LandInputs, ProjectInputs, UnitType } from "./types";

// יחידת עזר: פרויקט "בסיסי" (dealType=basic, קרקע במזומן) מינימלי אבל תקין, עם כל השדות
// הנדרשים, כדי לא לחזור על אובייקט ענק בכל בדיקה. הפרמטרים ניתנים לדריסה per-test.
function baseCosts(overrides: Partial<CostInputs> = {}): CostInputs {
  return {
    balconyWeight: 0.5,
    mainConstructionCostPerSqm: 7000,
    premiumConstructionCostPerSqm: 0,
    commercialConstructionCostPerSqm: 0,
    officeConstructionCostPerSqm: 0,
    publicBuildingConstructionCostPerSqm: 0,
    reinforcementCostPerSqm: 0,
    undergroundConstructionCostPerSqm: 4000,
    balconyConstructionCostRatio: 0.5,
    developmentCostPerSqm: 300,
    undergroundAreaSqm: 200,
    netPlotAreaSqm: 500,
    demolitionFlatNis: 0,
    municipalFees: {
      buildingFeeRatePerSqm: 0,
      waterConnectionRatePerSqm: 0,
      sewageConnectionRatePerSqm: 0,
      roadDrainagePlotRatePerSqm: 0,
      roadDrainageBuildingRatePerSqm: 0,
      roadDrainageUndergroundRatePerSqm: 0,
    },
    relocationUnitsCount: 0,
    relocationMonths: 0,
    relocationRentPerUnitMonthlyNis: 0,
    brokerageRate: 0.01,
    purchaseTaxRate: 0.06,
    electricConnectionPerUnitNis: 3000,
    planningFlatNis: 20000,
    planningConsultantsRate: 0.025,
    engineeringInspectionFlatNis: 50000,
    marketingRate: 0.02,
    legalRate: 0.005,
    legalRefundPerUnitNis: 0,
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
  return { landPurchaseNis: 0, bettermentLevyNis: 0, combinationOwnerShare: 0, combinationLandValueForTaxNis: 0, ...overrides };
}

function unit(overrides: Partial<UnitType> = {}): UnitType {
  return { name: "דירת 4 חדרים", count: 10, areaSqm: 95, mamadSqm: 12, balconySqm: 12, roofBalconySqm: 0, priceNis: 2200000, ...overrides };
}

describe("computeBreakEven", () => {
  it("בפרויקט רווחי מחזיר מרווח ביטחון חיובי ומכפיל מתחת ל-1", () => {
    const inputs: ProjectInputs = {
      dealType: "basic",
      projectName: "רווחי",
      units: [unit()],
      costs: baseCosts(),
      land: baseLand({ landPurchaseNis: 3000000 }),
    };
    const result = computeProject(inputs);
    expect(result.profitability.currentProfitNis).toBeGreaterThan(0);
    expect(result.feasibility.breakEven.priceMultiplier).not.toBeNull();
    expect(result.feasibility.breakEven.priceMultiplier!).toBeLessThan(1);
    expect(result.feasibility.breakEven.marginOfSafetyRatio!).toBeGreaterThan(0);
    expect(result.feasibility.breakEven.averagePricePerSqmNis).not.toBeNull();
  });

  it("בפרויקט הפסדי מחזיר מרווח ביטחון שלילי ומכפיל מעל 1", () => {
    const inputs: ProjectInputs = {
      dealType: "basic",
      projectName: "הפסדי",
      units: [unit({ priceNis: 900000 })],
      costs: baseCosts(),
      land: baseLand({ landPurchaseNis: 8000000 }),
    };
    const result = computeProject(inputs);
    expect(result.profitability.currentProfitNis).toBeLessThan(0);
    expect(result.feasibility.breakEven.marginOfSafetyRatio).not.toBeNull();
    expect(result.feasibility.breakEven.marginOfSafetyRatio!).toBeLessThan(0);
  });

  it("בפרויקט ללא הכנסות מחזיר null בכל השדות, בלי NaN או Infinity", () => {
    const inputs: ProjectInputs = {
      dealType: "basic",
      projectName: "ללא הכנסות",
      units: [unit({ priceNis: 0 })],
      costs: baseCosts(),
      land: baseLand({ landPurchaseNis: 3000000 }),
    };
    const result = computeProject(inputs);
    expect(result.feasibility.breakEven.priceMultiplier).toBeNull();
    expect(result.feasibility.breakEven.averagePricePerSqmNis).toBeNull();
    expect(result.feasibility.breakEven.marginOfSafetyRatio).toBeNull();
    for (const cell of result.feasibility.sensitivityMatrix) {
      expect(Number.isFinite(cell.profitNis)).toBe(true);
      expect(Number.isFinite(cell.profitToCostRatio)).toBe(true);
    }
  });

  it("מתכנס לרווח קרוב ל-0 בפועל בנקודת האיזון שהוחזרה (הוכחת התכנסות)", () => {
    const inputs: ProjectInputs = {
      dealType: "basic",
      projectName: "בדיקת התכנסות",
      units: [unit()],
      costs: baseCosts(),
      land: baseLand({ landPurchaseNis: 3000000 }),
    };
    const base = computeProject(inputs);
    const multiplier = base.feasibility.breakEven.priceMultiplier!;
    const scaledInputs: ProjectInputs = { ...inputs, units: inputs.units.map((u) => ({ ...u, priceNis: u.priceNis * multiplier })) };
    const atBreakEven = computeProject(scaledInputs);
    expect(Math.abs(atBreakEven.profitability.currentProfitNis)).toBeLessThan(10);
  });
});

describe("computeResidualLandValue", () => {
  it("בעסקת מזומן מחזיר שווי קרקע שמשיג את יעד הרווח-לעלות המקובל", () => {
    const inputs: ProjectInputs = {
      dealType: "basic",
      projectName: "שווי שיורי",
      units: [unit()],
      costs: baseCosts(),
      land: baseLand({ landPurchaseNis: 0 }),
    };
    const residual = computeResidualLandValue(inputs);
    expect(residual).not.toBeNull();
    const target = profitToCostBenchmark("basic")!;
    const withResidualLand = computeProject({ ...inputs, land: { ...inputs.land, landPurchaseNis: residual! } });
    expect(Math.abs(withResidualLand.profitability.profitToCostRatio - target)).toBeLessThan(0.001);
  });

  it("מחזיר null בעסקת תמורה (תמ\"א 38) ובעסקת קומבינציה", () => {
    const tama38: ProjectInputs = {
      dealType: "tama38",
      projectName: "תמורה",
      units: [unit({ isCompensationUnit: true, priceNis: 0 }), unit({ name: "יחידה נמכרת" })],
      costs: baseCosts({ relocationUnitsCount: 5, relocationMonths: 12, relocationRentPerUnitMonthlyNis: 3000 }),
      land: baseLand({ bettermentLevyNis: 100000 }),
    };
    expect(computeResidualLandValue(tama38)).toBeNull();

    const kombinatsia: ProjectInputs = {
      dealType: "kombinatsia",
      projectName: "קומבינציה",
      units: [unit()],
      costs: baseCosts(),
      land: baseLand({ combinationOwnerShare: 0.35, combinationLandValueForTaxNis: 2000000 }),
    };
    expect(computeResidualLandValue(kombinatsia)).toBeNull();
  });
});

describe("computeSensitivityMatrix", () => {
  const inputs: ProjectInputs = {
    dealType: "basic",
    projectName: "מטריצה",
    units: [unit()],
    costs: baseCosts(),
    land: baseLand({ landPurchaseNis: 3000000 }),
  };

  it("מכילה 25 תאים, ותא הבסיס (1,1) זהה לתוצאת הפרויקט הרגילה", () => {
    const result = computeProject(inputs);
    expect(result.feasibility.sensitivityMatrix).toHaveLength(25);
    const baseCell = result.feasibility.sensitivityMatrix.find((c) => c.revenueFactor === 1 && c.costFactor === 1);
    expect(baseCell).toBeDefined();
    expect(baseCell!.profitNis).toBeCloseTo(result.profitability.currentProfitNis, 6);
    expect(baseCell!.profitToCostRatio).toBeCloseTo(result.profitability.profitToCostRatio, 9);
  });

  it("מונוטונית: הכנסות גבוהות יותר משפרות את הרווח, עלויות בנייה גבוהות יותר מרעות אותו", () => {
    const matrix = computeSensitivityMatrix(inputs);
    const at = (revenueFactor: number, costFactor: number) => matrix.find((c) => c.revenueFactor === revenueFactor && c.costFactor === costFactor)!;

    expect(at(1.1, 1).profitNis).toBeGreaterThan(at(1, 1).profitNis);
    expect(at(0.9, 1).profitNis).toBeLessThan(at(1, 1).profitNis);
    expect(at(1, 1.1).profitNis).toBeLessThan(at(1, 1).profitNis);
    expect(at(1, 0.9).profitNis).toBeGreaterThan(at(1, 1).profitNis);
  });
});

describe("אי-מוטציה של הקלט", () => {
  it("computeProject לא משנה את אובייקט הקלט המקורי", () => {
    const inputs: ProjectInputs = {
      dealType: "basic",
      projectName: "בדיקת מוטציה",
      units: [unit()],
      costs: baseCosts(),
      land: baseLand({ landPurchaseNis: 3000000 }),
    };
    const snapshot = JSON.parse(JSON.stringify(inputs));
    computeProject(inputs);
    expect(inputs).toEqual(snapshot);
  });
});
