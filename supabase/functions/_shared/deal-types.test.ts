import { describe, expect, it } from "vitest";
import { DEAL_TYPES, isDealType } from "./deal-types";

describe("isDealType", () => {
  it("מקבלת את כל שבעת סוגי העסקה האמיתיים (lib/calc/types.ts::DealType)", () => {
    for (const dealType of DEAL_TYPES) {
      expect(isDealType(dealType)).toBe(true);
    }
    expect(DEAL_TYPES.length).toBe(7);
  });

  it("דוחה מחרוזת לא-קיימת", () => {
    expect(isDealType("notARealDealType")).toBe(false);
  });

  it("דוחה מחרוזת ריקה", () => {
    expect(isDealType("")).toBe(false);
  });

  it("דוחה ערכים לא-מחרוזתיים", () => {
    expect(isDealType(null)).toBe(false);
    expect(isDealType(undefined)).toBe(false);
    expect(isDealType(123)).toBe(false);
    expect(isDealType({})).toBe(false);
    expect(isDealType(["basic"])).toBe(false);
  });

  it("רגישה לאותיות רישיות - אינה מקבלת גרסה עם אות גדולה שונה", () => {
    expect(isDealType("Basic")).toBe(false);
    expect(isDealType("BASIC")).toBe(false);
  });
});
