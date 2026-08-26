// commit 8a: מודול עליון שמתזמר את כל מנועי המשנה של דור 2 (תפעולי, ערבויות, מימון מלא) לתזרים
// אחד. אין שכפול נוסחאות - רק הרכבה. אין חיבור ל-ProjectInputs/ProjectResult/computeProject,
// למסכים, ל-Supabase או לייצוא Excel.

import { computeOperatingSchedule } from "./cashflow-operating-schedule";
import type { OperatingScheduleInput, OperatingScheduleResult, SalesUnitRowInput } from "./cashflow-operating-schedule";
import { computeGuaranteeSchedule } from "./cashflow-guarantees";
import type { GuaranteeInstanceInput, GuaranteeScheduleResult } from "./cashflow-guarantees";
import { computeCompleteFinancing } from "./cashflow-complete-financing";
import type { CompleteFinancingResult, FinancingFeeAssumptions } from "./cashflow-complete-financing";
import type { OperatingMonthInput } from "./cashflow-financed-engine";
import { validatePhases } from "./cashflow-validation";
import type { CostScheduleResult } from "./cashflow-cost-schedule";
import type { GuaranteeMechanism, ProjectPhase, SalesScheduleAssumptions } from "./cashflow-types";
import type { InterestCashFlowAssumptions } from "./cashflow-interest-engine";

/**
 * ערבויות ברמת המנוע העליון - buyerSaleLaw **אינו** מקבל תקבולים כקלט (אין לו שדה כזה בטיפוס
 * בכלל): הם נגזרים אך ורק מ-eligibleBuyerReceiptsNis של הלוח התפעולי (OperatingScheduleResult),
 * כדי שלא יהיה מקור אמת כפול לאותו נתון.
 */
export type CashFlowGuaranteeInput =
  | {
      kind: "buyerSaleLaw";
      mechanism: Extract<GuaranteeMechanism, { kind: "buyerSaleLaw" }>;
      releaseMonthIndex: number;
      label?: string;
    }
  | {
      kind: "kombinatsiaOwner";
      mechanism: Extract<GuaranteeMechanism, { kind: "kombinatsiaOwner" }>;
      ownerUnitsMarketValueNis: number;
      startMonthIndex: number;
      label?: string;
    }
  | {
      kind: "unitCompensationOwner";
      mechanism: Extract<GuaranteeMechanism, { kind: "unitCompensationOwner" }>;
      compensationUnitValueNis: number;
      startMonthIndex: number;
      releaseMonthIndex: number;
      /** מזהה חובה (לא label אופציונלי) - ריבוי מופעים מותר במפורש (אחד לכל דייר/דירת תמורה),
       *  ולכן זיהוי מי הבעלים הוא לא רק "נחמד שיהיה", הוא חלק מהמשמעות של המופע */
      ownerId: string;
    };

export interface CashFlowInput {
  /** ציר החודשים הסמכותי - רציף, ממוין, בלי כפילויות */
  monthIndices: number[];
  /** כל CashFlowMonth (מנועי המשנה) דורש phases לא-ריק - קלט מפורש, לא מוסק/מברירת מחדל */
  phasesByMonthIndex: Record<number, ProjectPhase[]>;

  salesUnitRows: SalesUnitRowInput[];
  salesScheduleAssumptions: SalesScheduleAssumptions;
  marketingStartMonthIndex: number;
  constructionStartMonthIndex: number;
  handoverMonthIndex: number;
  constructionCurve?: number[];
  /** תוצאת computeCostSchedule - לא מחושב כאן מחדש */
  costSchedule: CostScheduleResult;

  guarantees: CashFlowGuaranteeInput[];

  interestAssumptions: InterestCashFlowAssumptions;
  financingFeeAssumptions: FinancingFeeAssumptions;
  /** לבדיקות בלבד - ר' cashflow-complete-financing.ts */
  maxIterations?: number;
}

export interface CashFlowSummary {
  totalOperatingInflowsNis: number;
  totalOperatingOutflowsNis: number;
  totalGuaranteeExpenseNis: number;
  totalOpeningFeeExpenseNis: number;
  totalUnusedFacilityCommissionNis: number;
  totalFinancingFeeExpenseNis: number;
  totalInterestExpenseNis: number;
  totalEquityInjectedNis: number;
  peakClosingDebtBalanceNis: number;
  peakClosingDebtMonthIndex: number | null;
  peakFundingDeficitNis: number;
  firstFundingDeficitMonthIndex: number | null;
  facilityExceeded: boolean;
  activeGuaranteesBeyondForecast: boolean;
  iterationsUsed: number;
}

/**
 * union מבחין בשלושה מצבים על `status`, לא רק `isComplete` בוליאני - כדי לא לערבב בין הנחה
 * מקצועית חסרה (incompleteAssumptions) לבין כשל חישובי (notConverged, הלולאה ב-
 * computeCompleteFinancing לא התכנסה). `isComplete` נשאר גם כמראה נוחה (true רק ב-"complete").
 */
export type CashFlowResult =
  | {
      status: "incompleteAssumptions";
      isComplete: false;
      operatingSchedule: OperatingScheduleResult;
      /** null אם הלוח התפעולי עצמו כבר לא היה מלא (אף פעם לא הגענו לחישוב ערבויות) */
      guaranteeSchedule: GuaranteeScheduleResult | null;
      financing: null;
      missingAssumptions: string[];
      warnings: string[];
    }
  | {
      status: "notConverged";
      isComplete: false;
      operatingSchedule: OperatingScheduleResult;
      guaranteeSchedule: GuaranteeScheduleResult;
      /** מוצג במפורש, לא מוסתר - כשל חישובי, לא תוצאה סופית (ר' isConverged=false בתוכו) */
      financing: CompleteFinancingResult;
      missingAssumptions: [];
      warnings: string[];
    }
  | {
      status: "complete";
      isComplete: true;
      operatingSchedule: OperatingScheduleResult;
      guaranteeSchedule: GuaranteeScheduleResult;
      financing: CompleteFinancingResult;
      missingAssumptions: [];
      warnings: string[];
      summary: CashFlowSummary;
    };

function validateMonthIndices(monthIndices: number[]): void {
  if (monthIndices.length === 0) {
    throw new Error("monthIndices ריק");
  }
  for (const [i, m] of monthIndices.entries()) {
    if (!Number.isFinite(m) || !Number.isInteger(m)) {
      throw new Error(`monthIndices[${i}] אינו מספר שלם סופי (${m})`);
    }
  }
  const first = monthIndices[0];
  for (const [i, m] of monthIndices.entries()) {
    const expected = first + i;
    if (m !== expected) {
      throw new Error(
        `monthIndices חייב להיות רציף, ממוין, בלי כפילויות: באינדקס ${i} צפוי monthIndex=${expected}, התקבל ${m}`
      );
    }
  }
}

function validatePhasesByMonthIndex(monthIndices: number[], phasesByMonthIndex: Record<number, ProjectPhase[]>): void {
  for (const m of monthIndices) {
    const phases = phasesByMonthIndex[m];
    if (!phases) {
      throw new Error(`phasesByMonthIndex חסר עבור monthIndex=${m}`);
    }
    const check = validatePhases(phases);
    if (!check.valid) {
      throw new Error(`phasesByMonthIndex[${m}] לא תקין: ${check.errors.join("; ")}`);
    }
  }
}

/** buyerSaleLaw ניזון אך ורק מ-eligibleBuyerReceiptsNis של הלוח התפעולי - אין דרך לקוד קורא
 *  לספק תקבולים בנפרד (הטיפוס CashFlowGuaranteeInput["buyerSaleLaw"] פשוט אין לו שדה כזה) */
function buildGuaranteeInstances(
  guarantees: CashFlowGuaranteeInput[],
  operatingSchedule: OperatingScheduleResult,
  monthIndices: number[]
): GuaranteeInstanceInput[] {
  const eligibleByMonth = new Map(operatingSchedule.months.map((m) => [m.monthIndex, m.eligibleBuyerReceiptsNis]));

  return guarantees.map((g): GuaranteeInstanceInput => {
    if (g.kind === "buyerSaleLaw") {
      return {
        kind: "buyerSaleLaw",
        mechanism: g.mechanism,
        label: g.label,
        monthlyEligibleBuyerReceiptsNis: monthIndices.map((m) => eligibleByMonth.get(m) ?? 0),
        releaseMonthIndex: g.releaseMonthIndex,
      };
    }
    if (g.kind === "kombinatsiaOwner") {
      return {
        kind: "kombinatsiaOwner",
        mechanism: g.mechanism,
        label: g.label,
        ownerUnitsMarketValueNis: g.ownerUnitsMarketValueNis,
        startMonthIndex: g.startMonthIndex,
      };
    }
    return {
      kind: "unitCompensationOwner",
      mechanism: g.mechanism,
      label: g.ownerId,
      compensationUnitValueNis: g.compensationUnitValueNis,
      startMonthIndex: g.startMonthIndex,
      releaseMonthIndex: g.releaseMonthIndex,
    };
  });
}

/** מאחד operatingSchedule.warnings + completeFinancing.warnings + דגלים ממוקדים (activeBeyondForecast/
 *  facilityExceeded/גירעון מימון) לרשימה אחת בלי כפילויות (Set) */
function collectWarnings(
  operatingSchedule: OperatingScheduleResult,
  guaranteeSchedule: GuaranteeScheduleResult,
  financing: CompleteFinancingResult
): string[] {
  const warnings = new Set<string>();
  for (const w of operatingSchedule.warnings) warnings.add(w);
  for (const w of financing.warnings) warnings.add(w);
  if (guaranteeSchedule.activeBeyondForecast) {
    warnings.add("ערבות (קומבינציה) פעילה מעבר לגבול ציר התחזית");
  }
  if (financing.facilityExceeded) {
    warnings.add("מסגרת האשראי חרגה בחודש כלשהו בפרויקט");
  }
  if (financing.peakFundingDeficitNis > 0) {
    warnings.add(`גירעון מימון בפרויקט - שיא ${financing.peakFundingDeficitNis.toFixed(2)} ₪`);
  }
  return Array.from(warnings);
}

/**
 * מנוע התזרים המלא: מתזמר computeOperatingSchedule -> computeGuaranteeSchedule ->
 * computeCompleteFinancing, בלי לשכפל אף נוסחה מהם.
 *
 * סדר:
 * 1. לוח תפעולי (תקבולים+עלויות, computeOperatingSchedule). אם לא מלא (missingAssumptions לא
 *    ריק) - עוצר לפני מימון: status="incompleteAssumptions", guaranteeSchedule/financing=null.
 * 2. לוח ערבויות (computeGuaranteeSchedule) - buyerSaleLaw ניזון מ-eligibleBuyerReceiptsNis של
 *    הלוח התפעולי בלבד (לא קלט נפרד - נמנע מקור אמת כפול). אם לו עצמו יש missingAssumptions
 *    (unitCompensationOwner עם annualRateFraction="requiresVerification") - גם זה עוצר לפני
 *    מימון: status="incompleteAssumptions", עם guaranteeSchedule (כן חושב) אך financing=null.
 * 3. חישוב מימון מלא (computeCompleteFinancing, כולל הלולאה עד התכנסות). לא התכנס - זה כשל
 *    חישובי, לא הנחה חסרה: status="notConverged", לא "incompleteAssumptions" - financing עדיין
 *    מוחזר במלואו (לא מוסתר), רק לא מסומן כסופי.
 * 4. הכל תקין ומתכנס: status="complete", עם summary מאוחד - כל מספר מגיע ממנוע משנה קיים
 *    (financing/operatingSchedule), אף אחד לא מחושב כאן מחדש.
 */
export function computeCashFlow(input: CashFlowInput): CashFlowResult {
  const {
    monthIndices,
    phasesByMonthIndex,
    salesUnitRows,
    salesScheduleAssumptions,
    marketingStartMonthIndex,
    constructionStartMonthIndex,
    handoverMonthIndex,
    constructionCurve,
    costSchedule,
    guarantees,
    interestAssumptions,
    financingFeeAssumptions,
    maxIterations,
  } = input;

  validateMonthIndices(monthIndices);
  validatePhasesByMonthIndex(monthIndices, phasesByMonthIndex);

  const operatingScheduleInput: OperatingScheduleInput = {
    monthIndices,
    salesUnitRows,
    salesScheduleAssumptions,
    marketingStartMonthIndex,
    constructionStartMonthIndex,
    handoverMonthIndex,
    constructionCurve,
    costSchedule,
  };
  const operatingSchedule = computeOperatingSchedule(operatingScheduleInput);

  if (!operatingSchedule.isComplete) {
    return {
      status: "incompleteAssumptions",
      isComplete: false,
      operatingSchedule,
      guaranteeSchedule: null,
      financing: null,
      missingAssumptions: operatingSchedule.missingAssumptions,
      warnings: operatingSchedule.warnings,
    };
  }

  const guaranteeInstances = buildGuaranteeInstances(guarantees, operatingSchedule, monthIndices);
  const guaranteeSchedule = computeGuaranteeSchedule({ monthIndices, instances: guaranteeInstances });

  if (guaranteeSchedule.missingAssumptions.length > 0) {
    return {
      status: "incompleteAssumptions",
      isComplete: false,
      operatingSchedule,
      guaranteeSchedule,
      financing: null,
      missingAssumptions: [...operatingSchedule.missingAssumptions, ...guaranteeSchedule.missingAssumptions],
      warnings: operatingSchedule.warnings,
    };
  }

  const operatingByMonth = new Map(operatingSchedule.months.map((m) => [m.monthIndex, m]));
  const operatingMonths: OperatingMonthInput[] = monthIndices.map((monthIndex) => {
    const om = operatingByMonth.get(monthIndex)!;
    return {
      monthIndex,
      operatingInflowsNis: om.totalOperatingInflowsNis,
      operatingOutflowsNis: om.totalOperatingOutflowsNis,
      phases: phasesByMonthIndex[monthIndex],
    };
  });

  const financing = computeCompleteFinancing({
    operatingMonths,
    guaranteeSchedule,
    interestAssumptions,
    financingFeeAssumptions,
    maxIterations,
  });

  if (!financing.isConverged) {
    return {
      status: "notConverged",
      isComplete: false,
      operatingSchedule,
      guaranteeSchedule,
      financing,
      missingAssumptions: [],
      warnings: collectWarnings(operatingSchedule, guaranteeSchedule, financing),
    };
  }

  const summary: CashFlowSummary = {
    totalOperatingInflowsNis: operatingSchedule.totalOperatingInflowsNis,
    totalOperatingOutflowsNis: financing.totalOperatingOutflowsNis,
    totalGuaranteeExpenseNis: financing.totalGuaranteeExpenseNis,
    totalOpeningFeeExpenseNis: financing.totalOpeningFeeExpenseNis,
    totalUnusedFacilityCommissionNis: financing.totalUnusedFacilityCommissionNis,
    totalFinancingFeeExpenseNis: financing.totalFinancingFeeExpenseNis,
    totalInterestExpenseNis: financing.totalInterestExpenseNis,
    totalEquityInjectedNis: financing.totalEquityInjectedNis,
    peakClosingDebtBalanceNis: financing.peakClosingDebtBalanceNis,
    peakClosingDebtMonthIndex: financing.peakClosingDebtBalanceMonthIndex,
    peakFundingDeficitNis: financing.peakFundingDeficitNis,
    firstFundingDeficitMonthIndex: financing.firstFundingDeficitMonthIndex,
    facilityExceeded: financing.facilityExceeded,
    activeGuaranteesBeyondForecast: financing.activeGuaranteesBeyondForecast,
    iterationsUsed: financing.iterationsUsed,
  };

  return {
    status: "complete",
    isComplete: true,
    operatingSchedule,
    guaranteeSchedule,
    financing,
    missingAssumptions: [],
    warnings: collectWarnings(operatingSchedule, guaranteeSchedule, financing),
    summary,
  };
}
