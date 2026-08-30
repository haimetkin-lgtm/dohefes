import { describe, expect, it } from "vitest";
import { computeProject } from "./engine";
import type { CostInputs, ProjectInputs } from "./types";

function costs(overrides: Partial<CostInputs> = {}): CostInputs {
  return {
    balconyWeight: 0.5,
    mainConstructionCostPerSqm: 5_000,
    premiumConstructionCostPerSqm: 0,
    commercialConstructionCostPerSqm: 0,
    officeConstructionCostPerSqm: 0,
    publicBuildingConstructionCostPerSqm: 0,
    reinforcementCostPerSqm: 0,
    undergroundConstructionCostPerSqm: 0,
    balconyConstructionCostRatio: 0.5,
    developmentCostPerSqm: 0,
    undergroundAreaSqm: 0,
    netPlotAreaSqm: 0,
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
    brokerageRate: 0,
    purchaseTaxRate: 0,
    electricConnectionPerUnitNis: 0,
    planningFlatNis: 0,
    planningConsultantsRate: 0,
    engineeringInspectionFlatNis: 0,
    marketingRate: 0.03,
    legalRate: 0.01,
    legalRefundPerUnitNis: -5_000,
    financialSupervisionFlatNis: 0,
    overheadRate: 0,
    managementFeeRate: 0,
    contingencyRate: 0,
    guaranteeCommissionRate: 0.0085,
    unusedCreditCommissionRate: 0.0025,
    accountOpeningCommissionRate: 0.0035,
    annualInterestRate: 0.04,
    constructionMonths: 36,
    permitMonths: 3,
    equityNis: 0,
    presaleRate: 0,
    organizerFeeNis: 150_000,
    ...overrides,
  };
}

function project(dealType: ProjectInputs["dealType"], costOverrides: Partial<CostInputs> = {}): ProjectInputs {
  return {
    dealType,
    projectName: "בדיקת התאמה למפרט",
    units: [
      {
        name: "דירה",
        count: 10,
        areaSqm: 100,
        mamadSqm: 0,
        balconySqm: 0,
        roofBalconySqm: 0,
        priceNis: 2_340_000,
      },
    ],
    costs: costs(costOverrides),
    land: {
      landPurchaseNis: 5_000_000,
      bettermentLevyNis: 0,
      combinationOwnerShare: 0.4,
      combinationLandValueForTaxNis: 5_000_000,
    },
  };
}

describe("התאמה מפורשת למפרטי קובצי המקור", () => {
  it("קבוצת רכישה: תרחיש הבסיס אינו כולל מימון בנקאי או עמלות מימון", () => {
    const result = computeProject(project("purchaseGroup"));
    expect(result.costs.financingNis).toBe(0);
    expect(result.costs.commissionsNis).toBe(0);
  });

  it("קבוצת רכישה: שיווק, משפטי והחזר משפטי אינם מועמסים על תקציב הפרויקט", () => {
    const withLegacyRates = computeProject(project("purchaseGroup"));
    const withoutLegacyRates = computeProject(
      project("purchaseGroup", { marketingRate: 0, legalRate: 0, legalRefundPerUnitNis: 0 })
    );
    expect(withLegacyRates.costs.indirectNis).toBeCloseTo(withoutLegacyRates.costs.indirectNis, 6);
  });

  it("קבוצת רכישה: מפיק P&L נפרד למארגן לפי מקטע המקור", () => {
    const result = computeProject(project("purchaseGroup", {
      brokerageRate: 0.01,
      purchaseTaxRate: 0.06,
      organizerOptionTradingNis: 1_000_000,
      organizerMarketingRate: 0.025,
      organizerOverheadRate: 0.025,
    }));
    expect(result.organizerProfitability).toMatchObject({
      landRevenueNis: 5_000_000,
      optionTradingRevenueNis: 1_000_000,
      managementRevenueNis: 150_000,
      totalRevenueNis: 6_150_000,
      landAcquisitionNis: 5_000_000,
      purchaseTaxNis: 300_000,
      brokerageNis: 50_000,
      marketingNis: 500_000,
      overheadNis: 125_000,
      totalCostsNis: 5_975_000,
      profitNis: 175_000,
    });
    expect(result.organizerProfitability?.profitToOrganizerRevenueRatio).toBeCloseTo(175_000 / 6_150_000, 8);
  });

  it("קבוצת רכישה: מציג את שתי חלופות חלוקת ההוצאות מהמקור", () => {
    const inputs = project("purchaseGroup");
    inputs.units = [
      { name: "קטנה", count: 1, areaSqm: 100, mamadSqm: 0, balconySqm: 0, roofBalconySqm: 0, priceNis: 1_000_000 },
      { name: "גדולה", count: 1, areaSqm: 200, mamadSqm: 0, balconySqm: 0, roofBalconySqm: 0, priceNis: 3_000_000 },
    ];
    const result = computeProject(inputs);
    expect(result.purchaseGroupAllocation?.byMarketValue.map((row) => row.allocationShare)).toEqual([0.25, 0.75]);
    expect(result.purchaseGroupAllocation?.byEquivalentArea[0].allocationShare).toBeCloseTo(1 / 3, 8);
    expect(result.purchaseGroupAllocation?.byEquivalentArea[1].allocationShare).toBeCloseTo(2 / 3, 8);
    for (const rows of [result.purchaseGroupAllocation!.byMarketValue, result.purchaseGroupAllocation!.byEquivalentArea]) {
      expect(rows.reduce((sum, row) => sum + row.allocationShare, 0)).toBeCloseTo(1, 8);
      expect(rows.reduce((sum, row) => sum + row.count * row.landSharePerUnitNis, 0)).toBeCloseTo(result.costs.landNis, 6);
      expect(rows.reduce((sum, row) => sum + row.count * row.totalCostPerUnitNis, 0)).toBeCloseTo(result.costs.totalInclFinancingNis, 6);
    }
  });

  it("קומבינציית תמורות: עלות השיווק נגזרת מהכנסת הפרויקט המלאה ולא רק מחלק היזם", () => {
    const withMarketing = computeProject(project("kombinatsiaTemurot"));
    const withoutMarketing = computeProject(project("kombinatsiaTemurot", { marketingRate: 0 }));
    const expectedFullProjectRevenueExVat = 10 * 2_340_000 / 1.17;
    expect(withMarketing.costs.indirectNis - withoutMarketing.costs.indirectNis).toBeCloseTo(
      expectedFullProjectRevenueExVat * 0.03,
      6
    );
  });

  it("קומבינציית תמורות: ערבות הבעלים מחושבת ישירות ואינה משכפלת את #REF! במקור", () => {
    const result = computeProject(project("kombinatsiaTemurot", { ownerGuaranteeCommissionRate: 0.0085 }));
    const expected = result.revenue.totalRevenueInclVatNis * 0.4 * 0.0085;
    expect(result.costs.ownerGuaranteeCommissionNis).toBeCloseTo(expected, 6);
    const without = computeProject(project("kombinatsiaTemurot", { ownerGuaranteeCommissionRate: 0 }));
    expect(result.costs.commissionsNis - without.costs.commissionsNis).toBeCloseTo(expected, 6);
  });

  it("מעורב שימושים: הכנסת היזם משתמשת באחוז בעלים נפרד לכל שימוש", () => {
    const inputs = project("mixedUse");
    inputs.units = [
      { name: "מגורים", category: "residential", count: 1, areaSqm: 100, mamadSqm: 0, balconySqm: 0, roofBalconySqm: 0, priceNis: 1_170_000 },
      { name: "מסחר", category: "commercial", count: 1, areaSqm: 100, mamadSqm: 0, balconySqm: 0, roofBalconySqm: 0, priceNis: 1_000_000 },
      { name: "משרדים", category: "office", count: 1, areaSqm: 100, mamadSqm: 0, balconySqm: 0, roofBalconySqm: 0, priceNis: 1_000_000 },
    ];
    inputs.land.mixedUseResidentialOwnerShare = 0.345;
    inputs.land.mixedUseCommercialOwnerShare = 0.38;
    inputs.land.mixedUseOfficeOwnerShare = 0.25;
    const result = computeProject(inputs);
    expect(result.revenue.developerRevenueExclVatNis).toBeCloseTo(
      1_000_000 * (1 - 0.345) + 1_000_000 * (1 - 0.38) + 1_000_000 * (1 - 0.25),
      6
    );
  });

  it("מעורב שימושים: מפיק שלוש רווחיויות שימוש שמתיישבות בדיוק לתוצאה הכוללת", () => {
    const inputs = project("mixedUse", { commercialConstructionCostPerSqm: 4_000, officeConstructionCostPerSqm: 3_000 });
    inputs.units = [
      { name: "מגורים", category: "residential", count: 2, areaSqm: 100, mamadSqm: 10, balconySqm: 10, roofBalconySqm: 0, priceNis: 2_340_000 },
      { name: "מסחר", category: "commercial", count: 1, areaSqm: 80, mamadSqm: 0, balconySqm: 0, roofBalconySqm: 0, priceNis: 1_500_000 },
      { name: "משרדים", category: "office", count: 1, areaSqm: 120, mamadSqm: 0, balconySqm: 0, roofBalconySqm: 0, priceNis: 2_000_000 },
    ];
    inputs.land.bettermentLevyNis = 1_000_000;
    const result = computeProject(inputs);
    expect(result.mixedUseProfitability?.map((row) => row.use)).toEqual(["residential", "commercial", "office"]);
    expect(result.mixedUseProfitability!.reduce((sum, row) => sum + row.revenueNis, 0)).toBeCloseTo(result.profitability.revenueNis, 6);
    expect(result.mixedUseProfitability!.reduce((sum, row) => sum + row.totalCostNis, 0)).toBeCloseTo(result.profitability.totalCostNis, 6);
    expect(result.mixedUseProfitability!.reduce((sum, row) => sum + row.profitNis, 0)).toBeCloseTo(result.profitability.currentProfitNis, 6);
    const changed = structuredClone(inputs);
    changed.land.mixedUseCommercialLandWeightPerSqm = 100_000;
    expect(computeProject(changed).mixedUseProfitability![1].allocatedSharedCostsNis).toBeGreaterThan(result.mixedUseProfitability![1].allocatedSharedCostsNis);
  });

  it("מסחר ומשרדים: חיבורי חשמל מחושבים לפי שטח ולא כמספר דירות", () => {
    const inputs = project("mixedUse", {
      electricConnectionPerUnitNis: 4_500,
      commercialElectricConnectionPerSqmNis: 50,
      officeElectricConnectionPerSqmNis: 25,
    });
    inputs.units = [
      { name: "דירה", category: "residential", count: 2, areaSqm: 100, mamadSqm: 0, balconySqm: 0, roofBalconySqm: 0, priceNis: 1_170_000 },
      { name: "מסחר", category: "commercial", count: 10, areaSqm: 80, mamadSqm: 0, balconySqm: 0, roofBalconySqm: 0, priceNis: 100_000 },
      { name: "משרד", category: "office", count: 5, areaSqm: 120, mamadSqm: 0, balconySqm: 0, roofBalconySqm: 0, priceNis: 100_000 },
    ];
    const withConnections = computeProject(inputs);
    const withoutConnections = computeProject({ ...inputs, costs: { ...inputs.costs, electricConnectionPerUnitNis: 0, commercialElectricConnectionPerSqmNis: 0, officeElectricConnectionPerSqmNis: 0 } });
    expect(withConnections.costs.indirectNis - withoutConnections.costs.indirectNis).toBeCloseTo(
      2 * 4_500 + 10 * 80 * 50 + 5 * 120 * 25,
      6
    );
  });

  it("מעורב שימושים: דוח ישן ללא שדות הפיצול נשאר תואם לאחוז האחיד הישן", () => {
    const inputs = project("mixedUse");
    inputs.land.combinationOwnerShare = 0.4;
    const result = computeProject(inputs);
    expect(result.revenue.developerRevenueExclVatNis).toBeCloseTo(result.revenue.totalRevenueExclVatNis * 0.6, 6);
  });

  it("אחוז בעלים מחוץ לטווח מייצר אזהרה מפורשת", () => {
    const inputs = project("mixedUse");
    inputs.land.mixedUseCommercialOwnerShare = 1.2;
    expect(computeProject(inputs).warnings.some((warning) => warning.includes("מסחר") && warning.includes("בין 0 ל-1"))).toBe(true);
  });

  it("תיווך בעסקת מזומן חל על רכישת הקרקע בלבד ולא על היטל השבחה", () => {
    const inputs = project("basic", { brokerageRate: 0.01 });
    inputs.land.landPurchaseNis = 5_000_000;
    inputs.land.bettermentLevyNis = 2_000_000;
    const withBrokerage = computeProject(inputs);
    const withoutBrokerage = computeProject({ ...inputs, costs: { ...inputs.costs, brokerageRate: 0 } });
    expect(withBrokerage.costs.indirectNis - withoutBrokerage.costs.indirectNis).toBeCloseTo(50_000, 6);
  });

  it("בקומבינציה לא נוסף תיווך נפרד על היטל ההשבחה", () => {
    const inputs = project("kombinatsia", { brokerageRate: 0.01 });
    inputs.land.bettermentLevyNis = 2_000_000;
    const withBrokerageRate = computeProject(inputs);
    const withoutBrokerageRate = computeProject({ ...inputs, costs: { ...inputs.costs, brokerageRate: 0 } });
    expect(withBrokerageRate.costs.indirectNis).toBeCloseTo(withoutBrokerageRate.costs.indirectNis, 6);
  });

  it("ממ״ד מחויב בעלות בנייה מלאה ורק מרפסות במקדם המרפסות", () => {
    const inputs = project("basic", {
      mainConstructionCostPerSqm: 5_000,
      balconyConstructionCostRatio: 0.5,
      marketingRate: 0,
      legalRate: 0,
      legalRefundPerUnitNis: 0,
      guaranteeCommissionRate: 0,
      unusedCreditCommissionRate: 0,
      accountOpeningCommissionRate: 0,
      annualInterestRate: 0,
    });
    inputs.land.landPurchaseNis = 0;
    inputs.units = [{ name: "דירה", count: 1, areaSqm: 100, mamadSqm: 12, balconySqm: 10, roofBalconySqm: 4, priceNis: 0 }];
    const result = computeProject(inputs);
    expect(result.costs.directConstructionNis).toBe(100 * 5_000 + 12 * 5_000 + 14 * 2_500);
    expect(result.costs.constructionBreakdown[0]).toMatchObject({
      mamadAreaSqm: 12,
      mamadCostNis: 60_000,
      balconyAreaSqm: 14,
      balconyCostNis: 35_000,
    });
  });

  it("משפטי מחושב על מגורים בלבד ולא על מסחר או משרדים", () => {
    const inputs = project("mixedUse", {
      marketingRate: 0,
      legalRate: 0.01,
      legalRefundPerUnitNis: 0,
      guaranteeCommissionRate: 0,
      unusedCreditCommissionRate: 0,
      accountOpeningCommissionRate: 0,
      annualInterestRate: 0,
    });
    inputs.units = [
      { name: "דירה", category: "residential", count: 1, areaSqm: 80, mamadSqm: 0, balconySqm: 0, roofBalconySqm: 0, priceNis: 1_170_000 },
      { name: "חנות", category: "commercial", count: 1, areaSqm: 50, mamadSqm: 0, balconySqm: 0, roofBalconySqm: 0, priceNis: 10_000_000 },
    ];
    inputs.land.mixedUseResidentialOwnerShare = 0.2;
    inputs.land.mixedUseCommercialOwnerShare = 0.4;
    const withLegal = computeProject(inputs);
    const withoutLegal = computeProject({ ...inputs, costs: { ...inputs.costs, legalRate: 0 } });
    expect(withLegal.costs.indirectNis - withoutLegal.costs.indirectNis).toBeCloseTo(800_000 * 1.17 * 0.01, 6);
  });

  it("קומבינציית תמורות: משפטי חל על כלל המגורים אך לא על מסחר", () => {
    const inputs = project("kombinatsiaTemurot", {
      marketingRate: 0,
      legalRate: 0.01,
      legalRefundPerUnitNis: 0,
      guaranteeCommissionRate: 0,
      unusedCreditCommissionRate: 0,
      accountOpeningCommissionRate: 0,
      annualInterestRate: 0,
    });
    inputs.units = [
      { name: "דירה", category: "residential", count: 1, areaSqm: 80, mamadSqm: 0, balconySqm: 0, roofBalconySqm: 0, priceNis: 1_170_000 },
      { name: "חנות", category: "commercial", count: 1, areaSqm: 50, mamadSqm: 0, balconySqm: 0, roofBalconySqm: 0, priceNis: 10_000_000 },
    ];
    inputs.land.combinationOwnerShare = 0.4;
    const withLegal = computeProject(inputs);
    const withoutLegal = computeProject({ ...inputs, costs: { ...inputs.costs, legalRate: 0 } });
    expect(withLegal.costs.indirectNis - withoutLegal.costs.indirectNis).toBeCloseTo(1_000_000 * 1.17 * 0.01, 6);
  });

  it("חיבור חשמל והחזר שכ״ט ליח״ד נספרים רק ליחידות מגורים", () => {
    const inputs = project("mixedUse", {
      electricConnectionPerUnitNis: 4_500,
      legalRefundPerUnitNis: -5_000,
      marketingRate: 0,
      legalRate: 0,
      guaranteeCommissionRate: 0,
      unusedCreditCommissionRate: 0,
      accountOpeningCommissionRate: 0,
      annualInterestRate: 0,
    });
    inputs.units = [
      { name: "דירות", category: "residential", count: 10, areaSqm: 80, mamadSqm: 0, balconySqm: 0, roofBalconySqm: 0, priceNis: 0 },
      { name: "חנויות", category: "commercial", count: 20, areaSqm: 50, mamadSqm: 0, balconySqm: 0, roofBalconySqm: 0, priceNis: 0 },
    ];
    const withPerUnitItems = computeProject(inputs);
    const withoutPerUnitItems = computeProject({
      ...inputs,
      costs: { ...inputs.costs, electricConnectionPerUnitNis: 0, legalRefundPerUnitNis: 0 },
    });
    expect(withPerUnitItems.costs.indirectNis - withoutPerUnitItems.costs.indirectNis).toBe(-5_000);
  });

  it("סה״כ הכנסה כולל מע״מ מנרמל מחירי מסחר ומשרדים שהוזנו נטו", () => {
    const inputs = project("mixedUse");
    inputs.units = [
      { name: "דירה", category: "residential", count: 1, areaSqm: 80, mamadSqm: 0, balconySqm: 0, roofBalconySqm: 0, priceNis: 1_170_000 },
      { name: "חנות", category: "commercial", count: 1, areaSqm: 50, mamadSqm: 0, balconySqm: 0, roofBalconySqm: 0, priceNis: 1_000_000 },
      { name: "משרד", category: "office", count: 1, areaSqm: 50, mamadSqm: 0, balconySqm: 0, roofBalconySqm: 0, priceNis: 2_000_000 },
    ];
    const revenue = computeProject(inputs).revenue;
    expect(revenue.totalRevenueExclVatNis).toBeCloseTo(4_000_000, 6);
    expect(revenue.totalRevenueInclVatNis).toBeCloseTo(4_680_000, 6);
  });

  it("גם במבנה קיים ממ״ד מוצג ומחויב בנפרד ממרפסת", () => {
    const inputs = project("tama38", {
      mainConstructionCostPerSqm: 9_000,
      reinforcementCostPerSqm: 3_000,
      balconyConstructionCostRatio: 0.5,
    });
    inputs.units = [{ name: "מבנה קיים", count: 1, areaSqm: 80, mamadSqm: 5, balconySqm: 10, roofBalconySqm: 0, priceNis: 0, isExistingStructure: true }];
    const row = computeProject(inputs).costs.constructionBreakdown[0];
    expect(row).toMatchObject({
      category: "existingStructure",
      mainCostNis: 240_000,
      mamadAreaSqm: 5,
      mamadCostNis: 15_000,
      balconyAreaSqm: 10,
      balconyCostNis: 15_000,
      otherCostNis: 30_000,
    });
  });
});
