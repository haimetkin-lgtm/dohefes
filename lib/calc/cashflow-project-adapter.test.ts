import { describe, expect, it } from "vitest";
import { computeAreas, computeProject, computeRevenue, computeVatInclusiveRevenueBasedAmount } from "./engine";
import type { CostInputs, LandInputs, ProjectInputs, UnitType } from "./types";
import {
  prepareCashFlowInput,
  type ProjectCashFlowAssumptions,
  type ProjectSalesRowAssumption,
} from "./cashflow-project-adapter";
import { computeCashFlow } from "./cashflow-engine";
import type { CashFlowGuaranteeInput } from "./cashflow-engine";

// אותו דפוס fixture כמו feasibility.test.ts - פרויקט "בסיסי" מינימלי אבל תקין
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

function typicalProjectInputs(overrides: Partial<ProjectInputs> = {}): ProjectInputs {
  return {
    dealType: "basic",
    projectName: "פרויקט טיפוסי",
    units: [unit()],
    costs: baseCosts(),
    land: baseLand({ landPurchaseNis: 3_000_000 }),
    ...overrides,
  };
}

describe("ProjectInputs ישן נטען בלי שינוי", () => {
  it("הפעלת ה-adapter על דוח טיפוסי לא נכשלת ומחזירה needsAssumptions (לא crash)", () => {
    const result = prepareCashFlowInput(typicalProjectInputs());
    expect(result.status).toBe("needsAssumptions");
    expect(Array.isArray(result.missingAssumptions)).toBe(true);
  });
});

describe("הקריאה ל-adapter אינה משנה את הקלט", () => {
  it("אין מוטציה של ProjectInputs", () => {
    const inputs = typicalProjectInputs();
    const snapshot = JSON.parse(JSON.stringify(inputs));

    prepareCashFlowInput(inputs);

    expect(inputs).toEqual(snapshot);
  });

  it("אין מוטציה של assumptions (מבנה 8c)", () => {
    const inputs = readyProjectInputs();
    const assumptions: ProjectCashFlowAssumptions = readyAssumptions();
    const snapshot = JSON.parse(JSON.stringify(assumptions));

    prepareCashFlowInput(inputs, assumptions);

    expect(assumptions).toEqual(snapshot);
  });
});

describe("דוח ישן חלקי (בלי assumptions) מחזיר needsAssumptions, לא מספרים מומצאים", () => {
  it("קודי חוסר צפויים קיימים: לוח מכירות, שורת מכירה, עיתוי עלות, בסיס אי-ניצול, מסגרת אשראי, עקומת בנייה, ערבויות", () => {
    const result = prepareCashFlowInput(typicalProjectInputs());
    expect(result.status).toBe("needsAssumptions");
    if (result.status !== "needsAssumptions") return;
    const codes = result.missingAssumptions.map((m) => m.code);
    expect(codes).toContain("SALES_ROW_ASSUMPTION_MISSING");
    expect(codes).toContain("SALES_SCHEDULE_MODEL_MISSING");
    expect(codes).toContain("COST_TIMING_MISSING");
    expect(codes).toContain("UNUSED_FACILITY_BASIS_MISSING");
    expect(codes).toContain("CREDIT_FACILITY_LIMIT_MISSING");
    expect(codes).toContain("CONSTRUCTION_CURVE_MISSING");
    expect(codes).toContain("GUARANTEES_MISSING");
    expect(codes).toContain("OPENING_FEE_CHARGE_MONTH_MISSING");
    // commit 8c: הבעיה הטכנית (VAT_FACTOR לא מיוצא) נפתרה - אין יותר קוד שחוסם את סכום העמלה עצמו
    expect(codes).not.toContain("OPENING_FEE_AMOUNT_REQUIRES_VAT_FACTOR");
    // כל שדה חוסר מובנה, לא רק טקסט
    for (const m of result.missingAssumptions) {
      expect(typeof m.code).toBe("string");
      expect(typeof m.path).toBe("string");
      expect(typeof m.message).toBe("string");
      expect(["required", "professionalVerification"]).toContain(m.severity);
    }
  });
});

describe("commit 8c: legal אינו חסום יותר על טעם טכני", () => {
  it("legalRate>0 בלי assumptions -> עדיין COST_TIMING_MISSING (כמו כל פריט עלות), אך הסכום עצמו לא חסום", () => {
    const result = prepareCashFlowInput(typicalProjectInputs());
    if (result.status !== "needsAssumptions") throw new Error("expected needsAssumptions");
    const codes = result.missingAssumptions.map((m) => m.code);
    // legal מגיע עכשיו כמו כל פריט עלות אחר - חסר רק timing, לא הסכום עצמו
    expect(result.missingAssumptions.some((m) => m.code === "COST_TIMING_MISSING" && m.path.includes("legal"))).toBe(true);
    expect(codes.join(" ")).not.toMatch(/legal.*vat|vat.*legal/i);
  });

  it("הסכום המחושב ל-legal ב-cashFlowInput.costSchedule זהה בדיוק ל-helper המשותף מ-engine.ts (מקור אמת יחיד)", () => {
    const inputs = readyProjectInputs();
    const result = prepareCashFlowInput(inputs, readyAssumptions());
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const areas = computeAreas(inputs);
    const revenue = computeRevenue(inputs, areas);
    const developerResidentialRevenueExclVatNis =
      revenue.byCategory.residential.developerRevenueExclVatNis +
      revenue.byCategory.residentialPremium.developerRevenueExclVatNis;
    const totalResidentialRevenueExclVatNis =
      revenue.byCategory.residential.totalRevenueExclVatNis +
      revenue.byCategory.residentialPremium.totalRevenueExclVatNis;
    const legalBasis =
      inputs.dealType === "kombinatsiaTemurot" ? totalResidentialRevenueExclVatNis : developerResidentialRevenueExclVatNis;
    const expectedLegal =
      inputs.dealType === "purchaseGroup"
        ? 0
        : computeVatInclusiveRevenueBasedAmount(legalBasis, inputs.costs.legalRate);
    expect(result.cashFlowInput.costSchedule.totalsByItemId.legal).toBeCloseTo(expectedLegal, 6);
  });
});

describe("commit 8c: עמלת פתיחת תיק ממופה פעם אחת בלבד, לא בלוח העלויות", () => {
  it("accountOpeningCommission אינו מפתח חוקי כלל ב-costAmountsByItemId - לא מופיע בלוח העלויות בתרחיש ready", () => {
    const result = prepareCashFlowInput(readyProjectInputs(), readyAssumptions());
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(Object.keys(result.cashFlowInput.costSchedule.totalsByItemId)).not.toContain("accountOpeningCommission");
    expect(result.cashFlowInput.financingFeeAssumptions.openingFee).toBeDefined();
  });

  it("accountOpeningCommissionRate>0 בלי financing.openingFee -> OPENING_FEE_CHARGE_MONTH_MISSING עם הסכום המחושב בהודעה, לא חסימה על VAT_FACTOR", () => {
    const inputs = typicalProjectInputs({ costs: baseCosts({ accountOpeningCommissionRate: 0.0045 }) });
    const result = prepareCashFlowInput(inputs);
    if (result.status !== "needsAssumptions") throw new Error("expected needsAssumptions");
    const entry = result.missingAssumptions.find((m) => m.code === "OPENING_FEE_CHARGE_MONTH_MISSING");
    expect(entry).toBeDefined();
    const areas = computeAreas(inputs);
    const revenue = computeRevenue(inputs, areas);
    const expectedAmount = computeVatInclusiveRevenueBasedAmount(revenue.developerRevenueExclVatNis, inputs.costs.accountOpeningCommissionRate);
    expect(entry!.message).toContain(expectedAmount.toFixed(2));
  });

  it("accountOpeningCommissionRate=0 בלי financing.openingFee -> אין שום דגל עמלת פתיחה", () => {
    const inputs = typicalProjectInputs({ costs: baseCosts({ accountOpeningCommissionRate: 0 }) });
    const result = prepareCashFlowInput(inputs);
    if (result.status !== "needsAssumptions") throw new Error("expected needsAssumptions");
    const codes = result.missingAssumptions.map((m) => m.code);
    expect(codes).not.toContain("OPENING_FEE_CHARGE_MONTH_MISSING");
  });
});

describe("שיעור ריבית עשרוני ממופה; ערך בסגנון 6 נדחה", () => {
  it("0.04 (שבר עשרוני, ברירת מחדל) - אין INTEREST_RATE_LOOKS_LIKE_PERCENT", () => {
    const result = prepareCashFlowInput(typicalProjectInputs());
    if (result.status !== "needsAssumptions") throw new Error("expected needsAssumptions");
    const codes = result.missingAssumptions.map((m) => m.code);
    expect(codes).not.toContain("INTEREST_RATE_LOOKS_LIKE_PERCENT");
  });

  it("6 (נראה כמו אחוז) דרך assumptions.financing.annualInterestRate - נדחה, לא מומר אוטומטית ל-0.06", () => {
    const inputs = readyProjectInputs();
    const assumptions: ProjectCashFlowAssumptions = { ...readyAssumptions(), financing: { ...readyAssumptions().financing, annualInterestRate: 6 } };
    const result = prepareCashFlowInput(inputs, assumptions);
    if (result.status !== "needsAssumptions") throw new Error("expected needsAssumptions");
    const codes = result.missingAssumptions.map((m) => m.code);
    expect(codes).toContain("INTEREST_RATE_LOOKS_LIKE_PERCENT");
    const entry = result.missingAssumptions.find((m) => m.code === "INTEREST_RATE_LOOKS_LIKE_PERCENT")!;
    expect(entry.severity).toBe("professionalVerification");
  });
});

describe("commit 8c: הנחות שורת מכירה (ProjectSalesRowAssumption) - ולידציה מבנית", () => {
  it("sourceUnitIndex מחוץ לטווח -> נזרק", () => {
    const inputs = typicalProjectInputs();
    const assumptions: ProjectCashFlowAssumptions = { ...readyAssumptions(), salesRows: [{ sourceUnitIndex: 5, unitRowId: "x", batches: [], isBuyerSaleLawEligible: false }] };
    expect(() => prepareCashFlowInput(inputs, assumptions)).toThrow(/sourceUnitIndex/);
  });

  it("שתי הנחות לאותו sourceUnitIndex -> נזרק", () => {
    const inputs = typicalProjectInputs({ units: [unit(), unit({ name: "ב" })] });
    const assumptions: ProjectCashFlowAssumptions = {
      ...readyAssumptions(),
      salesRows: [
        { sourceUnitIndex: 0, unitRowId: "a", batches: [{ unitsCount: 10, saleMonth: 2 }], isBuyerSaleLawEligible: true },
        { sourceUnitIndex: 0, unitRowId: "b", batches: [{ unitsCount: 10, saleMonth: 2 }], isBuyerSaleLawEligible: true },
      ],
    };
    expect(() => prepareCashFlowInput(inputs, assumptions)).toThrow(/שתי הנחות מפנות לאותה שורת מקור/);
  });

  it("unitRowId ריק -> נזרק", () => {
    const inputs = typicalProjectInputs();
    const assumptions: ProjectCashFlowAssumptions = { ...readyAssumptions(), salesRows: [{ sourceUnitIndex: 0, unitRowId: "  ", batches: [], isBuyerSaleLawEligible: false }] };
    expect(() => prepareCashFlowInput(inputs, assumptions)).toThrow(/unitRowId ריק/);
  });

  it("unitRowId כפול -> נזרק", () => {
    const inputs = typicalProjectInputs({ units: [unit(), unit({ name: "ב" })] });
    const assumptions: ProjectCashFlowAssumptions = {
      ...readyAssumptions(),
      salesRows: [
        { sourceUnitIndex: 0, unitRowId: "same", batches: [{ unitsCount: 10, saleMonth: 2 }], isBuyerSaleLawEligible: true },
        { sourceUnitIndex: 1, unitRowId: "same", batches: [{ unitsCount: 10, saleMonth: 2 }], isBuyerSaleLawEligible: true },
      ],
    };
    expect(() => prepareCashFlowInput(inputs, assumptions)).toThrow(/unitRowId כפול/);
  });

  it("batches על יחידת תמורה (אינה נמכרת) -> נזרק", () => {
    const inputs = typicalProjectInputs({ units: [unit({ isCompensationUnit: true, priceNis: 0 })] });
    const assumptions: ProjectCashFlowAssumptions = {
      ...readyAssumptions(),
      salesRows: [{ sourceUnitIndex: 0, unitRowId: "comp", batches: [{ unitsCount: 10, saleMonth: 2 }], isBuyerSaleLawEligible: false }],
    };
    expect(() => prepareCashFlowInput(inputs, assumptions)).toThrow(/אינה נמכרת/);
  });

  it("יחידה נמכרת בלי הנחת שורה תואמת -> SALES_ROW_ASSUMPTION_MISSING (לא נזרק)", () => {
    const inputs = typicalProjectInputs();
    const result = prepareCashFlowInput(inputs, { ...readyAssumptions(), salesRows: [] });
    if (result.status !== "needsAssumptions") throw new Error("expected needsAssumptions");
    expect(result.missingAssumptions.some((m) => m.code === "SALES_ROW_ASSUMPTION_MISSING" && m.path.includes("units[0]"))).toBe(true);
  });

  it("יחידת תמורה בלי הנחת שורה תואמת -> אין SALES_ROW_ASSUMPTION_MISSING, מקבלת legacy id", () => {
    const inputs = typicalProjectInputs({ units: [unit({ isCompensationUnit: true, priceNis: 0 })] });
    const compensationAssumptions: ProjectCashFlowAssumptions = {
      ...readyAssumptions(),
      salesRows: [],
      costTimingOverrides: READY_COST_TIMING_OVERRIDES,
    };
    const result = prepareCashFlowInput(inputs, compensationAssumptions);
    // ready או needsAssumptions שניהם קבילים כאן - הבדיקה היחידה היא שאין שום דגל שמצביע ל-units[0]
    // (יחידת תמורה אינה נמכרת - אינה יכולה לגרום ל-SALES_ROW_ASSUMPTION_MISSING או דומיו)
    if (result.status === "needsAssumptions") {
      expect(result.missingAssumptions.some((m) => m.path.includes("units[0]"))).toBe(false);
    } else {
      expect(result.missingAssumptions).toEqual([]);
    }
  });
});

describe("קבוצת רכישה מקבלת רק את אפסי המימון המתועדים", () => {
  it("dealType=purchaseGroup -> אין CREDIT_FACILITY_LIMIT_MISSING (preset 0), אך שאר החוסרים עדיין קיימים", () => {
    const inputs = typicalProjectInputs({ dealType: "purchaseGroup" });
    const result = prepareCashFlowInput(inputs);
    if (result.status !== "needsAssumptions") throw new Error("expected needsAssumptions");
    const codes = result.missingAssumptions.map((m) => m.code);
    expect(codes).not.toContain("CREDIT_FACILITY_LIMIT_MISSING");
    expect(codes).toContain("COST_TIMING_MISSING");
    expect(codes).toContain("SALES_SCHEDULE_MODEL_MISSING");
  });
});

describe("commit 8c: מסגרת אשראי - אין גזירה שקטה משיא חוב", () => {
  it("עסקה רגילה בלי assumptions.financing.creditFacilityLimitNis -> CREDIT_FACILITY_LIMIT_MISSING, ההודעה לא מציעה נוסחת גזירה", () => {
    const inputs = typicalProjectInputs();
    const result = prepareCashFlowInput(inputs);
    if (result.status !== "needsAssumptions") throw new Error("expected needsAssumptions");
    const entry = result.missingAssumptions.find((m) => m.code === "CREDIT_FACILITY_LIMIT_MISSING");
    expect(entry).toBeDefined();
    // ההודעה יכולה להסביר *למה* לא גוזרים משיא חוב (ר' הוראת ביצוע 8c #7) - אך אסור לה להציע זאת כפתרון בפועל
    expect(entry!.message).not.toMatch(/יש לגזור|ניתן לגזור|לחשב לפי השיא/);
    expect(entry!.message).toContain("אסור לגזור");
  });
});

describe("computeProject מחזיר אותה תוצאה לפני ואחרי הוספת ה-adapter (כולל חילוץ VAT_FACTOR של 8c)", () => {
  it("קריאה ל-prepareCashFlowInput לא משפיעה על תוצאת computeProject", () => {
    const inputs = typicalProjectInputs();
    const before = computeProject(inputs);
    prepareCashFlowInput(inputs);
    const after = computeProject(inputs);
    expect(after).toEqual(before);
  });

  it("computeProject על תרחיש ready מלא זהה בדיוק לפני ואחרי קריאה ל-adapter", () => {
    const inputs = readyProjectInputs();
    const before = computeProject(inputs);
    prepareCashFlowInput(inputs, readyAssumptions());
    const after = computeProject(inputs);
    expect(after).toEqual(before);
  });
});

// --- תרחיש "מוכן" (ready) אמיתי, רב-שורתי: שתי יחידות נמכרות בפועל, batches שונים, ---
// --- רק אחת זכאית לערבות חוק מכר, עלויות חיוביות עם timing מלא, עקומת בנייה, מסגרת/ריבית/הון, ---
// --- עמלת פתיחה ועמלת אי-ניצול, ערבות מלאה. ---

function readyUnits(): UnitType[] {
  return [
    unit({ name: "דירת 4 חדרים", count: 6, priceNis: 2_200_000, category: "residential" }),
    unit({ name: "חנות מסחרית", count: 2, priceNis: 1_500_000, category: "commercial" }),
  ];
}

function readyProjectInputs(): ProjectInputs {
  return {
    dealType: "basic",
    projectName: "מוכן לתזרים - רב שורתי",
    units: readyUnits(),
    costs: baseCosts(),
    land: baseLand({ landPurchaseNis: 3_000_000 }),
  };
}

const READY_COST_TIMING_OVERRIDES = {
  landPurchase: { rule: "constructionStart" as const },
  brokerage: { rule: "constructionStart" as const },
  purchaseTax: { rule: "constructionStart" as const },
  electricConnection: { rule: "constructionStart" as const },
  planningFlat: { rule: "constructionStart" as const },
  planningConsultants: { rule: "constructionStart" as const },
  engineeringInspection: { rule: "constructionStart" as const },
  marketing: { rule: "constructionStart" as const },
  legal: { rule: "constructionStart" as const },
  financialSupervision: { rule: "constructionStart" as const },
  overhead: { rule: "constructionStart" as const },
  managementFee: { rule: "constructionStart" as const },
  contingency: { rule: "constructionStart" as const },
  constructionResidential: { rule: "spreadOverConstruction" as const },
  constructionCommercial: { rule: "spreadOverConstruction" as const },
  constructionUnderground: { rule: "constructionStart" as const },
  constructionDevelopment: { rule: "constructionStart" as const },
};

function readySalesRows(): ProjectSalesRowAssumption[] {
  return [
    {
      sourceUnitIndex: 0,
      unitRowId: "unit-residential-4rooms",
      batches: [
        { unitsCount: 4, saleMonth: 2 },
        { unitsCount: 2, saleMonth: 10 },
      ],
      isBuyerSaleLawEligible: true,
    },
    {
      sourceUnitIndex: 1,
      unitRowId: "unit-commercial-shop",
      batches: [{ unitsCount: 2, saleMonth: 5 }],
      isBuyerSaleLawEligible: false,
    },
  ];
}

function readyGuarantees(): CashFlowGuaranteeInput[] {
  return [{ kind: "buyerSaleLaw", mechanism: { kind: "buyerSaleLaw", annualRateFraction: 0.0085 }, releaseMonthIndex: 27, label: "ערבות חוק מכר" }];
}

function readyAssumptions(): ProjectCashFlowAssumptions {
  const inputs = readyProjectInputs();
  const areas = computeAreas(inputs);
  const revenue = computeRevenue(inputs, areas);
  const openingFeeAmountNis = computeVatInclusiveRevenueBasedAmount(revenue.developerRevenueExclVatNis, inputs.costs.accountOpeningCommissionRate);

  return {
    schemaVersion: 1,
    salesRows: readySalesRows(),
    costTimingOverrides: READY_COST_TIMING_OVERRIDES,
    salesSchedule: {
      model: "explicitSchedule",
      byCategory: {
        residential: [
          { fraction: 0.3, timing: { kind: "relativeToSale", monthsAfterSale: 0 }, label: "בחתימה" },
          { fraction: 0.7, timing: { kind: "handover" }, label: "במסירה" },
        ],
        commercial: [
          { fraction: 0.5, timing: { kind: "relativeToSale", monthsAfterSale: 0 }, label: "בחתימה" },
          { fraction: 0.5, timing: { kind: "handover" }, label: "במסירה" },
        ],
      },
      saleMonthByCategory: { residential: 2, commercial: 5 },
    },
    constructionCurve: { model: "linear" },
    guarantees: readyGuarantees(),
    financing: {
      equityCapNis: 2_000_000,
      creditFacilityLimitNis: 15_000_000,
      annualInterestRate: 0.04,
      minimumCashBalanceNis: 0,
      openingFee: { kind: "fixedAmount", amountNis: openingFeeAmountNis, chargeMonthIndex: 8 },
      unusedFacilityCommission: {
        annualRateFraction: 0.0035,
        balanceBasis: "closingAvailableFacility",
        startMonthIndex: 8,
        endMonthIndexExclusive: 28,
      },
    },
  };
}

describe("תרחיש ready מלא, רב-שורתי", () => {
  it("סופקו כל ההנחות הדרושות -> status=ready, cashFlowInput תקין", () => {
    const result = prepareCashFlowInput(readyProjectInputs(), readyAssumptions());
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.missingAssumptions).toEqual([]);
    expect(result.cashFlowInput.guarantees).toEqual(readyGuarantees());
    expect(result.cashFlowInput.interestAssumptions.creditFacilityLimitNis).toBe(15_000_000);
    expect(result.mappedFields.length).toBeGreaterThan(0);
    expect(result.cashFlowInput.salesUnitRows).toHaveLength(2);
  });

  it("זכאות ערבות חוק מכר זורמת נכון: רק unit-residential-4rooms מסומנת isBuyerSaleLawEligible", () => {
    const result = prepareCashFlowInput(readyProjectInputs(), readyAssumptions());
    if (result.status !== "ready") throw new Error("expected ready");
    const residentialRow = result.cashFlowInput.salesUnitRows.find((r) => r.unitRowId === "unit-residential-4rooms")!;
    const commercialRow = result.cashFlowInput.salesUnitRows.find((r) => r.unitRowId === "unit-commercial-shop")!;
    expect(residentialRow.isBuyerSaleLawEligible).toBe(true);
    expect(commercialRow.isBuyerSaleLawEligible).toBe(false);
  });

  it("cashFlowInput המתקבל עובר בפועל דרך computeCashFlow ומחזיר status='complete' (לא רק מבנה קלט תקין)", () => {
    const result = prepareCashFlowInput(readyProjectInputs(), readyAssumptions());
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    const cashFlowResult = computeCashFlow(result.cashFlowInput);
    expect(cashFlowResult.status).toBe("complete");
    if (cashFlowResult.status !== "complete") return;
    expect(cashFlowResult.isComplete).toBe(true);
    expect(cashFlowResult.missingAssumptions).toEqual([]);
    // ערבות חוק המכר בפועל צרכה תקבולים זכאים -> עמלת ערבות חיובית
    expect(cashFlowResult.summary.totalGuaranteeExpenseNis).toBeGreaterThan(0);
    expect(cashFlowResult.summary.totalOpeningFeeExpenseNis).toBeCloseTo(
      readyAssumptions().financing.openingFee!.kind === "fixedAmount" ? (readyAssumptions().financing.openingFee as { amountNis: number }).amountNis : 0,
      2
    );
  });

  it("computeCashFlow על אותו קלט לא ממוטט אותו (אין מוטציה)", () => {
    const result = prepareCashFlowInput(readyProjectInputs(), readyAssumptions());
    if (result.status !== "ready") throw new Error("expected ready");
    const snapshot = JSON.parse(JSON.stringify(result.cashFlowInput));
    computeCashFlow(result.cashFlowInput);
    expect(result.cashFlowInput).toEqual(snapshot);
  });
});

describe("אין NaN/Infinity", () => {
  it("בתרחיש needsAssumptions - אין NaN/Infinity בשום הודעה", () => {
    const result = prepareCashFlowInput(typicalProjectInputs());
    if (result.status !== "needsAssumptions") throw new Error("expected needsAssumptions");
    for (const m of result.missingAssumptions) {
      expect(m.message).not.toContain("NaN");
      expect(m.message).not.toContain("Infinity");
    }
  });

  it("בתרחיש ready - כל השדות המספריים בעלות ובתזרים המלא סופיים", () => {
    const result = prepareCashFlowInput(readyProjectInputs(), readyAssumptions());
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    for (const m of result.cashFlowInput.costSchedule.months) {
      for (const v of Object.values(m.costsByItemId)) expect(Number.isFinite(v)).toBe(true);
      expect(Number.isFinite(m.totalCostOutflowsNis)).toBe(true);
    }
    const cashFlowResult = computeCashFlow(result.cashFlowInput);
    if (cashFlowResult.status !== "complete") throw new Error("expected complete");
    for (const m of cashFlowResult.financing.months) {
      expect(Number.isFinite(m.closingCashBalanceNis)).toBe(true);
      expect(Number.isFinite(m.closingDebtBalanceNis)).toBe(true);
    }
  });
});
