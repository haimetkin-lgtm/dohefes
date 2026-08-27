import { describe, expect, it } from "vitest";
import { getField, parseNameToValue } from "./name-to-value";

describe("parseNameToValue / getField", () => {
  it("פענוח בסיסי, שמירה על הערכים המקוריים", () => {
    const map = parseNameToValue("Operation=1&LowProfileCode=lpc-1&ExtShvaParams.Sum36=98000");
    expect(getField(map, "Operation")).toBe("1");
    expect(getField(map, "LowProfileCode")).toBe("lpc-1");
    expect(getField(map, "ExtShvaParams.Sum36")).toBe("98000");
  });

  it("lookup לא תלוי רישיות - כל הצירופים מוצאים את אותו ערך", () => {
    const map = parseNameToValue("OperationResponse=0");
    expect(getField(map, "operationresponse")).toBe("0");
    expect(getField(map, "OPERATIONRESPONSE")).toBe("0");
    expect(getField(map, "OperationResponse")).toBe("0");
    expect(getField(map, "oPeRaTiOnReSpOnSe")).toBe("0");
  });

  it("שם שדה שונה לגמרי לא מתקרב בטעות לערך - fuzzy match לא קיים", () => {
    const map = parseNameToValue("Operation=1&OperationResponse=0");
    expect(getField(map, "Oper")).toBeUndefined();
    expect(getField(map, "OperationX")).toBeUndefined();
    expect(getField(map, "Response")).toBeUndefined();
  });

  it("שדה חסר מחזיר undefined, לא זורק ולא מחזיר מחרוזת ריקה", () => {
    const map = parseNameToValue("Operation=1");
    expect(getField(map, "DealResponse")).toBeUndefined();
  });

  it("מחרוזת ריקה מפוענחת למפה ריקה", () => {
    const map = parseNameToValue("");
    expect(getField(map, "Operation")).toBeUndefined();
  });
});
