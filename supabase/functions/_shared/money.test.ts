import { describe, expect, it } from "vitest";
import { agorotToShekelString } from "./money";

describe("agorotToShekelString", () => {
  it("98_000 אגורות -> \"980.00\" (הדוגמה המחייבת)", () => {
    expect(agorotToShekelString(98_000)).toBe("980.00");
  });

  it("תמיד שתי ספרות עשרוניות, גם כשהשארית חד-ספרתית", () => {
    expect(agorotToShekelString(100)).toBe("1.00");
    expect(agorotToShekelString(101)).toBe("1.01");
    expect(agorotToShekelString(1)).toBe("0.01");
    expect(agorotToShekelString(12_345)).toBe("123.45");
  });

  it("דוחה 0", () => {
    expect(() => agorotToShekelString(0)).toThrow();
  });

  it("דוחה מספר שלילי", () => {
    expect(() => agorotToShekelString(-98_000)).toThrow();
  });

  it("דוחה מספר לא-שלם (float)", () => {
    expect(() => agorotToShekelString(980.5)).toThrow();
  });

  it("דוחה NaN/Infinity", () => {
    expect(() => agorotToShekelString(NaN)).toThrow();
    expect(() => agorotToShekelString(Infinity)).toThrow();
  });
});
