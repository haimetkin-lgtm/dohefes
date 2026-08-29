// מקור אמת יחיד למחיר ומטבע - קיים אך ורק בצד שרת (Deno Edge Function). הלקוח שולח reportId +
// productType בלבד - לעולם לא amount/currency/productName. ר' GEN2_PAYMENT_ENTITLEMENT_DESIGN.md §4.1.
//
// קובץ TypeScript "טהור" - בלי שום ייבוא ספציפי ל-Deno (לא Deno.env, לא npm:/https: specifiers) -
// כדי שאותו קובץ יהיה ניתן לייבוא גם מ-Edge Function (Deno) וגם מבדיקות Vitest (Node), בלי לשכפל
// את ה-registry בשני מקומות. ר' payment-products.test.ts.

export type ProductType = "baseReport" | "cashFlowAnalysis" | "trackingReports";

/** Cardcom LowProfile API 10 (ProductName) מגביל את השדה הזה - ר' cardcom-client.ts */
export const MAX_PRODUCT_NAME_LENGTH = 50;

export interface ProductDefinition {
  /** אגורות כמספר שלם - תואם expected_amount_agorot ב-supabase/migrations/20260828062934_dohefes_payment_infrastructure.sql, לא numeric/float */
  readonly amountAgorot: number;
  /** 1 = ש"ח, לפי ממשק Cardcom המתוכנן - ר' migrations/20260828062934_dohefes_payment_infrastructure.sql להערה המלאה על currency_code */
  readonly currencyCode: number;
  /** נשלח ל-Cardcom כ-ProductName - עד MAX_PRODUCT_NAME_LENGTH תווים, נקבע כאן בלבד, לעולם לא מהלקוח */
  readonly productName: string;
}

/**
 * שלושת המוצרים היחידים הקיימים כרגע. 980 ₪ לכולם - זהה מספרית, אך entitlement נפרד לגמרי לכל
 * אחד (GEN2_CASHFLOW_UI_DESIGN.md §0.1, PRODUCT_CATALOG_AUDIT.md) - אין שום קשר בין שלושת
 * הערכים כאן מעבר לכך שהם שווים היום. trackingReports נוסף ב-product-catalog-implementation,
 * Commit 2 - ר' migrations/20260829070351_dohefes_payment_tracking_reports_product_type.sql
 * להרחבת ה-check constraint התואם בשתי טבלאות התשלום.
 */
export const PRODUCTS: Readonly<Record<ProductType, ProductDefinition>> = Object.freeze({
  baseReport: Object.freeze({ amountAgorot: 98_000, currencyCode: 1, productName: "דוח אפס - בדיקת כדאיות כלכלית" }),
  cashFlowAnalysis: Object.freeze({ amountAgorot: 98_000, currencyCode: 1, productName: "ניתוח תזרים ומימון מתקדם" }),
  trackingReports: Object.freeze({ amountAgorot: 98_000, currencyCode: 1, productName: "דוחות מעקב בנייה" }),
});

const PRODUCT_TYPES: readonly ProductType[] = Object.freeze(["baseReport", "cashFlowAnalysis", "trackingReports"]);

export function isProductType(value: unknown): value is ProductType {
  return typeof value === "string" && (PRODUCT_TYPES as readonly string[]).includes(value);
}

export function getProduct(productType: ProductType): ProductDefinition {
  return PRODUCTS[productType];
}
