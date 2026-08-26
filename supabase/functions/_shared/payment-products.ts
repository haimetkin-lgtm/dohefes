// מקור אמת יחיד למחיר ומטבע - קיים אך ורק בצד שרת (Deno Edge Function). הלקוח שולח reportId +
// productType בלבד - לעולם לא amount/currency/productName. ר' GEN2_PAYMENT_ENTITLEMENT_DESIGN.md §4.1.
//
// קובץ TypeScript "טהור" - בלי שום ייבוא ספציפי ל-Deno (לא Deno.env, לא npm:/https: specifiers) -
// כדי שאותו קובץ יהיה ניתן לייבוא גם מ-Edge Function (Deno) וגם מבדיקות Vitest (Node), בלי לשכפל
// את ה-registry בשני מקומות. ר' payment-products.test.ts.

export type ProductType = "baseReport" | "cashFlowAnalysis";

export interface ProductDefinition {
  /** אגורות כמספר שלם - תואם expected_amount_agorot ב-supabase/payment-schema.sql, לא numeric/float */
  readonly amountAgorot: number;
  /** 1 = ש"ח, לפי ממשק Cardcom המתוכנן - ר' payment-schema.sql להערה המלאה על currency_code */
  readonly currencyCode: number;
}

/**
 * שני המוצרים היחידים הקיימים כרגע. 980 ₪ לשניהם - זהה מספרית, אך entitlement נפרד לגמרי
 * (GEN2_CASHFLOW_UI_DESIGN.md §0.1) - אין שום קשר בין שני הערכים כאן מעבר לכך שהם שווים היום.
 */
export const PRODUCTS: Readonly<Record<ProductType, ProductDefinition>> = Object.freeze({
  baseReport: Object.freeze({ amountAgorot: 98_000, currencyCode: 1 }),
  cashFlowAnalysis: Object.freeze({ amountAgorot: 98_000, currencyCode: 1 }),
});

const PRODUCT_TYPES: readonly ProductType[] = Object.freeze(["baseReport", "cashFlowAnalysis"]);

export function isProductType(value: unknown): value is ProductType {
  return typeof value === "string" && (PRODUCT_TYPES as readonly string[]).includes(value);
}

export function getProduct(productType: ProductType): ProductDefinition {
  return PRODUCTS[productType];
}
