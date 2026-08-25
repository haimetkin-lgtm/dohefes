// commit 8b: שכבת הכנת קלט ותאימות מ-ProjectInputs (המנוע הסטטי הקיים) למנוע התזרים המלא
// (cashflow-engine.ts, commit 8a). לא משנה ProjectInputs/ProjectResult/computeProject, לא מריצה
// computeCashFlow אוטומטית, לא מחוברת למסכים/Supabase. opt-in בלבד. ר' GEN2_CASHFLOW_DESIGN.md §13
// למטריצת המיפוי המלאה שנבדקה בפועל.

import { computeAreas, computeCosts, computeRevenue, isCashLandDeal } from "./engine";
import type { ProjectInputs, UnitType } from "./types";
import { computeCostSchedule } from "./cashflow-cost-schedule";
import type { CostScheduleAnchors } from "./cashflow-cost-schedule";
import { resolveConstructionCurve } from "./cashflow-construction-curve";
import type { SalesUnitRowInput } from "./cashflow-operating-schedule";
import type { CashFlowGuaranteeInput, CashFlowInput } from "./cashflow-engine";
import type { CashFlowAssumptions, CashFlowCostItemId, ProjectPhase } from "./cashflow-types";
import type { InterestCashFlowAssumptions } from "./cashflow-interest-engine";
import type { FinancingFeeAssumptions } from "./cashflow-complete-financing";

export interface MissingCashFlowAssumption {
  code: string;
  path: string;
  message: string;
  severity: "required" | "professionalVerification";
}

export type CashFlowPreparationResult =
  | {
      status: "ready";
      cashFlowInput: CashFlowInput;
      missingAssumptions: [];
      warnings: string[];
      mappedFields: string[];
    }
  | {
      status: "needsAssumptions";
      cashFlowInput: null;
      missingAssumptions: MissingCashFlowAssumption[];
      warnings: string[];
      mappedFields: string[];
    };

/** ר' cashflow-interest-engine.ts MAX_PLAUSIBLE_ANNUAL_INTEREST_RATE - אותה תקרה, אותו עיקרון:
 *  ערך גבוה מ-1 (100% שנתי) נראה כמו אחוז שהוזן בטעות (6 במקום 0.06), לא מומר אוטומטית - נדחה. */
const MAX_PLAUSIBLE_INTEREST_RATE_FRACTION = 1;

function missingItem(
  code: string,
  path: string,
  message: string,
  severity: MissingCashFlowAssumption["severity"] = "required"
): MissingCashFlowAssumption {
  return { code, path, message, severity };
}

// --- ציר הפרויקט: permitMonths/constructionMonths קיימים כשדות מפורשים ---

function deriveProjectAxis(
  costs: ProjectInputs["costs"]
): { monthIndices: number[]; constructionStartMonthIndex: number; handoverMonthIndex: number } | null {
  const { permitMonths, constructionMonths } = costs;
  if (!Number.isFinite(permitMonths) || !Number.isInteger(permitMonths) || permitMonths < 0) return null;
  if (!Number.isFinite(constructionMonths) || !Number.isInteger(constructionMonths) || constructionMonths < 1) return null;
  const constructionStartMonthIndex = permitMonths;
  const handoverMonthIndex = constructionStartMonthIndex + constructionMonths - 1;
  return { monthIndices: Array.from({ length: handoverMonthIndex + 1 }, (_, i) => i), constructionStartMonthIndex, handoverMonthIndex };
}

// --- סכומי עלויות: audit מלא מול CostBreakdown/RevenueSummary/AreaSummary (חוזר בשימוש, לא משוכפל) ---

const CONSTRUCTION_CATEGORY_TO_ITEM_ID: Record<string, CashFlowCostItemId> = {
  residential: "constructionResidential",
  residentialPremium: "constructionResidentialPremium",
  commercial: "constructionCommercial",
  office: "constructionOffice",
  publicBuilding: "constructionPublicBuilding",
  existingStructure: "constructionExistingStructure",
};

/**
 * ממפה סכומי עלות מ-ProjectInputs, בשלוש רמות ביטחון (ר' מטריצת המיפוי ב-GEN2_CASHFLOW_DESIGN.md §13):
 * - ישיר: שדה קלט גולמי או ערך חשוף ב-CostBreakdown (organizerFeeNis/relocationRentNis/municipalFeesNis/
 *   constructionBreakdown) - לא מחושב כאן, רק נקרא.
 * - המרה בטוחה: נוסחה פשוטה (rate × בסיס חשוף/גולמי, בלי הסתעפות דילים) - לא משכפלת לוגיקה פנימית
 *   של computeCosts (למשל landNis/directConstructionNis עצמם, שנקראים כאן חשופים, לא נגזרים מחדש).
 * - אסור למפות: "legal" תלוי ב-VAT_FACTOR (1.17) שהוא קבוע פנימי לא-מיוצא מ-engine.ts - לשכפל אותו
 *   כאן זה בדיוק "העתקת נוסחה" שנאסרה. מדווח professionalVerification, לא מחושב.
 */
function mapCostAmounts(inputs: ProjectInputs): {
  amounts: Partial<Record<CashFlowCostItemId, number>>;
  missing: MissingCashFlowAssumption[];
} {
  const { costs, land, dealType } = inputs;
  const areas = computeAreas(inputs);
  const revenue = computeRevenue(inputs, areas);
  const costBreakdown = computeCosts(inputs, areas, revenue);

  const amounts: Partial<Record<CashFlowCostItemId, number>> = {};

  // ישיר - שדה גולמי
  amounts.landPurchase = isCashLandDeal(dealType) ? land.landPurchaseNis : 0;
  amounts.bettermentLevy = land.bettermentLevyNis;
  amounts.planningFlat = costs.planningFlatNis;
  amounts.engineeringInspection = costs.engineeringInspectionFlatNis;
  amounts.financialSupervision = costs.financialSupervisionFlatNis;
  amounts.demolition = costs.demolitionFlatNis;

  // ישיר - חשוף כבר ב-CostBreakdown (חוזר בשימוש, לא נגזר כאן)
  amounts.organizerFee = costBreakdown.organizerFeeNis;
  amounts.relocationRent = costBreakdown.relocationRentNis;
  amounts.municipalFees = costBreakdown.municipalFeesNis;

  for (const itemId of Object.values(CONSTRUCTION_CATEGORY_TO_ITEM_ID)) {
    amounts[itemId] = 0; // ברירת מחדל מפורשת - קטגוריה בלי שטח בפועל היא 0 אמיתי, לא "חסר"
  }
  for (const row of costBreakdown.constructionBreakdown) {
    const itemId = CONSTRUCTION_CATEGORY_TO_ITEM_ID[row.category];
    if (itemId) amounts[itemId] = row.mainCostNis + row.otherCostNis;
  }

  // המרה בטוחה - rate × בסיס חשוף/גולמי בלבד
  amounts.electricConnection = areas.unitCount * costs.electricConnectionPerUnitNis;
  amounts.legalRefund = areas.unitCount * costs.legalRefundPerUnitNis;
  amounts.constructionUnderground = costs.undergroundAreaSqm * costs.undergroundConstructionCostPerSqm;
  amounts.constructionDevelopment = (costs.netPlotAreaSqm / 2) * costs.developmentCostPerSqm;
  amounts.brokerage = costBreakdown.landNis > 0 ? costBreakdown.landNis * costs.brokerageRate : 0;
  const purchaseTaxBasis = isCashLandDeal(dealType) ? land.landPurchaseNis : land.combinationLandValueForTaxNis;
  amounts.purchaseTax = purchaseTaxBasis * costs.purchaseTaxRate;
  amounts.planningConsultants = costBreakdown.directConstructionNis * costs.planningConsultantsRate;
  amounts.overhead = costBreakdown.directConstructionNis * costs.overheadRate;
  amounts.managementFee = costBreakdown.directConstructionNis * costs.managementFeeRate;
  amounts.contingency = costBreakdown.directConstructionNis * costs.contingencyRate;
  amounts.marketing = revenue.developerRevenueExclVatNis * costs.marketingRate; // אין VAT_FACTOR בנוסחה הזו במקור

  const missing: MissingCashFlowAssumption[] = [];
  if (costs.legalRate > 0) {
    missing.push(
      missingItem(
        "LEGAL_REQUIRES_VAT_FACTOR",
        "costs.legalRate",
        'סעיף "משפטי" (legal) תלוי ב-VAT_FACTOR (1.17) - קבוע פנימי לא-מיוצא מ-engine.ts. חישוב אוטומטי כאן היה משכפל נוסחה פנימית - לא בוצע. יש להזין את הסכום ידנית.',
        "professionalVerification"
      )
    );
  } else {
    amounts.legal = 0;
  }

  return { amounts, missing };
}

// --- שיעור ריבית: רק לאחר אימות שמדובר בשבר עשרוני ---

function mapInterestRate(costs: ProjectInputs["costs"]): { rate: number | null; missing: MissingCashFlowAssumption[] } {
  const { annualInterestRate } = costs;
  if (!Number.isFinite(annualInterestRate) || annualInterestRate < 0) {
    return {
      rate: null,
      missing: [missingItem("INTEREST_RATE_INVALID", "costs.annualInterestRate", `annualInterestRate (${annualInterestRate}) אינו מספר סופי לא-שלילי`)],
    };
  }
  if (annualInterestRate > MAX_PLAUSIBLE_INTEREST_RATE_FRACTION) {
    return {
      rate: null,
      missing: [
        missingItem(
          "INTEREST_RATE_LOOKS_LIKE_PERCENT",
          "costs.annualInterestRate",
          `annualInterestRate (${annualInterestRate}) גבוה מ-1 (100%) - נראה כמו אחוז (למשל 6 = 6%) ולא שבר עשרוני (0.06). לא מומר אוטומטית - נדחה, יש לאמת ולהזין ידנית.`,
          "professionalVerification"
        ),
      ],
    };
  }
  return { rate: annualInterestRate, missing: [] };
}

// --- מזהי שורות יחידות: אין שדה יציב ב-UnitType היום ---

/**
 * UnitType הקיים אין לו מזהה יציב כלל. מזהה legacy דטרמיניסטי מבוסס קטגוריה+מיקום במערך - **לא
 * יציב** אם סדר/מספר היחידות בדוח הישן משתנה (לא UUID אקראי - חייב להיות דטרמיניסטי כדי
 * שהתאמת דוח קיים תיתן את אותה תוצאה בכל הרצה). ר' warning שמתווסף בהמשך.
 */
function legacyUnitRowId(unit: UnitType, index: number): string {
  return `legacy-${unit.category ?? "residential"}-${index}`;
}

function mapUnitRow(unit: UnitType, index: number): { row: SalesUnitRowInput; missing: MissingCashFlowAssumption[] } {
  const unitRowId = legacyUnitRowId(unit, index);
  const doesNotSell = unit.isCompensationUnit === true || unit.isExistingStructure === true || (unit.category ?? "residential") === "publicBuilding";

  const missing: MissingCashFlowAssumption[] = [];
  if (!doesNotSell) {
    missing.push(
      missingItem(
        "SALES_BATCHES_MISSING",
        `units[${index}] (${unitRowId})`,
        `יחידה "${unit.name}" נמכרת (${unit.count} יח') אך אין batches/חודש מכירה בדוח הישן`
      )
    );
    missing.push(
      missingItem(
        "BUYER_ELIGIBILITY_MISSING",
        `units[${index}] (${unitRowId})`,
        `יחידה "${unit.name}": זכאות לערבות חוק המכר (isBuyerSaleLawEligible) אינה קיימת בדוח הישן ואינה מוסקת אוטומטית מהקטגוריה`
      )
    );
  }

  return {
    row: {
      unitRowId,
      unit: { count: unit.count, priceNis: unit.priceNis, category: unit.category, isCompensationUnit: unit.isCompensationUnit, isExistingStructure: unit.isExistingStructure },
      batches: [], // תמיד ריק כאן - batches אמיתיים מגיעים רק מ-assumptions, אין להמציא
      isBuyerSaleLawEligible: false, // ברירת מחדל שמרנית: לא ממציאים "כן" - תמיד מדווח כ-missing אם רלוונטי
    },
    missing,
  };
}

// --- ערבויות: guaranteeCommissionRate ישן הוא שיעור מאוחד, לא ניתן לפיצול בטוח לשלושת המנגנונים ---

function mapGuarantees(dealType: ProjectInputs["dealType"], costs: ProjectInputs["costs"]): { guarantees: CashFlowGuaranteeInput[] | null; missing: MissingCashFlowAssumption[] } {
  if (dealType === "purchaseGroup") {
    // preset מתועד לפי enum dealType (לא שם חופשי) - ר' GEN2_CASHFLOW_DESIGN.md §5:
    // קבוצת רכישה בתרחיש הבסיס אינה כפופה לערבויות חוק המכר הרגילות
    return { guarantees: [], missing: [] };
  }
  if (costs.guaranteeCommissionRate === 0) {
    return { guarantees: [], missing: [] }; // סכום אפס מפורש = אין ערבות בכלל, לא "חסר"
  }
  return {
    guarantees: null,
    missing: [
      missingItem(
        "GUARANTEE_MECHANISM_AMBIGUOUS",
        "costs.guaranteeCommissionRate",
        "עמלת ערבות ישנה (guaranteeCommissionRate) היא שיעור מאוחד יחיד לכל סוגי הערבות, לא ניתן לפיצול בטוח בין buyerSaleLaw/kombinatsiaOwner/unitCompensationOwner (בסיס/שיעור/משך שונים לכל אחד - ר' TODO מתועד ב-engine.ts computeCosts). יש להגדיר את מנגנוני הערבות מחדש.",
        "professionalVerification"
      ),
    ],
  };
}

// --- מסגרת אשראי / הון עצמי / עמלות מימון ---

function mapFinancingFeeAssumptions(costs: ProjectInputs["costs"]): { financingFeeAssumptions: FinancingFeeAssumptions; missing: MissingCashFlowAssumption[] } {
  const missing: MissingCashFlowAssumption[] = [];
  const financingFeeAssumptions: FinancingFeeAssumptions = {};

  if (costs.accountOpeningCommissionRate > 0) {
    missing.push(
      missingItem(
        "OPENING_FEE_AMOUNT_REQUIRES_VAT_FACTOR",
        "costs.accountOpeningCommissionRate",
        "עמלת פתיחת תיק ישנה (accountOpeningCommissionRate) מחושבת מהכנסה × VAT_FACTOR - קבוע פנימי לא-מיוצא מ-engine.ts, לא משוכפל כאן.",
        "professionalVerification"
      )
    );
    missing.push(
      missingItem(
        "OPENING_FEE_CHARGE_MONTH_MISSING",
        "costs.accountOpeningCommissionRate",
        "אין בדוח הישן חודש חיוב לעמלת פתיחת התיק (FacilityOpeningFee.chargeMonthIndex) - ממופה אך ורק ל-FacilityOpeningFee, לא ללוח העלויות (ר' 7-prep)."
      )
    );
  }
  // accountOpeningCommissionRate===0 -> openingFee נשאר undefined, בלי דגל (0 מפורש = אין עמלה בכלל)

  if (costs.unusedCreditCommissionRate > 0) {
    missing.push(
      missingItem(
        "UNUSED_FACILITY_BASIS_MISSING",
        "costs.unusedCreditCommissionRate",
        'עמלת אי-ניצול ישנה קיימת (שיעור), אך בסיס אי-הניצול (UnusedFacilityBalanceBasis: opening/closing/average) וחלון הזמן שלה אינם קיימים בדוח הישן - קונספט חדש ב-Gen2 שלא היה קיים במנוע הסטטי.'
      )
    );
  }
  // unusedCreditCommissionRate===0 -> unusedFacilityCommission נשאר undefined, בלי דגל

  return { financingFeeAssumptions, missing };
}

function mapInterestAssumptions(
  dealType: ProjectInputs["dealType"],
  costs: ProjectInputs["costs"],
  annualInterestRate: number,
  overrides: Partial<CashFlowAssumptions> | undefined
): { interestAssumptions: InterestCashFlowAssumptions | null; missing: MissingCashFlowAssumption[] } {
  const missing: MissingCashFlowAssumption[] = [];

  let creditFacilityLimitNis: number | null = null;
  if (dealType === "purchaseGroup") {
    creditFacilityLimitNis = 0; // preset מתועד, ר' mapGuarantees
  } else if (overrides?.creditFacilityLimitNis !== undefined && overrides.creditFacilityLimitNis !== "auto") {
    creditFacilityLimitNis = overrides.creditFacilityLimitNis;
  } else {
    missing.push(
      missingItem(
        "CREDIT_FACILITY_LIMIT_MISSING",
        "(אין שדה מתאים ב-ProjectInputs)",
        "אין בדוח הישן מסגרת אשראי מפורשת - creditFacilityNis הישן הוא ערך נגזר-פנימי בתוך computeCosts (לא חשוף ב-CostBreakdown, לא קלט ישיר). יש להזין מסגרת מפורשת."
      )
    );
  }

  if (creditFacilityLimitNis === null) return { interestAssumptions: null, missing };

  return {
    interestAssumptions: {
      equityCapNis: overrides?.equityCapNis ?? costs.equityNis,
      minimumCashBalanceNis: overrides?.minimumCashBalanceNis ?? 0, // ברירת מחדל בטוחה: "אין מינימום נדרש", לא ניחוש עסקי
      creditFacilityLimitNis,
      annualInterestRate,
    },
    missing,
  };
}

/**
 * מכינה קלט ל-computeCashFlow מתוך ProjectInputs. אינה מריצה computeCashFlow בעצמה, ואינה נוגעת
 * ב-ProjectInputs/ProjectResult/computeProject. `assumptions` הוא Partial<CashFlowAssumptions>
 * אופציונלי - ר' הערה חשובה למטה על מה בפועל נצרך ממנו.
 *
 * **הערה מתועדת**: CashFlowAssumptions (טיפוס commit 1, לפני הפירוק המודולרי ל-6a-8a) אינו תואם
 * במלואו למבנה CashFlowInput/CashFlowGuaranteeInput/SalesUnitRowInput בפועל. נצרכים ממנו: salesSchedule
 * (תואם ישירות ל-SalesScheduleAssumptions הנדרש), costTimingOverrides, constructionCurve (דרך
 * resolveConstructionCurve, לא משוכפל), equityCapNis, minimumCashBalanceNis, creditFacilityLimitNis.
 * **לא נצרך**: guarantees (GuaranteeMechanism[] חסר את בסיס/עיתוי המופע שה-CashFlowGuaranteeInput
 * דורש), equityInjectionMode/interestBalanceBasis/unusedCreditCommissionBalanceBasis (אין להם שדה
 * מקביל ב-InterestCashFlowAssumptions/FinancingFeeAssumptions בפועל). שורות מכירה (batches/
 * isBuyerSaleLawEligible) **לא ניתנות בכלל** להשלמה דרך הפרמטר הזה - הטיפוס פשוט אין לו שדה
 * לכך - צריך ערוץ הנחות עשיר יותר לכך, לא קיים עדיין. גם עוגני CostScheduleAnchors מעבר ל-
 * constructionStartMonthIndex (הידוע מהציר עצמו) אין להם שדה מקביל ב-CashFlowAssumptions.
 */
export function prepareCashFlowInput(projectInputs: ProjectInputs, assumptions?: Partial<CashFlowAssumptions>): CashFlowPreparationResult {
  const missing: MissingCashFlowAssumption[] = [];
  const warnings: string[] = [];
  const mappedFields: string[] = [];

  const axis = deriveProjectAxis(projectInputs.costs);
  if (!axis) {
    missing.push(missingItem("PROJECT_AXIS_INVALID", "costs.permitMonths / costs.constructionMonths", "permitMonths/constructionMonths חסרים או לא תקינים - לא ניתן לבנות ציר פרויקט"));
  } else {
    mappedFields.push("monthIndices", "constructionStartMonthIndex", "handoverMonthIndex");
  }

  const { amounts: costAmounts, missing: costMissing } = mapCostAmounts(projectInputs);
  missing.push(...costMissing);
  mappedFields.push("costAmountsByItemId");

  const timingRulesByItemId = assumptions?.costTimingOverrides ?? {};
  for (const [itemId, amount] of Object.entries(costAmounts)) {
    if ((amount as number) > 0 && !timingRulesByItemId[itemId as CashFlowCostItemId]) {
      missing.push(
        missingItem("COST_TIMING_MISSING", `costAmountsByItemId.${itemId}`, `סעיף עלות "${itemId}" (${amount} ₪) ללא כלל עיתוי (CostTimingRule) בדוח הישן`)
      );
    }
  }

  const units = projectInputs.units;
  const salesUnitRows: SalesUnitRowInput[] = [];
  for (const [index, unit] of units.entries()) {
    const { row, missing: rowMissing } = mapUnitRow(unit, index);
    salesUnitRows.push(row);
    missing.push(...rowMissing);
  }
  if (units.length > 0) {
    mappedFields.push("salesUnitRows (unit/count/priceNis/category/isCompensationUnit/isExistingStructure)");
    warnings.push(
      "מזהי שורות יחידות (unitRowId) נגזרו אוטומטית מהקטגוריה והמיקום במערך (legacy-<category>-<index>) - אינם יציבים אם סדר/מספר היחידות בדוח משתנה. הדור החדש יצטרך מזהה קבוע ושמור בעת שמירת הנחות תזרים."
    );
  }
  if (!assumptions?.salesSchedule) {
    missing.push(
      missingItem("SALES_SCHEDULE_MODEL_MISSING", "(אין שדה מתאים ב-ProjectInputs)", "בחירת לוח תקבולים (explicitSchedule 15/70/15 מול legacyConstructionLinked) אינה קיימת בדוח הישן")
    );
  } else {
    mappedFields.push("salesScheduleAssumptions");
  }

  const { rate: interestRate, missing: rateMissing } = mapInterestRate(projectInputs.costs);
  missing.push(...rateMissing);
  if (interestRate !== null) mappedFields.push("interestAssumptions.annualInterestRate");

  const { guarantees, missing: guaranteeMissing } = mapGuarantees(projectInputs.dealType, projectInputs.costs);
  missing.push(...guaranteeMissing);
  if (guarantees !== null) mappedFields.push("guarantees");

  const { financingFeeAssumptions, missing: feeMissing } = mapFinancingFeeAssumptions(projectInputs.costs);
  missing.push(...feeMissing);

  const interestAssumptionsResult =
    interestRate !== null ? mapInterestAssumptions(projectInputs.dealType, projectInputs.costs, interestRate, assumptions) : null;
  if (interestAssumptionsResult) {
    missing.push(...interestAssumptionsResult.missing);
    if (interestAssumptionsResult.interestAssumptions) mappedFields.push("interestAssumptions");
  }

  if (!assumptions?.constructionCurve) {
    missing.push(
      missingItem("CONSTRUCTION_CURVE_MISSING", "(אין שדה מתאים ב-ProjectInputs)", "שיטת עקומת בנייה (linear/sCurve/legacy/custom) אינה קיימת בדוח הישן - אין החלטה מפורשת")
    );
  } else {
    mappedFields.push("constructionCurve");
  }

  if (missing.length > 0) {
    return { status: "needsAssumptions", cashFlowInput: null, missingAssumptions: missing, warnings, mappedFields };
  }

  // מגיעים לכאן רק כשאין אף missing - כל הערכים הבאים מובטחים לא-null
  const phasesByMonthIndex: Record<number, ProjectPhase[]> = Object.fromEntries(
    axis!.monthIndices.map((m) => [m, ["construction"] as ProjectPhase[]])
  );

  // resolveConstructionCurve חוזר בשימוש (לא משוכפל) - constructionCurve כבר אומת כקיים ב-assumptions למעלה
  const constructionMonthsCount = axis!.handoverMonthIndex - axis!.constructionStartMonthIndex + 1;
  const resolvedConstructionCurve = resolveConstructionCurve(constructionMonthsCount, assumptions!.constructionCurve!);

  // עוגן constructionStartMonthIndex כבר ידוע מהציר עצמו (לא מ-assumptions) - מספיק לכלל
  // spreadOverConstruction. שאר סוגי העוגן (landPurchaseMonth/permitMonth/escortStart/preCompletion/
  // spreadOverEscort/spreadOverRelocation) אין להם מקור נתונים ב-ProjectInputs בכלל - אם
  // costTimingOverrides בפועל משתמש בהם בלי עוגן תואם, computeCostSchedule יזרוק שגיאה מפורשת
  // (לא מוסתר, לא מומצא) - זו התנהגות רצויה, לא תקלה.
  const anchors: CostScheduleAnchors = { constructionStartMonthIndex: axis!.constructionStartMonthIndex };
  const costSchedule = computeCostSchedule({
    monthIndices: axis!.monthIndices,
    costAmountsByItemId: costAmounts,
    timingRulesByItemId,
    constructionCurve: resolvedConstructionCurve,
    anchors,
  });

  const cashFlowInput: CashFlowInput = {
    monthIndices: axis!.monthIndices,
    phasesByMonthIndex,
    salesUnitRows,
    salesScheduleAssumptions: assumptions!.salesSchedule!,
    marketingStartMonthIndex: 0, // ברירת מחדל בטוחה: גבול תחתון מתירני, לא מגביל תזמון מכירה אמיתי
    constructionStartMonthIndex: axis!.constructionStartMonthIndex,
    handoverMonthIndex: axis!.handoverMonthIndex,
    constructionCurve: resolvedConstructionCurve,
    costSchedule,
    guarantees: guarantees ?? [],
    interestAssumptions: interestAssumptionsResult!.interestAssumptions!,
    financingFeeAssumptions,
  };

  return { status: "ready", cashFlowInput, missingAssumptions: [], warnings, mappedFields };
}
