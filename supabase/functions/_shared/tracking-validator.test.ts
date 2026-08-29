import { describe, expect, it } from "vitest";
import { MAX_TRACKING_ITEMS, validateTrackingPayload } from "./tracking-validator";

const VALID_ITEM = { id: "i1", phase: "ביסוס", description: "כלונסאות", quantity: 10, unitPriceNis: 5000, actualNis: 3000 };

describe("validateTrackingPayload - מבנה בסיסי", () => {
  it("8. מערך ריק - payload חוקי לגמרי, לא נדחה", () => {
    const result = validateTrackingPayload([]);
    expect(result).toEqual({ ok: true, items: [] });
  });

  it("מערך עם פריט תקין אחד - מתקבל כמות שהוא", () => {
    const result = validateTrackingPayload([VALID_ITEM]);
    expect(result).toEqual({ ok: true, items: [VALID_ITEM] });
  });

  it("13. לא-מערך (אובייקט/מחרוזת/מספר/null) - נדחה עם not_array", () => {
    for (const bad of [{}, "x", 5, null, undefined, true]) {
      expect(validateTrackingPayload(bad)).toEqual({ ok: false, error: "not_array" });
    }
  });
});

describe("validateTrackingPayload - מפתחות סגורים (13. שדות לא צפויים)", () => {
  it("פריט עם שדה עודף נדחה", () => {
    const result = validateTrackingPayload([{ ...VALID_ITEM, extra: "not allowed" }]);
    expect(result).toEqual({ ok: false, error: "invalid_item" });
  });

  it("פריט עם שדה חסר נדחה", () => {
    const { phase, ...withoutPhase } = VALID_ITEM;
    void phase;
    expect(validateTrackingPayload([withoutPhase])).toEqual({ ok: false, error: "invalid_item" });
  });

  it("פריט שהוא מערך (לא אובייקט) נדחה", () => {
    expect(validateTrackingPayload([[1, 2, 3]])).toEqual({ ok: false, error: "invalid_item" });
  });

  it("פריט null/לא-אובייקט בתוך המערך נדחה", () => {
    expect(validateTrackingPayload([null])).toEqual({ ok: false, error: "invalid_item" });
    expect(validateTrackingPayload(["x"])).toEqual({ ok: false, error: "invalid_item" });
  });
});

describe("validateTrackingPayload - טיפוסי שדה", () => {
  it("id שאינו string, או מחרוזת ריקה - נדחה", () => {
    expect(validateTrackingPayload([{ ...VALID_ITEM, id: 123 }])).toEqual({ ok: false, error: "invalid_item" });
    expect(validateTrackingPayload([{ ...VALID_ITEM, id: "" }])).toEqual({ ok: false, error: "invalid_item" });
  });

  it("phase/description שאינם string נדחים - אך מחרוזת ריקה מותרת (תואם ל-emptyItem() בקוד ה-UI)", () => {
    expect(validateTrackingPayload([{ ...VALID_ITEM, phase: 5 }])).toEqual({ ok: false, error: "invalid_item" });
    expect(validateTrackingPayload([{ ...VALID_ITEM, description: null }])).toEqual({ ok: false, error: "invalid_item" });
    expect(validateTrackingPayload([{ ...VALID_ITEM, phase: "", description: "" }]).ok).toBe(true);
  });
});

describe("14. NaN/Infinity - אין ערכים מספריים לא סופיים", () => {
  it.each(["quantity", "unitPriceNis", "actualNis"] as const)("%s=NaN נדחה", (field) => {
    expect(validateTrackingPayload([{ ...VALID_ITEM, [field]: NaN }])).toEqual({ ok: false, error: "invalid_item" });
  });

  it.each(["quantity", "unitPriceNis", "actualNis"] as const)("%s=Infinity נדחה", (field) => {
    expect(validateTrackingPayload([{ ...VALID_ITEM, [field]: Infinity }])).toEqual({ ok: false, error: "invalid_item" });
  });

  it.each(["quantity", "unitPriceNis", "actualNis"] as const)("%s=-Infinity נדחה", (field) => {
    expect(validateTrackingPayload([{ ...VALID_ITEM, [field]: -Infinity }])).toEqual({ ok: false, error: "invalid_item" });
  });

  it.each(["quantity", "unitPriceNis", "actualNis"] as const)("%s שאינו number (מחרוזת) נדחה", (field) => {
    expect(validateTrackingPayload([{ ...VALID_ITEM, [field]: "5" }])).toEqual({ ok: false, error: "invalid_item" });
  });

  it("0 ומספרים שליליים סופיים מתקבלים - אין דרישה עסקית חדשה (רק בטיחות טכנית)", () => {
    expect(validateTrackingPayload([{ ...VALID_ITEM, quantity: 0, actualNis: -500 }]).ok).toBe(true);
  });
});

describe("12. payload גדול מדי (מספר פריטים)", () => {
  it(`מעל ${MAX_TRACKING_ITEMS} פריטים נדחה`, () => {
    const items = Array.from({ length: MAX_TRACKING_ITEMS + 1 }, (_, i) => ({ ...VALID_ITEM, id: `i${i}` }));
    expect(validateTrackingPayload(items)).toEqual({ ok: false, error: "too_many_items" });
  });

  it(`בדיוק ${MAX_TRACKING_ITEMS} פריטים מתקבל`, () => {
    const items = Array.from({ length: MAX_TRACKING_ITEMS }, (_, i) => ({ ...VALID_ITEM, id: `i${i}` }));
    expect(validateTrackingPayload(items).ok).toBe(true);
  });
});

describe("אין מוטציה של הקלט", () => {
  it("המערך/הפריטים המקוריים לא משתנים אחרי הקריאה", () => {
    const original = [{ ...VALID_ITEM }];
    const snapshot = JSON.stringify(original);
    validateTrackingPayload(original);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("items המוחזר הוא אותו reference (view), לא עותק שעבר עיבוד/מיון", () => {
    const original = [{ ...VALID_ITEM, id: "b" }, { ...VALID_ITEM, id: "a" }];
    const result = validateTrackingPayload(original);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items).toBe(original);
      expect(result.items.map((i) => i.id)).toEqual(["b", "a"]); // סדר לא שונה
    }
  });
});
