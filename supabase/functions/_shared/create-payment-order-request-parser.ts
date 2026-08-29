// ולידציית גוף הבקשה ל-dohefes-create-payment-order - Commit 6a. חולצה לקובץ טהור ייעודי (לא
// נשארת מוטמעת ב-index.ts כמו קודם) מהסיבה הפשוטה שהחוזה עצמו הפך למשמעותי מספיק לבדוק ישירות
// ב-Vitest: **union מבחין אמיתי**, לא רק "reportId+productType בלבד" כמו קודם -
//   - baseReport: { productType: "baseReport", dealType: <אחד משבעת הערכים האמיתיים> } - **בלי**
//     reportId (הדוח עדיין לא קיים - נוצר בתוך dohefes_create_base_report_payment_order, ר.
//     migrations/20260829151144_dohefes_base_report_secure_backend.sql).
//   - כל מוצר המשך (cashFlowAnalysis/trackingReports): { productType, reportId: <uuid> } - **בלי**
//     dealType (הדוח כבר קיים, סוג העסקה שלו כבר נקבע).
// שדה עודף או שילוב סותר (dealType על מוצר המשך, reportId על baseReport) נדחים במפורש - לא
// מתעלמים משדה לא-רלוונטי בשקט.
//
// קובץ טהור, בלי שום ייבוא ספציפי ל-Deno (רק ממודולים טהורים אחרים באותה תיקייה) - ניתן
// לבדיקה ישירה מ-Vitest, ר. create-payment-order-request-parser.test.ts. index.ts של
// dohefes-create-payment-order הוא ה-adapter היחיד שקורא לפונקציה הזו בפועל מול HTTP.

import { isProductType, type ProductType } from "./payment-products.ts";
import { isUuid } from "./payment-security.ts";
import { isDealType, type DealTypeValue } from "./deal-types.ts";

export type ParsedCreatePaymentOrderBody =
  | { productType: "baseReport"; dealType: DealTypeValue }
  | { productType: Exclude<ProductType, "baseReport">; reportId: string };

export type ParseCreatePaymentOrderBodyResult = { ok: true; body: ParsedCreatePaymentOrderBody } | { ok: false; error: string };

/**
 * productType נבדק ראשון (קובע לפי איזה ענף מהאיחוד לפענח את שאר הגוף) - לפני כל בדיקת שדה
 * אחרת. שני הענפים דוחים במפורש שדה עודף כלשהו (כולל dealType/reportId ה"שייכים" לענף השני) -
 * "כל שדה עודף או שילוב סותר נדחה", לא ניחוש כוונה.
 */
export function parseCreatePaymentOrderRequestBody(raw: unknown): ParseCreatePaymentOrderBodyResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "invalid_body" };
  const record = raw as Record<string, unknown>;

  if (!isProductType(record.productType)) return { ok: false, error: "invalid_product_type" };

  if (record.productType === "baseReport") {
    const allowedKeys = new Set(["productType", "dealType"]);
    const extraKeys = Object.keys(record).filter((key) => !allowedKeys.has(key));
    if (extraKeys.length > 0) return { ok: false, error: "unexpected_fields" };
    if (!isDealType(record.dealType)) return { ok: false, error: "invalid_deal_type" };
    return { ok: true, body: { productType: "baseReport", dealType: record.dealType } };
  }

  const allowedKeys = new Set(["productType", "reportId"]);
  const extraKeys = Object.keys(record).filter((key) => !allowedKeys.has(key));
  if (extraKeys.length > 0) return { ok: false, error: "unexpected_fields" };
  if (!isUuid(record.reportId)) return { ok: false, error: "invalid_report_id" };

  return { ok: true, body: { productType: record.productType, reportId: record.reportId } };
}
