// commit 3 (+3b, סבב תיקונים) של מנוע התזרים: תרגום PaymentTranche ללוח תקבולים חודשי. פונקציות
// טהורות בלבד - אין הון עצמי, אשראי, ריבית או ערבויות כאן (זה מנוע התזרים הבסיסי, commit 4).
// ר' GEN2_CASHFLOW_DESIGN.md §3.

import { validateCumulativePercentByMonth, validatePaymentSchedule } from "./cashflow-validation";
import type { PaymentTranche, SaleScheduleModel } from "./cashflow-types";
import type { UnitCategory } from "./types";

export interface MonthlyReceipt {
  monthIndex: number;
  amountNis: number;
}

/**
 * שכבת מכירה נפרדת מלוח התשלומים (תוקן, ר' סבב ביקורת 3b): כמה יחידות מאותה שורת תמהיל נמכרות
 * באיזה חודש. לוח PaymentTranche מוחל בנפרד על כל batch, לפי saleMonth שלו - לא כל היחידות
 * "נמכרות" באותו חודש בודד. אותו טיפוס יכול להופיע במספר batches (מכירה הדרגתית לאורך התקופה).
 */
export interface UnitSalesBatch {
  unitsCount: number;
  saleMonth: number;
}

/** תת-קבוצת שדות UnitType הרלוונטיים ברמת השורה (קטגוריה/דגלים, לא כמות/מחיר של batch בודד) */
export interface ReceiptRowInput {
  count: number;
  priceNis: number;
  category?: UnitCategory;
  isCompensationUnit?: boolean;
  isExistingStructure?: boolean;
}

function unitCategoryOrDefault(category: UnitCategory | undefined): UnitCategory {
  return category ?? "residential";
}

function validateCountAndPrice(count: number, priceNis: number): void {
  if (!Number.isFinite(count) || !Number.isInteger(count) || count < 0) {
    throw new Error(`count חייב להיות מספר שלם לא-שלילי וסופי (התקבל ${count})`);
  }
  if (!Number.isFinite(priceNis) || priceNis < 0) {
    throw new Error(`priceNis חייב להיות מספר סופי לא-שלילי (התקבל ${priceNis})`);
  }
}

/**
 * מוצאת את חודש הפרויקט (לא חודש בנייה יחסי!) שבו עקומת הבנייה מגיעה לאחוז ההתקדמות הנדרש.
 *
 * קונבנציית האינדקסים (תוקן, ר' סבב ביקורת 3b): resolveConstructionCurve מחזירה מערך יחסי לתקופת
 * הבנייה בלבד - אינדקס 0 הוא **חודש הבנייה הראשון**, לא חודש הפרויקט הראשון. ציר הפרויקט המלא כולל
 * גם את תקופת ההיתר לפניו. לכן: projectMonth = constructionStartMonth + relativeConstructionIndex.
 * דוגמה: 8 חודשי היתר, 24 חודשי בנייה, 50% התקדמות מושגת באינדקס יחסי 11 (0-based) -> חודש הפרויקט
 * הוא 8+11=19, לא 11.
 *
 * **אין fallback שקט** (תוקן, ר' סבב ביקורת 3b): אם העקומה לא תקינה (לא מסתיימת ב-100%, יורדת וכו')
 * או שאף חודש לא מגיע לאחוז המבוקש, נזרקת שגיאה מפורשת - לא מוזז אוטומטית לחודש האחרון. עקומה לא
 * תקינה היא סימן לבאג בקלט, לא מקרה שיש "לתקן בשקט" על ידי הזזת התשלום.
 */
function resolveConstructionProgressProjectMonth(
  constructionCurve: number[],
  cumulativeProgress: number,
  constructionStartMonth: number,
  handoverMonth: number
): number {
  const curveValidation = validateCumulativePercentByMonth(constructionCurve);
  if (!curveValidation.valid) {
    throw new Error(`constructionCurve לא תקינה: ${curveValidation.errors.join("; ")}`);
  }
  if (!Number.isInteger(constructionStartMonth) || constructionStartMonth < 0) {
    throw new Error(`constructionStartMonth חייב להיות מספר שלם לא-שלילי (התקבל ${constructionStartMonth})`);
  }

  const relativeIndex = constructionCurve.findIndex((v) => v >= cumulativeProgress);
  if (relativeIndex === -1) {
    throw new Error(
      `עקומת הבנייה לא מגיעה לאחוז ההתקדמות המבוקש (${cumulativeProgress}) - הערך המצטבר האחרון הוא ${constructionCurve[constructionCurve.length - 1]}`
    );
  }

  const projectMonth = constructionStartMonth + relativeIndex;
  if (projectMonth > handoverMonth) {
    throw new Error(`חודש הבנייה המחושב (${projectMonth}) אחרי חודש המסירה (${handoverMonth})`);
  }
  return projectMonth;
}

/**
 * מחשבת לוח תקבולים חודשי ל-batch מכירה **בודד** (כמות+מחיר יחיד, חודש מכירה יחיד). זו פונקציית
 * העזר ברמת ה-batch - שכבת התוצאה הציבורית לפרויקט היא computeUnitRowMonthlyReceipts, שמצרפת
 * batches מרובים לאותה שורת תמהיל. לא בודקת תמורה/מבנה קיים/מב"צ - זו אחריות רמת השורה.
 *
 * @param constructionStartMonth נדרש (ותקין) רק כשיש מנת constructionProgress בתוך tranches.
 */
export function computeSalesBatchMonthlyReceipts(
  batch: { unitsCount: number; priceNis: number },
  tranches: PaymentTranche[],
  saleMonth: number,
  handoverMonth: number,
  scheduleModel: SaleScheduleModel,
  constructionCurve?: number[],
  constructionStartMonth?: number
): MonthlyReceipt[] {
  validateCountAndPrice(batch.unitsCount, batch.priceNis);

  const scheduleValidation = validatePaymentSchedule(tranches, saleMonth, handoverMonth, scheduleModel);
  if (!scheduleValidation.valid) {
    throw new Error(`לוח תקבולים לא תקין: ${scheduleValidation.errors.join("; ")}`);
  }

  const needsCurve = tranches.some((t) => t.timing.kind === "constructionProgress");
  if (needsCurve && (!constructionCurve || constructionCurve.length === 0)) {
    throw new Error('מנה מסוג "constructionProgress" דורשת constructionCurve לא ריקה');
  }
  if (needsCurve && (constructionStartMonth === undefined || !Number.isFinite(constructionStartMonth))) {
    throw new Error('מנה מסוג "constructionProgress" דורשת constructionStartMonth');
  }

  const totalAmountNis = batch.unitsCount * batch.priceNis;
  const byMonth = new Map<number, number>();
  const addAmount = (monthIndex: number, amountNis: number) => {
    byMonth.set(monthIndex, (byMonth.get(monthIndex) ?? 0) + amountNis);
  };

  for (const tranche of tranches) {
    const trancheAmountNis = tranche.fraction * totalAmountNis;
    const { timing } = tranche;

    switch (timing.kind) {
      case "relativeToSale":
        addAmount(saleMonth + timing.monthsAfterSale, trancheAmountNis);
        break;
      case "projectMonth":
        addAmount(timing.monthIndex, trancheAmountNis);
        break;
      case "handover":
        addAmount(handoverMonth, trancheAmountNis);
        break;
      case "evenSpread": {
        const fromMonth = saleMonth + timing.fromMonthsAfterSale;
        const toMonth = saleMonth + timing.toMonthsAfterSale;
        // כולל שני הקצוות; from===to -> חודש יחיד, monthCount=1, חלוקה דטרמיניסטית טריוויאלית
        const monthCount = toMonth - fromMonth + 1;
        const perMonthAmount = trancheAmountNis / monthCount;
        for (let m = fromMonth; m <= toMonth; m++) {
          addAmount(m, perMonthAmount);
        }
        break;
      }
      case "constructionProgress": {
        const projectMonth = resolveConstructionProgressProjectMonth(
          constructionCurve!,
          timing.cumulativeProgress,
          constructionStartMonth!,
          handoverMonth
        );
        addAmount(projectMonth, trancheAmountNis);
        break;
      }
    }
  }

  // התאמת אגורות/שקלים: סכום הביניים (float, בעיקר מחלוקות evenSpread לא-עגולות) עשוי לסטות
  // במעט מ-totalAmountNis. ההפרש מתווסף לחודש האחרון שיש בו תקבול בפועל, לא נאבד בשקט. הסכימה
  // חייבת לרוץ באותו סדר בדיוק כמו הפלט המוחזר (sortedMonths) - חיבור צף תלוי-סדר, לא רק ב-Map.
  const sortedMonths = Array.from(byMonth.keys()).sort((a, b) => a - b);
  const computedTotal = sortedMonths.reduce((sum, m) => sum + byMonth.get(m)!, 0);
  const residual = totalAmountNis - computedTotal;
  if (sortedMonths.length > 0 && residual !== 0) {
    const lastMonth = sortedMonths[sortedMonths.length - 1];
    byMonth.set(lastMonth, byMonth.get(lastMonth)! + residual);
  }

  const receipts = sortedMonths.map((monthIndex) => ({ monthIndex, amountNis: byMonth.get(monthIndex)! }));

  for (const r of receipts) {
    if (!Number.isFinite(r.amountNis) || r.amountNis < 0) {
      throw new Error(`amountNis לא תקין בחודש ${r.monthIndex}: ${r.amountNis}`);
    }
    if (!Number.isInteger(r.monthIndex) || r.monthIndex < 0 || r.monthIndex > handoverMonth) {
      throw new Error(`monthIndex לא תקין: ${r.monthIndex} (תחום מותר: [0, ${handoverMonth}])`);
    }
  }

  return receipts;
}

function validateSalesBatches(
  batches: UnitSalesBatch[],
  expectedTotalCount: number,
  marketingStartMonth: number,
  handoverMonth: number
): void {
  if (!Number.isInteger(marketingStartMonth) || !Number.isInteger(handoverMonth)) {
    throw new Error(`marketingStartMonth/handoverMonth חייבים להיות מספרים שלמים (${marketingStartMonth}, ${handoverMonth})`);
  }

  let sum = 0;
  for (const [i, batch] of batches.entries()) {
    if (!Number.isFinite(batch.unitsCount) || !Number.isInteger(batch.unitsCount) || batch.unitsCount < 0) {
      throw new Error(`batch ${i}: unitsCount חייב להיות מספר שלם לא-שלילי (התקבל ${batch.unitsCount})`);
    }
    if (!Number.isFinite(batch.saleMonth) || !Number.isInteger(batch.saleMonth)) {
      throw new Error(`batch ${i}: saleMonth חייב להיות מספר שלם סופי (התקבל ${batch.saleMonth})`);
    }
    if (batch.saleMonth < marketingStartMonth || batch.saleMonth > handoverMonth) {
      throw new Error(`batch ${i}: saleMonth (${batch.saleMonth}) מחוץ לטווח [${marketingStartMonth}, ${handoverMonth}]`);
    }
    sum += batch.unitsCount;
  }

  if (sum !== expectedTotalCount) {
    throw new Error(`סכום unitsCount בכל ה-batches (${sum}) שונה מ-UnitType.count (${expectedTotalCount})`);
  }
}

/**
 * שכבת התוצאה הציבורית לפרויקט: מצרפת את כל ה-batches של שורת תמהיל אחת ללוח תקבולים חודשי אחד.
 *
 * **בסיס המע"מ, כפי שנבדק מול הכלל הקיים ב-engine.ts**: הסכום המתקבל בכל חודש הוא unitsCount*priceNis,
 * בדיוק כמו revenue.totalRevenueInclVatNis הקיים (`const inclVat = u.count * u.priceNis`, ללא הבחנה
 * קטגורית באותה נקודה). **לא ממיר בין מגורים למסחר/משרדים** - מגורים: priceNis מוזן כולל מע"מ
 * (מוסכמה קיימת), מסחר/משרדים: priceNis מוזן נטו (מוסכמה קיימת אחרת) - עקבי עם שאר המנוע, לא
 * "מתקן" את המוסכמה הקיימת.
 *
 * **אף פעם לא מייצרות תקבול, ולא מקבלות batches בכלל**: יחידות תמורה (isCompensationUnit), מבנה קיים
 * מחוזק (isExistingStructure), ומב"צ (category==="publicBuilding") - מוחזר מערך ריק מיד, לפני שנוגעים
 * ב-salesBatches שהתקבלו.
 */
export function computeUnitRowMonthlyReceipts(
  unit: ReceiptRowInput,
  salesBatches: UnitSalesBatch[],
  tranches: PaymentTranche[],
  marketingStartMonth: number,
  handoverMonth: number,
  scheduleModel: SaleScheduleModel,
  constructionCurve?: number[],
  constructionStartMonth?: number
): MonthlyReceipt[] {
  if (unit.isCompensationUnit || unit.isExistingStructure || unitCategoryOrDefault(unit.category) === "publicBuilding") {
    return [];
  }

  validateCountAndPrice(unit.count, unit.priceNis);
  validateSalesBatches(salesBatches, unit.count, marketingStartMonth, handoverMonth);

  const byMonth = new Map<number, number>();
  for (const batch of salesBatches) {
    if (batch.unitsCount === 0) continue;
    const batchReceipts = computeSalesBatchMonthlyReceipts(
      { unitsCount: batch.unitsCount, priceNis: unit.priceNis },
      tranches,
      batch.saleMonth,
      handoverMonth,
      scheduleModel,
      constructionCurve,
      constructionStartMonth
    );
    for (const r of batchReceipts) {
      byMonth.set(r.monthIndex, (byMonth.get(r.monthIndex) ?? 0) + r.amountNis);
    }
  }

  // כל batch כבר מתואם בדיוק לסכום שלו (ר' computeSalesBatchMonthlyReceipts), אבל צירוף float
  // של כמה batches ב-Map אינו מובטח לתת שוויון מדויק (חיבור צף אינו אסוציאטיבי, ותלוי בסדר).
  // תיקון נוסף ברמת השורה מבטיח שהסכום הכולל שווה בדיוק ל-unit.count*unit.priceNis. **קריטי**:
  // הסכימה כאן חייבת לרוץ באותו סדר בדיוק כמו הערך המוחזר בפועל (sortedMonths), אחרת ה"תיקון"
  // עצמו עלול להתבסס על סכום שחושב בסדר אחר (למשל סדר ההכנסה ל-Map) ולא לכסות את הפער האמיתי.
  const rowTotalAmountNis = unit.count * unit.priceNis;
  const sortedMonths = Array.from(byMonth.keys()).sort((a, b) => a - b);
  if (sortedMonths.length > 0) {
    const computedTotal = sortedMonths.reduce((s, m) => s + byMonth.get(m)!, 0);
    const residual = rowTotalAmountNis - computedTotal;
    if (residual !== 0) {
      const lastMonth = sortedMonths[sortedMonths.length - 1];
      byMonth.set(lastMonth, byMonth.get(lastMonth)! + residual);
    }
  }

  return sortedMonths.map((monthIndex) => ({ monthIndex, amountNis: byMonth.get(monthIndex)! }));
}
