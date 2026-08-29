// מקור אמת מרכזי לקטלוג המוצרים - שם תצוגה, מחיר, תכולה, זכאות ופעולות מותרות לכל מוצר.
// כל מסך/רכיב שמתאר מוצר/מחיר/תכולה אמור בעתיד לקרוא מכאן, לא לכתוב טקסט/מספר בעצמו
// (ר' PRODUCT_CATALOG_AUDIT.md §5).
//
// שלב 1 בלבד מתוך תוכנית התיקון (PRODUCT_CATALOG_AUDIT.md §7): הקובץ נוצר, לא נקרא עדיין
// משום מקום. שום מסך/Supabase/Edge Function/הרשאה לא שונה בשלב הזה.
//
// כיוון הייבוא - חד-כיווני, כדי לא ליצור תלות מעגלית: הקובץ הזה (שכבת lib/, עדיין לא בשימוש)
// תלוי ב-supabase/functions/_shared/payment-products.ts (שכבה טהורה בלי שום ייבוא משלה - ר'
// ההערה בראש אותו קובץ, שנכתב בכוונה כך כדי לשמש גם Deno וגם Vitest/Node) - לא להפך.
// payment-products.ts אף פעם לא יכול לייבא מכאן.
//
// מחיר שלושת המוצרים מיובא משם, לא משוכפל כערך נפרד - כדי שלא ייווצרו שני "מקורות אמת" מתחרים
// לאותו מספר (980 ₪ = 98,000 אגורות). trackingReports נוסף ל-payment-products.ts ב-Commit 2
// (product-catalog-implementation) - אין יותר ערך מקומי זמני, שלושת המוצרים מיובאים באותו אופן.

import { PRODUCTS as PAYMENT_PRODUCTS } from "../supabase/functions/_shared/payment-products";
import type { DealType } from "./calc/types";

/** שלושת המוצרים בתשלום. לא כולל unitRanking - זה feature כלול, לא מוצר, ר' למטה. */
export type ProductId = "baseReport" | "cashFlowAnalysis" | "trackingReports";

/**
 * תת-קבוצה של ProductId שעוברת דרך מנגנון התשלום המאובטח (dohefes-create-payment-order/
 * dohefes-cardcom-payment-indicator/dohefes-get-product-access). כרגע זהה ל-ProductId
 * במלואו, אך נשאר טיפוס נפרד: custom/consultation (מוצרים נוספים באתר, לא חלק מהקטלוג הזה
 * עדיין - ר' PRODUCT_CATALOG_AUDIT.md §5) ממשיכים במודל הישן/עצמאי, ולא יקבלו לעולם
 * paymentProductType מהטיפוס הזה.
 */
export type SecurePaymentProductType = ProductId;

/** כל הפעולות האפשריות על פני כל המוצרים/features בקטלוג - כל ערך משתמש בתת-קבוצה הרלוונטית לו בלבד. */
export type AllowedAction = "view" | "excel" | "print" | "tracking" | "ranking";

export interface CatalogEntry {
  readonly id: ProductId;
  readonly displayName: string;
  /** אגורות - לא ש"ח, תואם expected_amount_agorot בשרת (ר' payment-products.ts). */
  readonly priceAgorot: number;
  readonly description: string;
  readonly includedFeatures: readonly string[];
  readonly requiresReportId: boolean;
  readonly relevantDealTypes: readonly DealType[] | "all";
  readonly allowedActions: readonly AllowedAction[];
  readonly paymentProductType: SecurePaymentProductType;
}

export const CATALOG: Readonly<Record<ProductId, CatalogEntry>> = Object.freeze({
  baseReport: Object.freeze({
    id: "baseReport",
    displayName: "דוח אפס",
    priceAgorot: PAYMENT_PRODUCTS.baseReport.amountAgorot,
    description: 'בדיקת כדאיות כלכלית והיתכנות לפרויקט נדל"ן',
    includedFeatures: Object.freeze(["דוח מלא לאחר רכישה", "צפייה בתוצאות", "ייצוא Excel", "הדפסה/PDF"]),
    requiresReportId: true,
    relevantDealTypes: "all",
    allowedActions: Object.freeze<AllowedAction[]>(["view", "excel", "print"]),
    paymentProductType: "baseReport",
  }),
  cashFlowAnalysis: Object.freeze({
    id: "cashFlowAnalysis",
    displayName: "ניתוח תזרים ומימון מתקדם",
    priceAgorot: PAYMENT_PRODUCTS.cashFlowAnalysis.amountAgorot,
    description: "תזרים מזומנים חודשי מלא לפרויקט, נפרד מדוח הבסיס",
    includedFeatures: Object.freeze(["תזרים חודשי מלא", "בדיקת מסגרת אשראי ומימון", "ייצוא Excel", "הדפסה/PDF"]),
    requiresReportId: true,
    relevantDealTypes: "all",
    allowedActions: Object.freeze<AllowedAction[]>(["view", "excel", "print"]),
    paymentProductType: "cashFlowAnalysis",
  }),
  trackingReports: Object.freeze({
    id: "trackingReports",
    displayName: "דוחות מעקב בנייה",
    priceAgorot: PAYMENT_PRODUCTS.trackingReports.amountAgorot,
    description: "מוצר המשך אופציונלי: מעקב תקציב מול ביצוע בפועל, לאורך חודשי הבנייה",
    includedFeatures: Object.freeze(["טבלת תקציב מול ביצוע לפי שלב", "ייצוא Excel", "הדפסה/PDF"]),
    requiresReportId: true,
    relevantDealTypes: "all",
    allowedActions: Object.freeze<AllowedAction[]>(["view", "excel", "print", "tracking"]),
    paymentProductType: "trackingReports",
  }),
});

const PRODUCT_IDS: readonly ProductId[] = Object.freeze(["baseReport", "cashFlowAnalysis", "trackingReports"]);

export function isProductId(value: unknown): value is ProductId {
  return typeof value === "string" && (PRODUCT_IDS as readonly string[]).includes(value);
}

export function getCatalogEntry(id: ProductId): CatalogEntry {
  return CATALOG[id];
}

/**
 * מחיר בש"ח לתצוגה - "980 ₪". פונקציה טהורה (בלי window/Intl גלובלי מעבר ל-toLocaleString
 * הרגיל, אותה מוסכמה שהייתה כתובה בנפרד בכל עמוד - `X.toLocaleString("he-IL")} ₪`) - כדי
 * שמסכים יקראו ממנה במקום לכתוב את נוסחת ההמרה (agorot/100) בעצמם, בכל עמוד בנפרד
 * (product-catalog-implementation, Commit 3: "מקור אמת" §"אם נדרש formatter"). כל מחירי
 * הקטלוג היום הם סכומים שלמים בש"ח (980/1,800/1,180) - Math.round כאן הוא הגנת-עומק בלבד,
 * לא צפוי לשנות ערך בפועל.
 */
export function formatPriceNis(priceAgorot: number): string {
  return `${Math.round(priceAgorot / 100).toLocaleString("he-IL")} ₪`;
}

// --- unitRanking: feature כלול, לא מוצר בתשלום ---
// ר' PRODUCT_CATALOG_AUDIT.md, "דירוג דירות - כלול, לא מוצר עצמאי": אין מחיר, אין
// paymentProductType, אינו productType במנגנון התשלום, ואינו חבר ב-ProductId למעלה בכוונה.
// זמין רק כחלק מ-baseReport ששולם, ורק בעסקת pinuyBinui - לכן טיפוס נפרד (CatalogFeature),
// לא CatalogEntry (ר' סעיף 6, שאלה 3 באודיט - זו ההכרעה לאותה שאלה).
//
// שים לב: "ranking" לא מופיע ב-allowedActions של baseReport למעלה - הזכאות לדירוג מותנית
// בסוג עסקה (pinuyBinui בלבד), ולא תכונה גורפת של כל דוח baseReport שנרכש. relevantDealTypes
// כאן הוא מקור האמת לתנאי הזה, לא allowedActions של המוצר עצמו.

export interface CatalogFeature {
  readonly id: "unitRanking";
  readonly displayName: string;
  readonly description: string;
  /** המוצר שצריך להיות נרכש (עם reportId תקף) כדי שהתכונה תהיה זמינה. */
  readonly requiresPurchasedProduct: ProductId;
  readonly relevantDealTypes: readonly DealType[];
  readonly allowedActions: readonly AllowedAction[];
}

export const UNIT_RANKING_FEATURE: CatalogFeature = Object.freeze({
  id: "unitRanking",
  displayName: "דירוג דירות",
  description: "טבלת דירוג יחידות עם אפשרות לקביעת פרמטרים - כלולה בדוח פינוי-בינוי שנרכש, ללא תשלום נוסף",
  requiresPurchasedProduct: "baseReport",
  relevantDealTypes: Object.freeze<DealType[]>(["pinuyBinui"]),
  allowedActions: Object.freeze<AllowedAction[]>(["view", "excel", "ranking"]),
});
