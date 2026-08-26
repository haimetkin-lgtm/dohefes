// commit 8b/8c: שכבת הכנת קלט ותאימות מ-ProjectInputs (המנוע הסטטי הקיים) למנוע התזרים המלא
// (cashflow-engine.ts, commit 8a). לא משנה ProjectInputs/ProjectResult, לא מריצה computeCashFlow
// אוטומטית, לא מחוברת למסכים/Supabase. opt-in בלבד. ר' GEN2_CASHFLOW_DESIGN.md §13 למטריצת המיפוי.
//
// commit 8c: Partial<CashFlowAssumptions> (טיפוס commit 1, לפני הפירוק המודולרי) הוחלף ב-
// ProjectCashFlowAssumptions ייעודי - הטיפוס הישן לא יכול היה לייצג הנחות ברמת שורת מכירה בכלל,
// כך שפרויקט אמיתי עם יחידות נמכרות מעולם לא יכול היה להגיע ל-"ready". אין overload ישן - API
// יחיד, לא עמום. engine.ts תוקן תוספתית (VAT_FACTOR מיוצא + computeVatInclusiveRevenueBasedAmount
// מיוצא, חוזר בשימוש גם בתוך computeCosts) כדי ש-"legal" ועמלת פתיחת התיק לא יהיו חסומים יותר על
// טעם טכני בלבד - ר' regression מלא (npm test) שמאמת ש-computeProject לא השתנה כתוצאה מזה.

import { computeAreas, computeCosts, computeRevenue, computeVatInclusiveRevenueBasedAmount, isCashLandDeal } from "./engine";
import type { ProjectInputs, UnitType } from "./types";
import { computeCostSchedule } from "./cashflow-cost-schedule";
import type { CostScheduleAnchors } from "./cashflow-cost-schedule";
import { resolveConstructionCurve } from "./cashflow-construction-curve";
import type { SalesUnitRowInput } from "./cashflow-operating-schedule";
import type { UnitSalesBatch } from "./cashflow-sales-schedule";
import type { CashFlowGuaranteeInput, CashFlowInput } from "./cashflow-engine";
import type {
  CashFlowCostItemId,
  ConstructionCurveAssumptions,
  CostTimingRule,
  ProjectPhase,
  SalesScheduleAssumptions,
} from "./cashflow-types";
import type { FacilityOpeningFee, UnusedFacilityCommissionAssumptions } from "./cashflow-financing-fees";

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

/**
 * הנחה ברמת שורת מכירה בודדת. `sourceUnitIndex` הוא **גשר התאמה בלבד** מול `ProjectInputs.units`
 * הנוכחי - לא מזהה קבוע (סדר עתידי של `units` נשאר סיכון מתועד ל-legacy, ר' §13). `unitRowId` הוא
 * הזהות היציבה בפועל, שתישמר כשהדור הבא יתחיל לשמור הנחות תזרים.
 */
export interface ProjectSalesRowAssumption {
  sourceUnitIndex: number;
  unitRowId: string;
  batches: UnitSalesBatch[];
  isBuyerSaleLawEligible: boolean;
}

/**
 * מבנה ההנחות הייעודי שמחליף את Partial<CashFlowAssumptions> (commit 8c). כל שדה כאן תואם ישירות
 * למה ש-CashFlowInput/CashFlowGuaranteeInput בפועל דורשים - אין המרה עמומה.
 */
export interface ProjectCashFlowAssumptions {
  schemaVersion: number;

  salesRows: ProjectSalesRowAssumption[];
  costTimingOverrides: Partial<Record<CashFlowCostItemId, CostTimingRule>>;

  salesSchedule: SalesScheduleAssumptions;
  constructionCurve: ConstructionCurveAssumptions;

  guarantees: CashFlowGuaranteeInput[];
  financing: {
    equityCapNis?: number;
    creditFacilityLimitNis?: number;
    annualInterestRate?: number;
    minimumCashBalanceNis?: number;
    openingFee?: FacilityOpeningFee;
    unusedFacilityCommission?: UnusedFacilityCommissionAssumptions;
  };

  timelineOverrides?: {
    permitMonths?: number;
    constructionMonths?: number;
    handoverMonthIndex?: number;
  };
}

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

// --- ציר הפרויקט: permitMonths/constructionMonths (או timelineOverrides) ---

function deriveProjectAxis(
  costs: ProjectInputs["costs"],
  overrides: ProjectCashFlowAssumptions["timelineOverrides"]
): { monthIndices: number[]; constructionStartMonthIndex: number; handoverMonthIndex: number } | null {
  const permitMonths = overrides?.permitMonths ?? costs.permitMonths;
  const constructionMonths = overrides?.constructionMonths ?? costs.constructionMonths;
  if (!Number.isFinite(permitMonths) || !Number.isInteger(permitMonths) || permitMonths < 0) return null;
  if (!Number.isFinite(constructionMonths) || !Number.isInteger(constructionMonths) || constructionMonths < 1) return null;

  const constructionStartMonthIndex = permitMonths;
  const naturalHandover = constructionStartMonthIndex + constructionMonths - 1;
  const handoverMonthIndex = overrides?.handoverMonthIndex ?? naturalHandover;
  if (!Number.isInteger(handoverMonthIndex) || handoverMonthIndex < constructionStartMonthIndex) return null;

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
 * - ישיר: שדה קלט גולמי, או ערך חשוף ב-CostBreakdown (organizerFeeNis/relocationRentNis/
 *   municipalFeesNis/constructionBreakdown) - לא מחושב כאן, רק נקרא.
 * - המרה בטוחה: נוסחה פשוטה (rate × בסיס חשוף/גולמי, בלי הסתעפות דילים) - לא משכפלת לוגיקה פנימית
 *   של computeCosts (landNis/directConstructionNis עצמם נקראים חשופים, לא נגזרים מחדש).
 * - "legal" (commit 8c): ממופה עכשיו דרך computeVatInclusiveRevenueBasedAmount המיוצא מ-engine.ts
 *   (אותו helper בדיוק ש-computeCosts עצמו קורא לו עבור legalNis) - **לא** נוסחה משוכפלת.
 */
function mapCostAmounts(inputs: ProjectInputs): {
  amounts: Partial<Record<CashFlowCostItemId, number>>;
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

  // commit 8c: מקור אמת יחיד - אותו helper מיוצא ש-computeCosts עצמו משתמש בו ל-legalNis
  amounts.legal = computeVatInclusiveRevenueBasedAmount(revenue.developerRevenueExclVatNis, costs.legalRate);

  return { amounts };
}

/** אותו helper בדיוק, לעמלת פתיחת התיק - ר' mapOpeningFee */
function computeAccountOpeningCommissionAmount(inputs: ProjectInputs): number {
  const areas = computeAreas(inputs);
  const revenue = computeRevenue(inputs, areas);
  return computeVatInclusiveRevenueBasedAmount(revenue.developerRevenueExclVatNis, inputs.costs.accountOpeningCommissionRate);
}

// --- שיעור ריבית: רק לאחר אימות שמדובר בשבר עשרוני ---

function validateInterestRateFraction(rate: number, path: string): MissingCashFlowAssumption | null {
  if (!Number.isFinite(rate) || rate < 0) {
    return missingItem("INTEREST_RATE_INVALID", path, `annualInterestRate (${rate}) אינו מספר סופי לא-שלילי`);
  }
  if (rate > MAX_PLAUSIBLE_INTEREST_RATE_FRACTION) {
    return missingItem(
      "INTEREST_RATE_LOOKS_LIKE_PERCENT",
      path,
      `annualInterestRate (${rate}) גבוה מ-1 (100%) - נראה כמו אחוז (למשל 6 = 6%) ולא שבר עשרוני (0.06). לא מומר אוטומטית - נדחה, יש לאמת ולהזין ידנית.`,
      "professionalVerification"
    );
  }
  return null;
}

// --- מזהי שורות יחידות: אין שדה יציב ב-UnitType היום ---

/** UnitType הקיים אין לו מזהה יציב כלל. legacy דטרמיניסטי (לא UUID אקראי) - רק כשאין
 *  ProjectSalesRowAssumption תואמת (יחידות שלא נמכרות, בעיקר). ר' warning שמתווסף בהמשך. */
function legacyUnitRowId(unit: UnitType, index: number): string {
  return `legacy-${unit.category ?? "residential"}-${index}`;
}

function unitDoesNotSell(unit: UnitType): boolean {
  return unit.isCompensationUnit === true || unit.isExistingStructure === true || (unit.category ?? "residential") === "publicBuilding";
}

/** ולידציה מבנית של salesRows - קלט סותר-מבנה נזרק, לא מדווח כ-missingAssumptions (ר' סעיף 7
 *  בהוראת הביצוע: "קלט בלתי תקין מבנית צריך להיזרק"). */
function validateSalesRowAssumptions(units: UnitType[], salesRows: ProjectSalesRowAssumption[]): void {
  const seenUnitRowIds = new Set<string>();
  const seenSourceIndices = new Set<number>();

  for (const [i, row] of salesRows.entries()) {
    if (!Number.isInteger(row.sourceUnitIndex) || row.sourceUnitIndex < 0 || row.sourceUnitIndex >= units.length) {
      throw new Error(`salesRows[${i}]: sourceUnitIndex (${row.sourceUnitIndex}) לא מצביע לשורה קיימת ב-ProjectInputs.units (0..${units.length - 1})`);
    }
    if (seenSourceIndices.has(row.sourceUnitIndex)) {
      throw new Error(`salesRows: שתי הנחות מפנות לאותה שורת מקור (sourceUnitIndex=${row.sourceUnitIndex})`);
    }
    seenSourceIndices.add(row.sourceUnitIndex);

    if (!row.unitRowId || row.unitRowId.trim() === "") {
      throw new Error(`salesRows[${i}]: unitRowId ריק`);
    }
    if (seenUnitRowIds.has(row.unitRowId)) {
      throw new Error(`salesRows: unitRowId כפול ("${row.unitRowId}")`);
    }
    seenUnitRowIds.add(row.unitRowId);

    const unit = units[row.sourceUnitIndex];
    if (unitDoesNotSell(unit) && row.batches.length > 0) {
      throw new Error(`salesRows[${i}] ("${row.unitRowId}"): יחידה "${unit.name}" אינה נמכרת (תמורה/מבנה קיים/מב"צ) - אינה יכולה לקבל batches`);
    }
  }
}

/** בונה SalesUnitRowInput לכל יחידה, לפי salesRows שהותאמו (sourceUnitIndex -> יחידה). יחידה
 *  שמוכרת בלי הנחה תואמת -> missingAssumptions, לא ניחוש. יחידה שלא מוכרת בלי הנחה -> legacy id. */
function buildSalesUnitRows(
  units: UnitType[],
  salesRows: ProjectSalesRowAssumption[]
): { rows: SalesUnitRowInput[]; missing: MissingCashFlowAssumption[]; usedLegacyId: boolean } {
  validateSalesRowAssumptions(units, salesRows);
  const bySourceIndex = new Map(salesRows.map((r) => [r.sourceUnitIndex, r]));
  const missing: MissingCashFlowAssumption[] = [];
  let usedLegacyId = false;

  const rows: SalesUnitRowInput[] = units.map((unit, index) => {
    const assumption = bySourceIndex.get(index);
    const baseUnit = { count: unit.count, priceNis: unit.priceNis, category: unit.category, isCompensationUnit: unit.isCompensationUnit, isExistingStructure: unit.isExistingStructure };

    if (!assumption) {
      if (!unitDoesNotSell(unit)) {
        missing.push(
          missingItem("SALES_ROW_ASSUMPTION_MISSING", `units[${index}]`, `יחידה "${unit.name}" (${unit.count} יח') נמכרת אך אין לה ProjectSalesRowAssumption תואמת (batches + זכאות ערבות)`)
        );
      }
      usedLegacyId = true;
      return { unitRowId: legacyUnitRowId(unit, index), unit: baseUnit, batches: [], isBuyerSaleLawEligible: false };
    }

    return { unitRowId: assumption.unitRowId, unit: baseUnit, batches: assumption.batches, isBuyerSaleLawEligible: assumption.isBuyerSaleLawEligible };
  });

  return { rows, missing, usedLegacyId };
}

/**
 * מכינה קלט ל-computeCashFlow מתוך ProjectInputs + ProjectCashFlowAssumptions ייעודי (commit 8c,
 * מחליף את Partial<CashFlowAssumptions> הישן - ר' תיעוד בראש הקובץ). אינה מריצה computeCashFlow
 * בעצמה, ואינה נוגעת ב-ProjectInputs/ProjectResult/computeProject.
 */
export function prepareCashFlowInput(projectInputs: ProjectInputs, assumptions?: ProjectCashFlowAssumptions): CashFlowPreparationResult {
  const missing: MissingCashFlowAssumption[] = [];
  const warnings: string[] = [];
  const mappedFields: string[] = [];

  const axis = deriveProjectAxis(projectInputs.costs, assumptions?.timelineOverrides);
  if (!axis) {
    missing.push(missingItem("PROJECT_AXIS_INVALID", "costs.permitMonths / costs.constructionMonths", "permitMonths/constructionMonths חסרים או לא תקינים - לא ניתן לבנות ציר פרויקט"));
  } else {
    mappedFields.push("monthIndices", "constructionStartMonthIndex", "handoverMonthIndex");
  }

  const { amounts: costAmounts } = mapCostAmounts(projectInputs);
  mappedFields.push("costAmountsByItemId (כולל legal, ר' commit 8c)");

  const timingRulesByItemId = assumptions?.costTimingOverrides ?? {};
  for (const [itemId, amount] of Object.entries(costAmounts)) {
    if ((amount as number) > 0 && !timingRulesByItemId[itemId as CashFlowCostItemId]) {
      missing.push(
        missingItem("COST_TIMING_MISSING", `costAmountsByItemId.${itemId}`, `סעיף עלות "${itemId}" (${amount} ₪) ללא כלל עיתוי (CostTimingRule) בדוח הישן`)
      );
    }
  }

  const units = projectInputs.units;
  const { rows: salesUnitRows, missing: salesRowMissing, usedLegacyId } = buildSalesUnitRows(units, assumptions?.salesRows ?? []);
  missing.push(...salesRowMissing);
  if (units.length > 0) {
    mappedFields.push("salesUnitRows");
    if (usedLegacyId) {
      warnings.push(
        "חלק משורות היחידות משתמשות במזהה legacy (קטגוריה+מיקום במערך) בהיעדר ProjectSalesRowAssumption תואמת - אינו יציב אם סדר/מספר היחידות בדוח משתנה. הדור החדש יצטרך מזהה קבוע ושמור בעת שמירת הנחות תזרים."
      );
    }
  }

  if (!assumptions?.salesSchedule) {
    missing.push(
      missingItem("SALES_SCHEDULE_MODEL_MISSING", "assumptions.salesSchedule", "בחירת לוח תקבולים (explicitSchedule 15/70/15 מול legacyConstructionLinked) אינה קיימת בדוח הישן")
    );
  } else {
    mappedFields.push("salesScheduleAssumptions");
  }

  if (!assumptions?.constructionCurve) {
    missing.push(missingItem("CONSTRUCTION_CURVE_MISSING", "assumptions.constructionCurve", "שיטת עקומת בנייה (linear/sCurve/legacy/custom) אינה קיימת בדוח הישן - אין החלטה מפורשת"));
  } else {
    mappedFields.push("constructionCurve");
  }

  // --- ערבויות: commit 8c - assumptions.guarantees הוא ערוץ מפורש ועשיר, לא מוסק/מפוצל מ-rate ישן ---
  const guarantees = assumptions?.guarantees;
  if (!guarantees) {
    missing.push(
      missingItem(
        "GUARANTEES_MISSING",
        "assumptions.guarantees",
        "רשימת מנגנוני הערבות (buyerSaleLaw/kombinatsiaOwner/unitCompensationOwner) אינה קיימת. guaranteeCommissionRate הישן הוא שיעור מאוחד שלא ניתן לפיצול אוטומטי בטוח - יש לספק רשימה מפורשת (יכולה להיות ריקה)."
      )
    );
  } else {
    mappedFields.push("guarantees");
    if (guarantees.length === 0 && projectInputs.costs.guaranteeCommissionRate > 0) {
      warnings.push(
        `guarantees ריק אך guaranteeCommissionRate הישן (${projectInputs.costs.guaranteeCommissionRate}) חיובי - כדאי לוודא שההחלטה להשמיט ערבויות מכוונת, לא שכחה.`
      );
    }
  }

  // --- מסגרת/הון/ריבית ---
  const financing = assumptions?.financing;
  let creditFacilityLimitNis: number | null = null;
  if (projectInputs.dealType === "purchaseGroup") {
    creditFacilityLimitNis = financing?.creditFacilityLimitNis ?? 0; // preset מתועד, ניתן לדריסה
  } else if (financing?.creditFacilityLimitNis !== undefined) {
    creditFacilityLimitNis = financing.creditFacilityLimitNis;
  } else {
    missing.push(
      missingItem(
        "CREDIT_FACILITY_LIMIT_MISSING",
        "assumptions.financing.creditFacilityLimitNis",
        "אין בדוח הישן מסגרת אשראי מפורשת - creditFacilityNis הישן הוא ערך נגזר-פנימי בתוך computeCosts (לא חשוף, לא קלט ישיר, ואסור לגזור אותו כאן בדיעבד משיא חוב). יש להזין מסגרת מפורשת."
      )
    );
  }
  if (creditFacilityLimitNis !== null) mappedFields.push("interestAssumptions.creditFacilityLimitNis");

  const annualInterestRate = financing?.annualInterestRate ?? projectInputs.costs.annualInterestRate;
  const rateIssue = validateInterestRateFraction(
    annualInterestRate,
    financing?.annualInterestRate !== undefined ? "assumptions.financing.annualInterestRate" : "costs.annualInterestRate"
  );
  if (rateIssue) missing.push(rateIssue);
  else mappedFields.push("interestAssumptions.annualInterestRate");

  const equityCapNis = financing?.equityCapNis ?? projectInputs.costs.equityNis;
  const minimumCashBalanceNis = financing?.minimumCashBalanceNis ?? 0; // ברירת מחדל בטוחה: אין מינימום נדרש, לא ניחוש עסקי

  // --- עמלת פתיחת תיק: commit 8c - הסכום כבר לא חסום (helper מיוצא), חודש החיוב עדיין כן ---
  let openingFee: FacilityOpeningFee | undefined;
  if (financing?.openingFee) {
    openingFee = financing.openingFee;
    mappedFields.push("financingFeeAssumptions.openingFee");
  } else if (projectInputs.costs.accountOpeningCommissionRate > 0) {
    const computedAmount = computeAccountOpeningCommissionAmount(projectInputs);
    missing.push(
      missingItem(
        "OPENING_FEE_CHARGE_MONTH_MISSING",
        "assumptions.financing.openingFee",
        `עמלת פתיחת תיק ישנה קיימת (accountOpeningCommissionRate>0) - הסכום ניתן לחישוב אוטומטי (${computedAmount.toFixed(2)} ₪, דרך אותו helper כמו computeCosts), אך חודש החיוב (chargeMonthIndex) אינו קיים בדוח הישן. ממופה אך ורק ל-FacilityOpeningFee, לא ללוח העלויות (ר' 7-prep).`
      )
    );
  }
  // accountOpeningCommissionRate===0 וגם אין financing.openingFee -> openingFee נשאר undefined, בלי דגל

  let unusedFacilityCommission: UnusedFacilityCommissionAssumptions | undefined;
  if (financing?.unusedFacilityCommission) {
    unusedFacilityCommission = financing.unusedFacilityCommission;
    mappedFields.push("financingFeeAssumptions.unusedFacilityCommission");
  } else if (projectInputs.costs.unusedCreditCommissionRate > 0) {
    missing.push(
      missingItem(
        "UNUSED_FACILITY_BASIS_MISSING",
        "assumptions.financing.unusedFacilityCommission",
        "עמלת אי-ניצול ישנה קיימת (שיעור), אך בסיס אי-הניצול (UnusedFacilityBalanceBasis: opening/closing/average) וחלון הזמן שלה אינם קיימים בדוח הישן - קונספט חדש ב-Gen2."
      )
    );
  }

  if (missing.length > 0) {
    return { status: "needsAssumptions", cashFlowInput: null, missingAssumptions: missing, warnings, mappedFields };
  }

  // מגיעים לכאן רק כשאין אף missing - כל הערכים הבאים מובטחים תקינים
  const phasesByMonthIndex: Record<number, ProjectPhase[]> = Object.fromEntries(
    axis!.monthIndices.map((m) => [m, ["construction"] as ProjectPhase[]])
  );

  const constructionMonthsCount = axis!.handoverMonthIndex - axis!.constructionStartMonthIndex + 1;
  const resolvedConstructionCurve = resolveConstructionCurve(constructionMonthsCount, assumptions!.constructionCurve);

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
    salesScheduleAssumptions: assumptions!.salesSchedule,
    marketingStartMonthIndex: 0, // ברירת מחדל בטוחה: גבול תחתון מתירני, לא מגביל תזמון מכירה אמיתי
    constructionStartMonthIndex: axis!.constructionStartMonthIndex,
    handoverMonthIndex: axis!.handoverMonthIndex,
    constructionCurve: resolvedConstructionCurve,
    costSchedule,
    guarantees: guarantees!,
    interestAssumptions: {
      equityCapNis,
      minimumCashBalanceNis,
      creditFacilityLimitNis: creditFacilityLimitNis!,
      annualInterestRate,
    },
    financingFeeAssumptions: { openingFee, unusedFacilityCommission },
  };

  return { status: "ready", cashFlowInput, missingAssumptions: [], warnings, mappedFields };
}
