import { describe, expect, it } from "vitest";
import { validateReportDataPayload, MAX_REPORT_DATA_BODY_BYTES, MAX_PROJECT_NAME_LENGTH } from "./report-data-validator";

function validPayload(overrides: Record<string, unknown> = {}) {
  return { projectName: "פרויקט לדוגמה", dealType: "tama38", inputs: { units: [] }, results: { profit: 100 }, ...overrides };
}

describe("payload תקין", () => {
  it("מתקבל עם כל השדות", () => {
    const result = validateReportDataPayload(validPayload());
    expect(result).toEqual({
      ok: true,
      payload: { projectName: "פרויקט לדוגמה", dealType: "tama38", inputs: { units: [] }, results: { profit: 100 } },
    });
  });

  it("projectName=null מתקבל כ-null מפורש", () => {
    const result = validateReportDataPayload(validPayload({ projectName: null }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.projectName).toBeNull();
  });

  it("results=null מתקבל כ-null מפורש (דוח בטיוטה בלי תוצאות מחושבות עדיין)", () => {
    const result = validateReportDataPayload(validPayload({ results: null }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.results).toBeNull();
  });

  it("inputs={} (draft ריק) הוא payload חוקי לגמרי", () => {
    const result = validateReportDataPayload(validPayload({ inputs: {} }));
    expect(result.ok).toBe(true);
  });
});

describe("dealType", () => {
  it("dealType לא-תקין נדחה", () => {
    expect(validateReportDataPayload(validPayload({ dealType: "notReal" }))).toEqual({ ok: false, error: "invalid_deal_type" });
  });

  it("dealType חסר נדחה", () => {
    const { projectName, inputs, results } = validPayload();
    expect(validateReportDataPayload({ projectName, inputs, results })).toEqual({ ok: false, error: "invalid_deal_type" });
  });
});

describe("inputs/results - מבנה", () => {
  it("inputs שהוא מערך נדחה", () => {
    expect(validateReportDataPayload(validPayload({ inputs: [] }))).toEqual({ ok: false, error: "invalid_inputs" });
  });

  it("inputs שהוא null נדחה (לא כמו results - inputs תמיד חובה)", () => {
    expect(validateReportDataPayload(validPayload({ inputs: null }))).toEqual({ ok: false, error: "invalid_inputs" });
  });

  it("results שהוא מערך נדחה", () => {
    expect(validateReportDataPayload(validPayload({ results: [] }))).toEqual({ ok: false, error: "invalid_results" });
  });

  it("results שהוא מחרוזת/מספר נדחה", () => {
    expect(validateReportDataPayload(validPayload({ results: "not an object" }))).toEqual({ ok: false, error: "invalid_results" });
  });

  it("value שאינו אובייקט בכלל נדחה", () => {
    expect(validateReportDataPayload(null)).toEqual({ ok: false, error: "invalid_inputs" });
    expect(validateReportDataPayload([])).toEqual({ ok: false, error: "invalid_inputs" });
    expect(validateReportDataPayload("x")).toEqual({ ok: false, error: "invalid_inputs" });
  });
});

describe("projectName", () => {
  it("projectName ארוך מדי נדחה", () => {
    const result = validateReportDataPayload(validPayload({ projectName: "א".repeat(MAX_PROJECT_NAME_LENGTH + 1) }));
    expect(result).toEqual({ ok: false, error: "invalid_project_name" });
  });

  it("projectName שאינו מחרוזת (ולא null) נדחה", () => {
    expect(validateReportDataPayload(validPayload({ projectName: 123 }))).toEqual({ ok: false, error: "invalid_project_name" });
  });
});

describe("גודל payload", () => {
  it("inputs חורג מ-MAX_REPORT_DATA_BODY_BYTES נדחה", () => {
    const bigString = "x".repeat(MAX_REPORT_DATA_BODY_BYTES + 1);
    const result = validateReportDataPayload(validPayload({ inputs: { blob: bigString } }));
    expect(result).toEqual({ ok: false, error: "too_large" });
  });

  it("results חורג מ-MAX_REPORT_DATA_BODY_BYTES נדחה", () => {
    const bigString = "x".repeat(MAX_REPORT_DATA_BODY_BYTES + 1);
    const result = validateReportDataPayload(validPayload({ results: { blob: bigString } }));
    expect(result).toEqual({ ok: false, error: "too_large" });
  });
});

describe("NaN/Infinity - הגנת-עומק (לא ניתן להגיע לזה דרך JSON.parse רגיל)", () => {
  it("NaN בעומק כלשהו בתוך inputs נדחה", () => {
    const result = validateReportDataPayload(validPayload({ inputs: { costs: { main: NaN } } }));
    expect(result).toEqual({ ok: false, error: "non_finite_number" });
  });

  it("Infinity בתוך מערך מקונן בתוך results נדחה", () => {
    const result = validateReportDataPayload(validPayload({ results: { units: [{ price: Infinity }] } }));
    expect(result).toEqual({ ok: false, error: "non_finite_number" });
  });

  it("-Infinity נדחה", () => {
    const result = validateReportDataPayload(validPayload({ inputs: { x: -Infinity } }));
    expect(result).toEqual({ ok: false, error: "non_finite_number" });
  });

  it("מספרים סופיים רגילים (כולל שליליים/עשרוניים/0) מתקבלים", () => {
    const result = validateReportDataPayload(validPayload({ inputs: { a: -5, b: 3.14, c: 0 } }));
    expect(result.ok).toBe(true);
  });
});

describe("טהרה - אינה נוגעת בקלט המקורי", () => {
  it("לא מוסיפה/מוחקת שדות מהאובייקט המקורי", () => {
    const input = validPayload();
    const before = JSON.stringify(input);
    validateReportDataPayload(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
