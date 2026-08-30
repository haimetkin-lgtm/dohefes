import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { computeProject } from "../calc/engine";
import type { CostInputs, ProjectInputs } from "../calc/types";
import { buildWorkbook } from "./exportExcel";

const ZERO_COSTS: CostInputs = {
  balconyWeight: 0.5,
  mainConstructionCostPerSqm: 1,
  premiumConstructionCostPerSqm: 1,
  commercialConstructionCostPerSqm: 1,
  officeConstructionCostPerSqm: 1,
  publicBuildingConstructionCostPerSqm: 1,
  reinforcementCostPerSqm: 1,
  undergroundConstructionCostPerSqm: 0,
  balconyConstructionCostRatio: 0.5,
  developmentCostPerSqm: 0,
  undergroundAreaSqm: 0,
  netPlotAreaSqm: 0,
  demolitionFlatNis: 0,
  municipalFees: { buildingFeeRatePerSqm: 0, waterConnectionRatePerSqm: 0, sewageConnectionRatePerSqm: 0, roadDrainagePlotRatePerSqm: 0, roadDrainageBuildingRatePerSqm: 0, roadDrainageUndergroundRatePerSqm: 0 },
  relocationUnitsCount: 0,
  relocationMonths: 0,
  relocationRentPerUnitMonthlyNis: 0,
  brokerageRate: 0,
  purchaseTaxRate: 0,
  electricConnectionPerUnitNis: 0,
  planningFlatNis: 0,
  planningConsultantsRate: 0,
  engineeringInspectionFlatNis: 0,
  marketingRate: 0,
  legalRate: 0,
  legalRefundPerUnitNis: 0,
  financialSupervisionFlatNis: 0,
  overheadRate: 0,
  managementFeeRate: 0,
  contingencyRate: 0,
  guaranteeCommissionRate: 0,
  unusedCreditCommissionRate: 0,
  accountOpeningCommissionRate: 0,
  annualInterestRate: 0,
  constructionMonths: 1,
  permitMonths: 0,
  equityNis: 0,
  presaleRate: 0,
  organizerFeeNis: 0,
};

describe("ייצוא דוח אפס ל-Excel", () => {
  it("מציג קטגוריה ובסיס מע״מ נכון לכל שורת תמהיל", () => {
    const inputs: ProjectInputs = {
      dealType: "mixedUse",
      projectName: "בדיקת ייצוא",
      units: [
        { name: "דירה", category: "residential", count: 1, areaSqm: 80, mamadSqm: 12, balconySqm: 10, roofBalconySqm: 0, priceNis: 2_340_000 },
        { name: "חנות", category: "commercial", count: 1, areaSqm: 50, mamadSqm: 0, balconySqm: 0, roofBalconySqm: 0, priceNis: 1_000_000 },
      ],
      costs: ZERO_COSTS,
      land: { landPurchaseNis: 0, bettermentLevyNis: 0, combinationOwnerShare: 0.3, combinationLandValueForTaxNis: 0 },
    };
    const workbook = buildWorkbook(inputs, computeProject(inputs));
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(workbook.Sheets["תמהיל דירות"], { header: 1 });
    expect(rows[0]).toContain("קטגוריה");
    expect(rows[0]).toContain("בסיס מע\"מ במחיר");
    expect(rows[1]).toContain("מגורים");
    expect(rows[1]).toContain("כולל מע\"מ");
    expect(rows[2]).toContain("מסחר");
    expect(rows[2]).toContain("ללא מע\"מ");
    expect(workbook.SheetNames).toEqual(["פרטי פרויקט", "תמהיל דירות", "הנחות ועלויות", "תוצאות", "רווחיות לפי שימוש"]);
    const useRows = XLSX.utils.sheet_to_json<(string | number)[]>(workbook.Sheets["רווחיות לפי שימוש"], { header: 1 });
    expect(useRows.some((row) => row[0] === "מגורים")).toBe(true);
    expect(useRows.some((row) => row[0] === "מסחר")).toBe(true);
    const assumptions = XLSX.utils.sheet_to_json<(string | number)[]>(workbook.Sheets["הנחות ועלויות"], { header: 1 });
    expect(assumptions.some((row) => row[0] === "עלות מגורים למ״ר (₪)" && row[1] === 1)).toBe(true);
    expect(assumptions.some((row) => row[0] === "ריבית שנתית (%)" && row[1] === 0)).toBe(true);
  });

  it("מוסיף גיליון P&L נפרד בקבוצת רכישה", () => {
    const inputs: ProjectInputs = {
      dealType: "purchaseGroup",
      projectName: "בדיקת מארגן",
      units: [{ name: "דירה", count: 1, areaSqm: 100, mamadSqm: 0, balconySqm: 0, roofBalconySqm: 0, priceNis: 1_170_000 }],
      costs: { ...ZERO_COSTS, organizerFeeNis: 150_000, organizerOptionTradingNis: 250_000 },
      land: { landPurchaseNis: 500_000, bettermentLevyNis: 0, combinationOwnerShare: 0, combinationLandValueForTaxNis: 0 },
    };
    const workbook = buildWorkbook(inputs, computeProject(inputs));
    expect(workbook.SheetNames).toContain("תחשיב מארגן");
    expect(workbook.SheetNames).toContain("חלוקה לפי שווי");
    expect(workbook.SheetNames).toContain("חלוקה לפי שטח");
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(workbook.Sheets["תחשיב מארגן"], { header: 1 });
    expect(rows.some((row) => row[0] === "הכנסה מסיחור אופציה (₪)" && row[1] === 250_000)).toBe(true);
  });
});
