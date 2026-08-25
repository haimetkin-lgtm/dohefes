// commit 4 של מנוע התזרים: מנוע תזרים בסיסי בלבד. פונקציה טהורה שמקבלת קלט חודשי מוכן
// (תקבולים/תשלומים, כבר מחושבים על ידי commits 2-3) ומריצה waterfall של מזומן/הון עצמי/אשראי.
// אין כאן ריבית, ערבויות, עמלת אי-ניצול או פתיחת תיק (commit 5). אין חיבור ל-ProjectInputs,
// computeProject, React או Supabase - שכבה תוספתית טהורה. ר' GEN2_CASHFLOW_DESIGN.md §4.

import { validatePhases } from "./cashflow-validation";
import type { ProjectPhase } from "./cashflow-types";

export interface BaseCashFlowMonthInput {
  monthIndex: number;
  inflowsNis: number;
  outflowsNis: number;
  phases: ProjectPhase[];
}

export interface BaseCashFlowAssumptions {
  equityCapNis: number;
  minimumCashBalanceNis: number;
  creditFacilityLimitNis: number;
}

export interface BaseCashFlowMonth {
  monthIndex: number;
  phases: ProjectPhase[];

  openingCashBalanceNis: number;
  openingDebtBalanceNis: number;

  inflowsNis: number;
  outflowsNis: number;
  equityInjectionNis: number;
  creditDrawNis: number;
  creditRepaymentNis: number;

  /** חוסר מימון גלוי: כמה חסר בחודש הזה אחרי מיצוי הון עצמי+מסגרת. 0 אם אין חוסר. */
  fundingShortfallNis: number;

  closingCashBalanceNis: number;
  closingDebtBalanceNis: number;
}

export interface BaseCashFlowResult {
  months: BaseCashFlowMonth[];
  totalEquityInjectedNis: number;
  peakDebtBalanceNis: number;
  peakDebtMonthIndex: number | null;
  maximumFundingShortfallNis: number;
  /** true אם יש חודש כלשהו עם fundingShortfallNis > 0 */
  facilityExceeded: boolean;
}

function validateFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} חייב להיות מספר סופי לא-שלילי (התקבל ${value})`);
  }
}

function validateAssumptions(assumptions: BaseCashFlowAssumptions): void {
  validateFiniteNonNegative(assumptions.equityCapNis, "equityCapNis");
  validateFiniteNonNegative(assumptions.minimumCashBalanceNis, "minimumCashBalanceNis");
  validateFiniteNonNegative(assumptions.creditFacilityLimitNis, "creditFacilityLimitNis");
}

function validateMonthlyInputs(monthlyInputs: BaseCashFlowMonthInput[]): void {
  if (monthlyInputs.length === 0) {
    throw new Error("monthlyInputs ריק");
  }

  for (const [i, input] of monthlyInputs.entries()) {
    if (!Number.isFinite(input.monthIndex) || !Number.isInteger(input.monthIndex)) {
      throw new Error(`חודש באינדקס ${i}: monthIndex אינו מספר שלם סופי (${input.monthIndex})`);
    }
    validateFiniteNonNegative(input.inflowsNis, `inflowsNis בחודש ${input.monthIndex}`);
    validateFiniteNonNegative(input.outflowsNis, `outflowsNis בחודש ${input.monthIndex}`);
    const phasesValidation = validatePhases(input.phases);
    if (!phasesValidation.valid) {
      throw new Error(`חודש ${input.monthIndex}: phases לא תקין - ${phasesValidation.errors.join("; ")}`);
    }
  }

  // רציפים, ממוינים, בלי כפילויות: monthIndex[i] === monthIndex[0]+i לכל i - לא ממיינים בשקט,
  // קלט לא-רציף/לא-ממוין/עם כפילות הוא סימן לבאג בהרכבת הקלט, לא מקרה ל"תיקון" אוטומטי.
  const firstMonth = monthlyInputs[0].monthIndex;
  for (const [i, input] of monthlyInputs.entries()) {
    const expected = firstMonth + i;
    if (input.monthIndex !== expected) {
      throw new Error(
        `monthlyInputs חייב להיות רציף, ממוין, בלי כפילויות: באינדקס ${i} צפוי monthIndex=${expected}, התקבל ${input.monthIndex}`
      );
    }
  }
}

/**
 * מנוע תזרים בסיסי: waterfall חודשי של מזומן/הון עצמי/אשראי, בלי ריבית/ערבויות/עמלות (ר' commit 5).
 *
 * סדר חישוב לכל חודש (ר' §4.2 במסמך התכנון, מצומצם לשלב הבסיסי):
 * 1. יתרות פתיחה = יתרות סגירה של החודש הקודם (0 בחודש הראשון).
 * 2. cashBeforeFinancing = openingCash + inflows - outflows.
 * 3. אם cashBeforeFinancing < minimumCashBalanceNis: הזרמת הון עצמי עד לצורך/לתקרה שנותרה,
 *    ואז משיכת אשראי עד לצורך/למסגרת שנותרה (openingDebt כבר בחשבון) - בסדר הזה, לא הפוך.
 * 4. fundingShortfallNis = max(0, minimumCashBalanceNis - cashAfterAvailableFunding) - חוסר גלוי,
 *    לא ממציאים כסף מעבר להון+מסגרת.
 * 5. עודף מעל המינימום (אם יש) משמש לפירעון חוב, מוגבל ליתרת החוב הקיימת (לא פורעים יותר משיש).
 * 6. יתרות סגירה נגזרות אלגברית מהתאמות המקורות/שימושים (ר' בדיקות ה-reconciliation).
 *
 * לא ממיין/מתקן קלט בשקט: monthlyInputs חייב להגיע רציף, ממוין, בלי כפילויות, אחרת נזרקת שגיאה.
 * לא נוגע במערך/באובייקטים שהתקבלו - כל הפלט הוא אובייקטים חדשים.
 */
export function computeBaseCashFlow(monthlyInputs: BaseCashFlowMonthInput[], assumptions: BaseCashFlowAssumptions): BaseCashFlowResult {
  validateAssumptions(assumptions);
  validateMonthlyInputs(monthlyInputs);

  const months: BaseCashFlowMonth[] = [];
  let openingCashBalanceNis = 0;
  let openingDebtBalanceNis = 0;
  let equityInjectedSoFar = 0;

  for (const input of monthlyInputs) {
    const cashBeforeFinancing = openingCashBalanceNis + input.inflowsNis - input.outflowsNis;

    let equityInjectionNis = 0;
    let creditDrawNis = 0;

    if (cashBeforeFinancing < assumptions.minimumCashBalanceNis) {
      const shortfallBeforeFinancing = assumptions.minimumCashBalanceNis - cashBeforeFinancing;

      // 1) הון עצמי, עד לצורך או לתקרה שנותרה - הראשון בתור
      const remainingEquityCap = assumptions.equityCapNis - equityInjectedSoFar;
      equityInjectionNis = Math.min(shortfallBeforeFinancing, Math.max(0, remainingEquityCap));

      // 2) אשראי, עד לצורך שנותר אחרי ההון העצמי, או למסגרת שנותרה (לפי יתרת הפתיחה) - השני בתור
      const remainingShortfall = shortfallBeforeFinancing - equityInjectionNis;
      const availableFacilityNis = Math.max(0, assumptions.creditFacilityLimitNis - openingDebtBalanceNis);
      creditDrawNis = Math.min(remainingShortfall, availableFacilityNis);
    }

    const cashAfterAvailableFunding = cashBeforeFinancing + equityInjectionNis + creditDrawNis;
    const fundingShortfallNis = Math.max(0, assumptions.minimumCashBalanceNis - cashAfterAvailableFunding);

    // עודף מעל המינימום פורע חוב, לא יותר משיש בפועל (יתרת פתיחה + משיכת החודש הזה)
    const debtBeforeRepaymentNis = openingDebtBalanceNis + creditDrawNis;
    const surplusNis = Math.max(0, cashAfterAvailableFunding - assumptions.minimumCashBalanceNis);
    const creditRepaymentNis = Math.min(surplusNis, debtBeforeRepaymentNis);

    const closingCashBalanceNis = cashAfterAvailableFunding - creditRepaymentNis;
    const closingDebtBalanceNis = debtBeforeRepaymentNis - creditRepaymentNis;

    months.push({
      monthIndex: input.monthIndex,
      phases: [...input.phases],
      openingCashBalanceNis,
      openingDebtBalanceNis,
      inflowsNis: input.inflowsNis,
      outflowsNis: input.outflowsNis,
      equityInjectionNis,
      creditDrawNis,
      creditRepaymentNis,
      fundingShortfallNis,
      closingCashBalanceNis,
      closingDebtBalanceNis,
    });

    equityInjectedSoFar += equityInjectionNis;
    openingCashBalanceNis = closingCashBalanceNis;
    openingDebtBalanceNis = closingDebtBalanceNis;
  }

  let peakDebtBalanceNis = 0;
  let peakDebtMonthIndex: number | null = null;
  let maximumFundingShortfallNis = 0;
  let facilityExceeded = false;

  for (const month of months) {
    if (month.closingDebtBalanceNis > peakDebtBalanceNis) {
      peakDebtBalanceNis = month.closingDebtBalanceNis;
      peakDebtMonthIndex = month.monthIndex;
    }
    if (month.fundingShortfallNis > maximumFundingShortfallNis) {
      maximumFundingShortfallNis = month.fundingShortfallNis;
    }
    if (month.fundingShortfallNis > 0) {
      facilityExceeded = true;
    }
  }

  return {
    months,
    totalEquityInjectedNis: equityInjectedSoFar,
    peakDebtBalanceNis,
    peakDebtMonthIndex,
    maximumFundingShortfallNis,
    facilityExceeded,
  };
}
