import { describe, expect, it } from "vitest";
import { MAX_PRODUCT_NAME_LENGTH, PRODUCTS, getProduct, isProductType } from "./payment-products";

describe("isProductType", () => {
  it("מוצר חוקי: baseReport/cashFlowAnalysis מזוהים", () => {
    expect(isProductType("baseReport")).toBe(true);
    expect(isProductType("cashFlowAnalysis")).toBe(true);
  });

  it("מוצר לא חוקי: כל ערך אחר נדחה", () => {
    expect(isProductType("basicReport")).toBe(false);
    expect(isProductType("")).toBe(false);
    expect(isProductType(null)).toBe(false);
    expect(isProductType(undefined)).toBe(false);
    expect(isProductType(123)).toBe(false);
    expect(isProductType({ productType: "baseReport" })).toBe(false);
  });
});

describe("getProduct - מקור אמת יחיד למחיר, לא מגיע מהלקוח", () => {
  it("getProduct לא מקבלת שום פרמטר סכום/מטבע - מבנית לא ניתן להשפיע על המחיר מבחוץ", () => {
    // הבדיקה עצמה היא על החתימה: getProduct(productType) בלבד, בלי amount/currency אפשריים בקריאה.
    expect(getProduct("baseReport")).toEqual({
      amountAgorot: 98_000,
      currencyCode: 1,
      productName: "דוח אפס - בדיקת כדאיות כלכלית",
    });
    expect(getProduct("cashFlowAnalysis")).toEqual({
      amountAgorot: 98_000,
      currencyCode: 1,
      productName: "ניתוח תזרים ומימון מתקדם",
    });
  });

  it("productName בתוך המגבלה של Cardcom (MAX_PRODUCT_NAME_LENGTH) לשני המוצרים", () => {
    for (const product of Object.values(PRODUCTS)) {
      expect(product.productName.length).toBeLessThanOrEqual(MAX_PRODUCT_NAME_LENGTH);
      expect(product.productName.length).toBeGreaterThan(0);
    }
  });

  it("PRODUCTS קפוא (Object.freeze) - שינוי בזמן ריצה נכשל בשקט (strict mode) או נזרק", () => {
    expect(Object.isFrozen(PRODUCTS)).toBe(true);
    expect(Object.isFrozen(PRODUCTS.baseReport)).toBe(true);
    expect(Object.isFrozen(PRODUCTS.cashFlowAnalysis)).toBe(true);
  });

  it("currencyCode תמיד 1 (ש\"ח) לשני המוצרים", () => {
    expect(PRODUCTS.baseReport.currencyCode).toBe(1);
    expect(PRODUCTS.cashFlowAnalysis.currencyCode).toBe(1);
  });

  it("amountAgorot הוא מספר שלם חיובי לשני המוצרים - לא float", () => {
    for (const product of Object.values(PRODUCTS)) {
      expect(Number.isInteger(product.amountAgorot)).toBe(true);
      expect(product.amountAgorot).toBeGreaterThan(0);
    }
  });
});
