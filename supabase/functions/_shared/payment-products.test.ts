import { describe, expect, it } from "vitest";
import { MAX_PRODUCT_NAME_LENGTH, PRODUCTS, getProduct, isProductType } from "./payment-products";

describe("isProductType", () => {
  it("מוצר חוקי: baseReport/cashFlowAnalysis/trackingReports מזוהים", () => {
    expect(isProductType("baseReport")).toBe(true);
    expect(isProductType("cashFlowAnalysis")).toBe(true);
    expect(isProductType("trackingReports")).toBe(true);
  });

  it("מוצר לא חוקי: כל ערך אחר נדחה, כולל ערך רביעי מומצא", () => {
    expect(isProductType("basicReport")).toBe(false);
    expect(isProductType("unitRanking")).toBe(false);
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
    expect(getProduct("trackingReports")).toEqual({
      amountAgorot: 98_000,
      currencyCode: 1,
      productName: "דוחות מעקב בנייה",
    });
  });

  it("productName בתוך המגבלה של Cardcom (MAX_PRODUCT_NAME_LENGTH) לשלושת המוצרים", () => {
    for (const product of Object.values(PRODUCTS)) {
      expect(product.productName.length).toBeLessThanOrEqual(MAX_PRODUCT_NAME_LENGTH);
      expect(product.productName.length).toBeGreaterThan(0);
    }
  });

  it("PRODUCTS קפוא (Object.freeze) - שינוי בזמן ריצה נכשל בשקט (strict mode) או נזרק", () => {
    expect(Object.isFrozen(PRODUCTS)).toBe(true);
    expect(Object.isFrozen(PRODUCTS.baseReport)).toBe(true);
    expect(Object.isFrozen(PRODUCTS.cashFlowAnalysis)).toBe(true);
    expect(Object.isFrozen(PRODUCTS.trackingReports)).toBe(true);
  });

  it("currencyCode תמיד 1 (ש\"ח) לשלושת המוצרים", () => {
    expect(PRODUCTS.baseReport.currencyCode).toBe(1);
    expect(PRODUCTS.cashFlowAnalysis.currencyCode).toBe(1);
    expect(PRODUCTS.trackingReports.currencyCode).toBe(1);
  });

  it("amountAgorot הוא מספר שלם חיובי לשלושת המוצרים - לא float, לא NaN - כולם 98,000 בדיוק", () => {
    for (const product of Object.values(PRODUCTS)) {
      expect(Number.isFinite(product.amountAgorot)).toBe(true);
      expect(Number.isInteger(product.amountAgorot)).toBe(true);
      expect(product.amountAgorot).toBeGreaterThan(0);
      expect(product.amountAgorot).toBe(98_000);
    }
  });

  it("trackingReports הוא productType עצמאי - amountAgorot/productName שונים במופע מ-baseReport/cashFlowAnalysis, אך המחיר שווה מספרית בכוונה", () => {
    expect(PRODUCTS.trackingReports).not.toBe(PRODUCTS.baseReport);
    expect(PRODUCTS.trackingReports).not.toBe(PRODUCTS.cashFlowAnalysis);
    expect(PRODUCTS.trackingReports.productName).not.toBe(PRODUCTS.baseReport.productName);
    expect(PRODUCTS.trackingReports.productName).not.toBe(PRODUCTS.cashFlowAnalysis.productName);
  });
});

describe("PRODUCT_TYPES - בדיוק שלושה סוגי מוצר, כל השלושה עוברים ולידציה", () => {
  it("Object.keys(PRODUCTS) מכיל בדיוק baseReport/cashFlowAnalysis/trackingReports, בלי כפילויות", () => {
    const keys = Object.keys(PRODUCTS);
    expect(keys.length).toBe(3);
    expect(new Set(keys).size).toBe(3);
    expect(keys.sort()).toEqual(["baseReport", "cashFlowAnalysis", "trackingReports"].sort());
  });
});
