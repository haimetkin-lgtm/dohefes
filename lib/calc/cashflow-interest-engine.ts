// commit 5 של מנוע התזרים: שכבת ריבית בלבד. מרחיבה את הלוגיקה של commit 4 (computeBaseCashFlow,
// שנשאר ללא שינוי) עם ריבית חודשית מהוונת לחוב. עדיין בלי ערבויות, עמלת אי-ניצול, עמלת פתיחת תיק,
// IRR/NPV, חיבור ל-ProjectInputs/computeProject/React/Supabase. ר' GEN2_CASHFLOW_DESIGN.md §4.4.

import { validatePhases } from "./cashflow-validation";
import type { ProjectPhase } from "./cashflow-types";

export interface InterestCashFlowMonthInput {
  monthIndex: number;
  inflowsNis: number;
  outflowsNis: number;
  phases: ProjectPhase[];
}

export interface InterestCashFlowAssumptions {
  equityCapNis: number;
  minimumCashBalanceNis: number;
  creditFacilityLimitNis: number;
  /** שבר עשרוני שנתי, למשל 0.06 = 6% - לא 6. נדחה אם >1 (100%), כנראה טעות אחוז-במקום-שבר */
  annualInterestRate: number;
}

export interface InterestCashFlowMonth {
  monthIndex: number;
  phases: ProjectPhase[];

  openingCashBalanceNis: number;
  openingDebtBalanceNis: number;

  inflowsNis: number;
  outflowsNis: number;
  equityInjectionNis: number;
  creditDrawNis: number;
  creditRepaymentNis: number;

  annualInterestRate: number;
  monthlyInterestRate: number;
  /** יתרת חוב אחרי משיכה/פירעון של החודש, לפני הוספת הריבית של אותו חודש - הבסיס לחישוב הריבית */
  closingDebtBeforeInterestNis: number;
  /** = closingDebtBeforeInterestNis * monthlyInterestRate. מהוונת לחוב, לא נרשמת כתשלום מזומן */
  interestExpenseNis: number;

  fundingDeficitBalanceNis: number;
  closingCashBalanceNis: number;
  closingDebtBalanceNis: number;

  /** מחושב **אחרי** הריבית: max(0, creditFacilityLimitNis - closingDebtBalanceNis) */
  availableCreditFacilityNis: number;
  /**
   * חדש בשלב הריבית: max(0, closingDebtBalanceNis - creditFacilityLimitNis). חריגה מהמסגרת
   * שיכולה לקרות **גם בלי משיכה חדשה בחודש הזה** - אם יתרת הפתיחה כבר קרובה מדי למסגרת, הריבית
   * לבדה עלולה לדחוף את יתרת הסגירה מעליה. תג המסגרת עצמו (creditDrawNis) תמיד מוגבל מראש כדי
   * שלא יגרום לחריגה כזו לבד (ר' maximumDebtBeforeInterestNis בתיעוד הפונקציה), אבל זה לא מונע
   * חריגה שמקורה בריבית על חוב קיים בלבד - זה בדיוק מה שהשדה הזה חושף, לא מסתיר.
   */
  facilityBreachNis: number;
}

export interface InterestCashFlowResult {
  months: InterestCashFlowMonth[];
  totalEquityInjectedNis: number;
  totalInterestExpenseNis: number;
  peakClosingDebtBalanceNis: number;
  /** נשמר בשם הזה (לא peakDebtMonthIndex) - מקור אמת יחיד עם commit 4b, לא כפילות בשם קצר יותר */
  peakClosingDebtBalanceMonthIndex: number | null;
  peakFundingDeficitNis: number;
  firstFundingDeficitMonthIndex: number | null;
  /** true אם יש חודש עם fundingDeficitBalanceNis>0 **או** facilityBreachNis>0 */
  facilityExceeded: boolean;
}

function validateFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} חייב להיות מספר סופי לא-שלילי (התקבל ${value})`);
  }
}

const MAX_PLAUSIBLE_ANNUAL_INTEREST_RATE = 1; // 100% שנתי - תקרה נדיבה שעדיין תופסת טעות אחוז-במקום-שבר (6 במקום 0.06)

/**
 * commit 5b: שיעורי ריבית לא-עגולים (למשל 0.005) יוצרים שאריות נקודה-צפה זניחות (כגון 5.8e-11)
 * סביב גבולות המסגרת/המינימום. MONEY_EPSILON_NIS אינו עיגול כללי של יתרות (שהיה צובר סטייה) -
 * הוא סף לנטרול רעש חישוב זניח רק בשדות שמשמשים כבדיקת סף מול 0 (facilityBreachNis,
 * fundingDeficitBalanceNis, availableCreditFacilityNis). 0.01 ש"ח (אגורה) קטן בהרבה מכל חריגה
 * כלכלית אמיתית, ולכן לא עלול להסתיר בעיה אמיתית.
 */
const MONEY_EPSILON_NIS = 0.01;

function normalizeMoney(value: number): number {
  return Math.abs(value) < MONEY_EPSILON_NIS ? 0 : value;
}

function validateAssumptions(assumptions: InterestCashFlowAssumptions): void {
  validateFiniteNonNegative(assumptions.equityCapNis, "equityCapNis");
  validateFiniteNonNegative(assumptions.minimumCashBalanceNis, "minimumCashBalanceNis");
  validateFiniteNonNegative(assumptions.creditFacilityLimitNis, "creditFacilityLimitNis");
  if (!Number.isFinite(assumptions.annualInterestRate) || assumptions.annualInterestRate < 0) {
    throw new Error(`annualInterestRate חייב להיות מספר סופי לא-שלילי (התקבל ${assumptions.annualInterestRate})`);
  }
  if (assumptions.annualInterestRate > MAX_PLAUSIBLE_ANNUAL_INTEREST_RATE) {
    throw new Error(
      `annualInterestRate (${assumptions.annualInterestRate}) גבוה בהרבה משיעורי ריבית מקובלים - האם הוזן אחוז (למשל 6) במקום שבר (0.06)?`
    );
  }
}

function validateMonthlyInputs(monthlyInputs: InterestCashFlowMonthInput[]): void {
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
 * מנוע תזרים עם ריבית מהוונת חודשית. מרחיב את ה-waterfall של commit 4 (הזרמת הון->משיכת אשראי->
 * פירעון מעודף) בשלב ריבית נוסף בסוף, ובתקרת משיכה מותאמת-ריבית כדי שהמסגרת לא תיחרג בשקט.
 *
 * סדר חישוב לכל חודש:
 * 1. יתרות פתיחה = יתרות סגירה של החודש הקודם (כולל ריבית שהוונה בחודשים קודמים).
 * 2. cashBeforeFinancing = openingCash + inflows - outflows.
 * 3. אם חסר: הון עצמי עד לצורך/לתקרה שנותרה, ואז משיכת אשראי - **מוגבלת לא רק למסגרת הגולמית
 *    אלא למסגרת פחות מקום שמורה לריבית שתתווסף באותו חודש**:
 *      monthlyInterestRate = annualInterestRate/12
 *      maximumDebtBeforeInterestNis = creditFacilityLimitNis / (1+monthlyInterestRate)
 *      availableDrawBeforeInterestNis = max(0, maximumDebtBeforeInterestNis - openingDebtBalanceNis)
 *    (אין מעגליות: הנוסחה אלגברית סגורה, לא איטרטיבית - ר' הוכחה בתיעוד המפרט).
 * 4. עודף מעל המינימום (אם יש) פורע חוב, מוגבל ליתרה הקיימת - זהה ל-commit 4.
 * 5. closingDebtBeforeInterestNis = openingDebt + draw - repayment (לפני ריבית).
 * 6. interestExpenseNis = closingDebtBeforeInterestNis * monthlyInterestRate. **מוסכמת "יתרת סגירה
 *    חודשית"**: הריבית מחושבת פעם אחת על יתרת סוף החודש (אחרי הפעילות התפעולית), לא אינטגרציה
 *    יומית - זהה בגישה למקור (01-תמא-38.md: interest[t]=rate/4*balance[t] רבעונית).
 * 7. closingDebtBalanceNis = closingDebtBeforeInterestNis + interestExpenseNis. הריבית **לא**
 *    יוצאת כמזומן (מהוונת לחוב) - closingCashBalanceNis לא כולל אותה.
 * 8. facilityBreachNis חושף חריגה שיכולה לקרות גם בלי משיכה חדשה (ריבית על יתרת פתיחה קרובה מדי
 *    למסגרת) - לא מוסתרת, לא NaN, לא "מוצגת כאילו המימון תקין".
 *
 * לא ממיין/מתקן קלט בשקט. לא נוגע במערך/באובייקטים שהתקבלו.
 */
export function computeInterestCashFlow(
  monthlyInputs: InterestCashFlowMonthInput[],
  assumptions: InterestCashFlowAssumptions
): InterestCashFlowResult {
  validateAssumptions(assumptions);
  validateMonthlyInputs(monthlyInputs);

  const monthlyInterestRate = assumptions.annualInterestRate / 12;
  const maximumDebtBeforeInterestNis = assumptions.creditFacilityLimitNis / (1 + monthlyInterestRate);

  const months: InterestCashFlowMonth[] = [];
  let openingCashBalanceNis = 0;
  let openingDebtBalanceNis = 0;
  let equityInjectedSoFar = 0;

  for (const input of monthlyInputs) {
    const cashBeforeFinancing = openingCashBalanceNis + input.inflowsNis - input.outflowsNis;

    let equityInjectionNis = 0;
    let creditDrawNis = 0;

    if (cashBeforeFinancing < assumptions.minimumCashBalanceNis) {
      const shortfallBeforeFinancing = assumptions.minimumCashBalanceNis - cashBeforeFinancing;

      const remainingEquityCap = assumptions.equityCapNis - equityInjectedSoFar;
      equityInjectionNis = Math.min(shortfallBeforeFinancing, Math.max(0, remainingEquityCap));

      const remainingShortfall = shortfallBeforeFinancing - equityInjectionNis;
      // תקרה מותאמת-ריבית, לא creditFacilityLimitNis הגולמית - משאירה מקום לריבית שתתווסף בשלב 6-7
      const availableDrawBeforeInterestNis = Math.max(0, maximumDebtBeforeInterestNis - openingDebtBalanceNis);
      creditDrawNis = Math.min(remainingShortfall, availableDrawBeforeInterestNis);
    }

    const cashAfterAvailableFunding = cashBeforeFinancing + equityInjectionNis + creditDrawNis;

    const debtBeforeRepaymentNis = openingDebtBalanceNis + creditDrawNis;
    const surplusNis = Math.max(0, cashAfterAvailableFunding - assumptions.minimumCashBalanceNis);
    const creditRepaymentNis = Math.min(surplusNis, debtBeforeRepaymentNis);

    const closingDebtBeforeInterestNis = debtBeforeRepaymentNis - creditRepaymentNis;
    const interestExpenseNis = closingDebtBeforeInterestNis * monthlyInterestRate;
    const closingDebtBalanceNis = closingDebtBeforeInterestNis + interestExpenseNis;

    // הריבית לא יוצאת כמזומן - התאמת המזומן זהה ל-commit 4, בלי מרכיב הריבית
    const closingCashBalanceNis = cashAfterAvailableFunding - creditRepaymentNis;
    const fundingDeficitBalanceNis = normalizeMoney(Math.max(0, assumptions.minimumCashBalanceNis - closingCashBalanceNis));

    const availableCreditFacilityNis = normalizeMoney(Math.max(0, assumptions.creditFacilityLimitNis - closingDebtBalanceNis));
    const facilityBreachNis = normalizeMoney(Math.max(0, closingDebtBalanceNis - assumptions.creditFacilityLimitNis));

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
      annualInterestRate: assumptions.annualInterestRate,
      monthlyInterestRate,
      closingDebtBeforeInterestNis,
      interestExpenseNis,
      fundingDeficitBalanceNis,
      closingCashBalanceNis,
      closingDebtBalanceNis,
      availableCreditFacilityNis,
      facilityBreachNis,
    });

    equityInjectedSoFar += equityInjectionNis;
    openingCashBalanceNis = closingCashBalanceNis;
    openingDebtBalanceNis = closingDebtBalanceNis;
  }

  let totalInterestExpenseNis = 0;
  let peakClosingDebtBalanceNis = 0;
  let peakClosingDebtBalanceMonthIndex: number | null = null;
  let peakFundingDeficitNis = 0;
  let firstFundingDeficitMonthIndex: number | null = null;
  let facilityExceeded = false;

  for (const month of months) {
    totalInterestExpenseNis += month.interestExpenseNis;
    if (month.closingDebtBalanceNis > peakClosingDebtBalanceNis) {
      peakClosingDebtBalanceNis = month.closingDebtBalanceNis;
      peakClosingDebtBalanceMonthIndex = month.monthIndex;
    }
    if (month.fundingDeficitBalanceNis > peakFundingDeficitNis) {
      peakFundingDeficitNis = month.fundingDeficitBalanceNis;
    }
    // firstFundingDeficitMonthIndex/peakFundingDeficitNis נשארים ספציפית על גירעון מזומן (כמו 4b) -
    // לא מתערבב עם facilityBreachNis (חריגת חוב-מול-מסגרת, תופעה שונה). facilityExceeded מתרחב
    // לכסות את שניהם, כי שמו כבר כללי ("המסגרת נחצתה"), לא ספציפי לאחד מהם.
    if (month.fundingDeficitBalanceNis > 0 && firstFundingDeficitMonthIndex === null) {
      firstFundingDeficitMonthIndex = month.monthIndex;
    }
    if (month.fundingDeficitBalanceNis > 0 || month.facilityBreachNis > 0) {
      facilityExceeded = true;
    }
  }

  return {
    months,
    totalEquityInjectedNis: equityInjectedSoFar,
    totalInterestExpenseNis,
    peakClosingDebtBalanceNis,
    peakClosingDebtBalanceMonthIndex,
    peakFundingDeficitNis,
    firstFundingDeficitMonthIndex,
    facilityExceeded,
  };
}
