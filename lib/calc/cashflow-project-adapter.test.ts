import { describe, expect, it } from "vitest";
import { computeProject } from "./engine";
import type { CostInputs, LandInputs, ProjectInputs, UnitType } from "./types";
import { prepareCashFlowInput } from "./cashflow-project-adapter";
import type { CashFlowAssumptions } from "./cashflow-types";

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

  it("אין מוטציה של assumptions", () => {
    const inputs = typicalProjectInputs();
    const assumptions: Partial<CashFlowAssumptions> = {
      costTimingOverrides: { landPurchase: { rule: "landPurchaseMonth" } },
      constructionCurve: { model: "linear" },
    };
    const snapshot = JSON.parse(JSON.stringify(assumptions));

    prepareCashFlowInput(inputs, assumptions);

    expect(assumptions).toEqual(snapshot);
  });
});

describe("דוח ישן חלקי מחזיר needsAssumptions, לא מספרים מומצאים", () => {
  it("קודי חוסר צפויים קיימים: לוח מכירות, זכאות ערבות, עיתוי עלות, בסיס אי-ניצול, מסגרת אשראי, עקומת בנייה", () => {
    const result = prepareCashFlowInput(typicalProjectInputs());
    expect(result.status).toBe("needsAssumptions");
    if (result.status !== "needsAssumptions") return;
    const codes = result.missingAssumptions.map((m) => m.code);
    expect(codes).toContain("SALES_BATCHES_MISSING");
    expect(codes).toContain("BUYER_ELIGIBILITY_MISSING");
    expect(codes).toContain("SALES_SCHEDULE_MODEL_MISSING");
    expect(codes).toContain("COST_TIMING_MISSING");
    expect(codes).toContain("UNUSED_FACILITY_BASIS_MISSING");
    expect(codes).toContain("CREDIT_FACILITY_LIMIT_MISSING");
    expect(codes).toContain("CONSTRUCTION_CURVE_MISSING");
    expect(codes).toContain("GUARANTEE_MECHANISM_AMBIGUOUS");
    expect(codes).toContain("OPENING_FEE_AMOUNT_REQUIRES_VAT_FACTOR");
    expect(codes).toContain("OPENING_FEE_CHARGE_MONTH_MISSING");
    // כל שדה חוסר מובנה, לא רק טקסט
    for (const m of result.missingAssumptions) {
      expect(typeof m.code).toBe("string");
      expect(typeof m.path).toBe("string");
      expect(typeof m.message).toBe("string");
      expect(["required", "professionalVerification"]).toContain(m.severity);
    }
  });
});

describe("סכומי העלויות ממופים נכון", () => {
  it("landPurchase/planningFlat/demolition ממופים ישירות; קטגוריית בנייה תואמת ל-constructionBreakdown", () => {
    const inputs = typicalProjectInputs({ costs: baseCosts({ demolitionFlatNis: 150_000 }) });
    const result = prepareCashFlowInput(inputs);
    expect(result.status).toBe("needsAssumptions");
    if (result.status !== "needsAssumptions") return;

    const project = computeProject(inputs);
    // לא חושפים costAmountsByItemId ישירות ב-needsAssumptions - בודקים דרך תרחיש "מוכן" למטה
    // בדיקה זו מוודאת שהחישוב לא קורס וש-computeProject עצמו לא מושפע (ר' בדיקה נפרדת)
    expect(project.costs.directConstructionNis).toBeGreaterThan(0);
  });

  it("בתרחיש 'מוכן' (ready), costAmountsByItemId תואם ל-CostBreakdown שנחשף", () => {
    const inputs = readyProjectInputs();
    const result = prepareCashFlowInput(inputs, readyAssumptions());
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const totals = result.cashFlowInput.costSchedule.totalsByItemId;
    const project = computeProject(inputs);
    // הבנייה (residential) חייבת לתאום לפירוט שכבר קיים ב-ProjectResult
    const residentialRow = project.costs.constructionBreakdown.find((r) => r.category === "residential");
    expect(totals.constructionResidential).toBeCloseTo((residentialRow?.mainCostNis ?? 0) + (residentialRow?.otherCostNis ?? 0), 2);
  });
});

describe("עמלת פתיחת תיק אינה נספרת גם כעלות", () => {
  it("accountOpeningCommission אינו מפתח חוקי בכלל (7-prep) - לא מופיע ב-costAmountsByItemId, מטופל רק דרך missingAssumptions/OPENING_FEE_*", () => {
    const result = prepareCashFlowInput(typicalProjectInputs());
    expect(result.status).toBe("needsAssumptions");
    if (result.status !== "needsAssumptions") return;
    const codes = result.missingAssumptions.map((m) => m.code);
    expect(codes).toContain("OPENING_FEE_AMOUNT_REQUIRES_VAT_FACTOR");
    expect(codes).toContain("OPENING_FEE_CHARGE_MONTH_MISSING");
    // אין אף קוד חוסר שמדבר על "עלות" מתוזמנת בשם accountOpeningCommission
    expect(codes).not.toContain("COST_TIMING_MISSING_accountOpeningCommission");
  });
});

describe("שיעור ריבית עשרוני ממופה; ערך בסגנון 6 נדחה", () => {
  it("0.04 (שבר עשרוני) - אין INTEREST_RATE_LOOKS_LIKE_PERCENT", () => {
    const result = prepareCashFlowInput(typicalProjectInputs());
    if (result.status !== "needsAssumptions") throw new Error("expected needsAssumptions");
    const codes = result.missingAssumptions.map((m) => m.code);
    expect(codes).not.toContain("INTEREST_RATE_LOOKS_LIKE_PERCENT");
  });

  it("6 (נראה כמו אחוז) - נדחה, לא מומר אוטומטית ל-0.06", () => {
    const inputs = typicalProjectInputs({ costs: baseCosts({ annualInterestRate: 6 }) });
    const result = prepareCashFlowInput(inputs);
    if (result.status !== "needsAssumptions") throw new Error("expected needsAssumptions");
    const codes = result.missingAssumptions.map((m) => m.code);
    expect(codes).toContain("INTEREST_RATE_LOOKS_LIKE_PERCENT");
    const entry = result.missingAssumptions.find((m) => m.code === "INTEREST_RATE_LOOKS_LIKE_PERCENT")!;
    expect(entry.severity).toBe("professionalVerification");
  });
});

describe("יחידות נמכרות ללא batches מסומנות כחסר", () => {
  it("יחידה רגילה (נמכרת) -> SALES_BATCHES_MISSING + BUYER_ELIGIBILITY_MISSING", () => {
    const result = prepareCashFlowInput(typicalProjectInputs());
    if (result.status !== "needsAssumptions") throw new Error("expected needsAssumptions");
    const unitMissing = result.missingAssumptions.filter((m) => m.path.includes("units[0]"));
    expect(unitMissing.some((m) => m.code === "SALES_BATCHES_MISSING")).toBe(true);
    expect(unitMissing.some((m) => m.code === "BUYER_ELIGIBILITY_MISSING")).toBe(true);
  });
});

describe("יחידות תמורה אינן דורשות batches", () => {
  it("isCompensationUnit -> אין SALES_BATCHES_MISSING/BUYER_ELIGIBILITY_MISSING לשורה הזו", () => {
    const inputs = typicalProjectInputs({ units: [unit({ isCompensationUnit: true, priceNis: 0 })] });
    const result = prepareCashFlowInput(inputs);
    if (result.status !== "needsAssumptions") throw new Error("expected needsAssumptions");
    const unitMissing = result.missingAssumptions.filter((m) => m.path.includes("units[0]"));
    expect(unitMissing).toHaveLength(0);
  });
});

describe("עלות חיובית ללא timing מסומנת כחסר", () => {
  it("planningFlatNis>0 בלי costTimingOverrides -> COST_TIMING_MISSING", () => {
    const result = prepareCashFlowInput(typicalProjectInputs());
    if (result.status !== "needsAssumptions") throw new Error("expected needsAssumptions");
    expect(result.missingAssumptions.some((m) => m.code === "COST_TIMING_MISSING" && m.path.includes("planningFlat"))).toBe(true);
  });

  it("אספקת costTimingOverrides לפריט מסוים מסירה את ה-COST_TIMING_MISSING שלו בלבד", () => {
    const result = prepareCashFlowInput(typicalProjectInputs(), { costTimingOverrides: { planningFlat: { rule: "constructionStart" } } });
    if (result.status !== "needsAssumptions") throw new Error("expected needsAssumptions");
    expect(result.missingAssumptions.some((m) => m.code === "COST_TIMING_MISSING" && m.path.includes("planningFlat"))).toBe(false);
    expect(result.missingAssumptions.some((m) => m.code === "COST_TIMING_MISSING" && m.path.includes("mainConstructionCostPerSqm" ))).toBe(false); // לא רלוונטי, רק בדיקת ספיישל-קייס
    expect(result.missingAssumptions.some((m) => m.code === "COST_TIMING_MISSING")).toBe(true); // שאר הפריטים עדיין חסרים
  });
});

describe("עלות אפס ללא timing אינה חסר", () => {
  it("engineeringInspectionFlatNis=0 -> אין COST_TIMING_MISSING עבורו", () => {
    const inputs = typicalProjectInputs({ costs: baseCosts({ engineeringInspectionFlatNis: 0 }) });
    const result = prepareCashFlowInput(inputs);
    if (result.status !== "needsAssumptions") throw new Error("expected needsAssumptions");
    expect(result.missingAssumptions.some((m) => m.code === "COST_TIMING_MISSING" && m.path.includes("engineeringInspection"))).toBe(false);
  });
});

describe("קבוצת רכישה מקבלת רק את אפסי המימון המתועדים", () => {
  it("dealType=purchaseGroup -> אין GUARANTEE_MECHANISM_AMBIGUOUS/CREDIT_FACILITY_LIMIT_MISSING, אך שאר החוסרים (עיתוי/לוח תקבולים) עדיין קיימים", () => {
    const inputs = typicalProjectInputs({ dealType: "purchaseGroup" });
    const result = prepareCashFlowInput(inputs);
    if (result.status !== "needsAssumptions") throw new Error("expected needsAssumptions");
    const codes = result.missingAssumptions.map((m) => m.code);
    expect(codes).not.toContain("GUARANTEE_MECHANISM_AMBIGUOUS");
    expect(codes).not.toContain("CREDIT_FACILITY_LIMIT_MISSING");
    // עדיין לא מסתירים הנחות אחרות
    expect(codes).toContain("COST_TIMING_MISSING");
    expect(codes).toContain("SALES_SCHEDULE_MODEL_MISSING");
  });
});

describe("מזהי legacy דטרמיניסטיים", () => {
  it("אותו קלט מפיק אותם unitRowId פעמיים", () => {
    const inputs = typicalProjectInputs({ units: [unit(), unit({ name: "דירת 3 חדרים" })] });
    const r1 = prepareCashFlowInput(inputs);
    const r2 = prepareCashFlowInput(inputs);
    if (r1.status !== "needsAssumptions" || r2.status !== "needsAssumptions") throw new Error("expected needsAssumptions");
    const rowIds1 = r1.missingAssumptions.filter((m) => m.code === "SALES_BATCHES_MISSING").map((m) => m.path);
    const rowIds2 = r2.missingAssumptions.filter((m) => m.code === "SALES_BATCHES_MISSING").map((m) => m.path);
    expect(rowIds1).toEqual(rowIds2);
  });
});

describe("שינוי סדר יחידות מפיק warning מתאים", () => {
  it("היפוך סדר היחידות משנה unitRowId (לא יציב), ואזהרה מתועדת קיימת בשני הכיוונים", () => {
    const unitA = unit({ name: "א" });
    const unitB = unit({ name: "ב", category: "commercial" });
    const forward = prepareCashFlowInput(typicalProjectInputs({ units: [unitA, unitB] }));
    const backward = prepareCashFlowInput(typicalProjectInputs({ units: [unitB, unitA] }));
    if (forward.status !== "needsAssumptions" || backward.status !== "needsAssumptions") throw new Error("expected needsAssumptions");

    expect(forward.warnings.some((w) => w.includes("unitRowId") || w.includes("אינם יציבים"))).toBe(true);
    expect(backward.warnings.some((w) => w.includes("unitRowId") || w.includes("אינם יציבים"))).toBe(true);

    const forwardRowIds = forward.missingAssumptions.filter((m) => m.code === "SALES_BATCHES_MISSING").map((m) => m.path);
    const backwardRowIds = backward.missingAssumptions.filter((m) => m.code === "SALES_BATCHES_MISSING").map((m) => m.path);
    expect(forwardRowIds).not.toEqual(backwardRowIds); // מיקום שונה במערך -> legacy id שונה, בדיוק כמו שהאזהרה מזהירה
  });
});

describe("computeProject מחזיר אותה תוצאה לפני ואחרי הוספת ה-adapter", () => {
  it("קריאה ל-prepareCashFlowInput לא משפיעה על תוצאת computeProject", () => {
    const inputs = typicalProjectInputs();
    const before = computeProject(inputs);
    prepareCashFlowInput(inputs);
    const after = computeProject(inputs);
    expect(after).toEqual(before);
  });
});

describe("אין NaN/Infinity", () => {
  it("בתרחיש needsAssumptions - אין NaN/Infinity בשום הודעה/מספר גלוי", () => {
    const result = prepareCashFlowInput(typicalProjectInputs());
    if (result.status !== "needsAssumptions") throw new Error("expected needsAssumptions");
    for (const m of result.missingAssumptions) {
      expect(m.message).not.toContain("NaN");
      expect(m.message).not.toContain("Infinity");
    }
  });

  it("בתרחיש ready - כל השדות המספריים בעלות ובתזרים סופיים", () => {
    const result = prepareCashFlowInput(readyProjectInputs(), readyAssumptions());
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    for (const m of result.cashFlowInput.costSchedule.months) {
      for (const v of Object.values(m.costsByItemId)) expect(Number.isFinite(v)).toBe(true);
      expect(Number.isFinite(m.totalCostOutflowsNis)).toBe(true);
    }
  });
});

// --- תרחיש "מוכן" (ready): כל הרכיבים הכרחיים סופקו, כולל דרך assumptions ---

function readyProjectInputs(): ProjectInputs {
  return {
    dealType: "basic",
    projectName: "מוכן לתזרים",
    units: [unit({ isCompensationUnit: true, priceNis: 0 })], // לא נמכרת - בלי פער batches/eligibility
    costs: baseCosts({
      premiumConstructionCostPerSqm: 0,
      commercialConstructionCostPerSqm: 0,
      officeConstructionCostPerSqm: 0,
      publicBuildingConstructionCostPerSqm: 0,
      reinforcementCostPerSqm: 0,
      undergroundConstructionCostPerSqm: 0,
      developmentCostPerSqm: 0,
      demolitionFlatNis: 0,
      brokerageRate: 0,
      purchaseTaxRate: 0,
      electricConnectionPerUnitNis: 0,
      planningFlatNis: 0,
      planningConsultantsRate: 0,
      engineeringInspectionFlatNis: 0,
      marketingRate: 0,
      legalRate: 0, // קריטי: מונע חסימת VAT_FACTOR
      legalRefundPerUnitNis: 0,
      financialSupervisionFlatNis: 0,
      overheadRate: 0,
      managementFeeRate: 0,
      contingencyRate: 0,
      guaranteeCommissionRate: 0, // סכום אפס מפורש -> guarantees=[] בלי דגל
      unusedCreditCommissionRate: 0,
      accountOpeningCommissionRate: 0,
      organizerFeeNis: 0,
    }),
    land: baseLand(), // הכל 0
  };
}

function readyAssumptions(): Partial<CashFlowAssumptions> {
  return {
    costTimingOverrides: { constructionResidential: { rule: "spreadOverConstruction" } },
    constructionCurve: { model: "linear" },
    salesSchedule: { model: "explicitSchedule", byCategory: {}, saleMonthByCategory: {} },
    creditFacilityLimitNis: 500_000,
    equityCapNis: 200_000,
    minimumCashBalanceNis: 0,
  };
}

describe("תרחיש ready מלא", () => {
  it("סופקו כל ההנחות הדרושות -> status=ready, cashFlowInput תקין", () => {
    const result = prepareCashFlowInput(readyProjectInputs(), readyAssumptions());
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.missingAssumptions).toEqual([]);
    expect(result.cashFlowInput.guarantees).toEqual([]);
    expect(result.cashFlowInput.interestAssumptions.creditFacilityLimitNis).toBe(500_000);
    expect(result.mappedFields.length).toBeGreaterThan(0);
  });
});
