import { describe, expect, it } from "vitest";
import { parseCreatePaymentOrderRequestBody } from "./create-payment-order-request-parser";

const REPORT_ID = "11111111-1111-1111-1111-111111111111";

describe("baseReport - דורש dealType תקין, דוחה reportId", () => {
  it("productType='baseReport' + dealType תקין -> ok, בלי reportId בתוצאה", () => {
    const result = parseCreatePaymentOrderRequestBody({ productType: "baseReport", dealType: "tama38" });
    expect(result).toEqual({ ok: true, body: { productType: "baseReport", dealType: "tama38" } });
  });

  it("productType='baseReport' בלי dealType בכלל -> invalid_deal_type", () => {
    const result = parseCreatePaymentOrderRequestBody({ productType: "baseReport" });
    expect(result).toEqual({ ok: false, error: "invalid_deal_type" });
  });

  it("productType='baseReport' עם dealType לא-תקין -> invalid_deal_type", () => {
    const result = parseCreatePaymentOrderRequestBody({ productType: "baseReport", dealType: "notARealDealType" });
    expect(result).toEqual({ ok: false, error: "invalid_deal_type" });
  });

  it("productType='baseReport' + dealType תקין + reportId מהלקוח -> נדחה (unexpected_fields), לא מתעלם מ-reportId בשקט", () => {
    const result = parseCreatePaymentOrderRequestBody({ productType: "baseReport", dealType: "tama38", reportId: REPORT_ID });
    expect(result).toEqual({ ok: false, error: "unexpected_fields" });
  });

  it("productType='baseReport' עם amount/currency/productName -> נדחה (שדה עודף)", () => {
    const result = parseCreatePaymentOrderRequestBody({ productType: "baseReport", dealType: "tama38", amountAgorot: 1 });
    expect(result).toEqual({ ok: false, error: "unexpected_fields" });
  });
});

describe("מוצר המשך (cashFlowAnalysis/trackingReports) - דורש reportId, דוחה dealType", () => {
  it("productType='cashFlowAnalysis' + reportId תקין -> ok, בלי dealType בתוצאה", () => {
    const result = parseCreatePaymentOrderRequestBody({ productType: "cashFlowAnalysis", reportId: REPORT_ID });
    expect(result).toEqual({ ok: true, body: { productType: "cashFlowAnalysis", reportId: REPORT_ID } });
  });

  it("productType='trackingReports' + reportId תקין -> ok", () => {
    const result = parseCreatePaymentOrderRequestBody({ productType: "trackingReports", reportId: REPORT_ID });
    expect(result).toEqual({ ok: true, body: { productType: "trackingReports", reportId: REPORT_ID } });
  });

  it("מוצר המשך בלי reportId בכלל -> invalid_report_id", () => {
    const result = parseCreatePaymentOrderRequestBody({ productType: "cashFlowAnalysis" });
    expect(result).toEqual({ ok: false, error: "invalid_report_id" });
  });

  it("מוצר המשך עם reportId לא-uuid -> invalid_report_id", () => {
    const result = parseCreatePaymentOrderRequestBody({ productType: "cashFlowAnalysis", reportId: "not-a-uuid" });
    expect(result).toEqual({ ok: false, error: "invalid_report_id" });
  });

  it("מוצר המשך + reportId תקין + dealType -> נדחה (unexpected_fields), לא מתעלם מ-dealType בשקט", () => {
    const result = parseCreatePaymentOrderRequestBody({ productType: "cashFlowAnalysis", reportId: REPORT_ID, dealType: "tama38" });
    expect(result).toEqual({ ok: false, error: "unexpected_fields" });
  });
});

describe("productType כללי", () => {
  it("productType חסר -> invalid_product_type", () => {
    expect(parseCreatePaymentOrderRequestBody({ reportId: REPORT_ID })).toEqual({ ok: false, error: "invalid_product_type" });
  });

  it("productType לא-קיים -> invalid_product_type", () => {
    expect(parseCreatePaymentOrderRequestBody({ productType: "somethingElse", reportId: REPORT_ID })).toEqual({
      ok: false,
      error: "invalid_product_type",
    });
  });

  it("גוף שאינו אובייקט -> invalid_body", () => {
    expect(parseCreatePaymentOrderRequestBody(null)).toEqual({ ok: false, error: "invalid_body" });
    expect(parseCreatePaymentOrderRequestBody("string")).toEqual({ ok: false, error: "invalid_body" });
    expect(parseCreatePaymentOrderRequestBody(42)).toEqual({ ok: false, error: "invalid_body" });
  });

  it("מערך (typeof==='object' ב-JS, אך אין לו productType) -> invalid_product_type, אותו דפוס בדיוק כמו שאר ה-parsers בפרויקט (dohefes-get-tracking-data וכו') - לא ולידציית Array.isArray נפרדת", () => {
    expect(parseCreatePaymentOrderRequestBody([])).toEqual({ ok: false, error: "invalid_product_type" });
  });
});

describe("טהרה - אינה נוגעת בקלט המקורי", () => {
  it("לא מוסיפה/מוחקת שדות מהאובייקט המקורי שהועבר", () => {
    const input = { productType: "baseReport", dealType: "tama38" };
    const before = JSON.stringify(input);
    parseCreatePaymentOrderRequestBody(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
