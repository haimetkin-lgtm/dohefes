import { describe, expect, it } from "vitest";
import {
  isUuid,
  generateAccessToken,
  hashAccessToken,
  generateProviderOrderReference,
  parseAllowedOrigins,
  isAllowedOrigin,
  MAX_REQUEST_BODY_BYTES,
  byteLength,
} from "./payment-security";

describe("isUuid", () => {
  it("UUID תקין (כל גרסה, לא רק v4) מזוהה", () => {
    expect(isUuid("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(isUuid("f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe(true);
    expect(isUuid("F47AC10B-58CC-4372-A567-0E02B2C3D479")).toBe(true); // case-insensitive
  });

  it("UUID שגוי נדחה", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("123e4567-e89b-12d3-a456-42661417400")).toBe(false); // קצר מדי
    expect(isUuid("123e4567e89b12d3a456426614174000")).toBe(false); // בלי מקפים
    expect(isUuid("")).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(12345)).toBe(false);
  });
});

describe("generateAccessToken - אורך מספיק, לא נחוש", () => {
  it("64 תווי hex = 32 בתים = 256 ביט בדיוק, לפי הדרישה המפורשת", () => {
    const token = generateAccessToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("שני tokens עוקבים שונים (אקראיות אמיתית, לא ערך קבוע)", () => {
    const a = generateAccessToken();
    const b = generateAccessToken();
    expect(a).not.toBe(b);
  });
});

describe("hashAccessToken - ה-hash לעולם לא שווה ל-token הגולמי", () => {
  it("hash שונה מה-token המקורי, ובאורך SHA-256 (64 hex)", async () => {
    const token = generateAccessToken();
    const hash = await hashAccessToken(token);
    expect(hash).not.toBe(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("דטרמיניסטי: אותו קלט -> אותו hash תמיד", async () => {
    const token = generateAccessToken();
    const hash1 = await hashAccessToken(token);
    const hash2 = await hashAccessToken(token);
    expect(hash1).toBe(hash2);
  });

  it("שני tokens שונים -> hashes שונים", async () => {
    const hashA = await hashAccessToken(generateAccessToken());
    const hashB = await hashAccessToken(generateAccessToken());
    expect(hashA).not.toBe(hashB);
  });
});

describe("generateProviderOrderReference", () => {
  it("פורמט קריא, מתחיל ב-po_, ייחודי בין קריאות", () => {
    const a = generateProviderOrderReference();
    const b = generateProviderOrderReference();
    expect(a).toMatch(/^po_[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe("parseAllowedOrigins / isAllowedOrigin - CORS בלי wildcard", () => {
  it("מפרק רשימה מופרדת בפסיקים, חותך רווחים, מסנן ריקים", () => {
    expect(parseAllowedOrigins("https://a.example, https://b.example ,, https://c.example")).toEqual([
      "https://a.example",
      "https://b.example",
      "https://c.example",
    ]);
    expect(parseAllowedOrigins("")).toEqual([]);
    expect(parseAllowedOrigins(null)).toEqual([]);
    expect(parseAllowedOrigins(undefined)).toEqual([]);
  });

  it("origin מאושר (התאמה מילולית מדויקת) מזוהה", () => {
    const allowed = ["https://haimetkin-lgtm.github.io"];
    expect(isAllowedOrigin("https://haimetkin-lgtm.github.io", allowed)).toBe(true);
  });

  it("origin אסור נדחה - כולל ניסיון subdomain/prefix/suffix דומה", () => {
    const allowed = ["https://haimetkin-lgtm.github.io"];
    expect(isAllowedOrigin("https://evil.example", allowed)).toBe(false);
    expect(isAllowedOrigin("https://haimetkin-lgtm.github.io.evil.example", allowed)).toBe(false);
    expect(isAllowedOrigin("http://haimetkin-lgtm.github.io", allowed)).toBe(false); // http, לא https
    expect(isAllowedOrigin(null, allowed)).toBe(false);
  });

  it("רשימה ריקה דוחה כל origin - אין ברירת מחדל פתוחה", () => {
    expect(isAllowedOrigin("https://haimetkin-lgtm.github.io", [])).toBe(false);
  });

  it("אין תמיכה ב-wildcard כלשהו ברשימה עצמה - '*' כערך פשוט לא מתפרש כתו כללי", () => {
    expect(isAllowedOrigin("https://anything.example", ["*"])).toBe(false);
  });
});

describe("byteLength / MAX_REQUEST_BODY_BYTES - הגבלת גודל body", () => {
  it("גוף קטן קביל (בדיקה יחסית - הערך בפועל נבדק ב-index.ts מול MAX_REQUEST_BODY_BYTES)", () => {
    const smallBody = JSON.stringify({ reportId: "x", productType: "baseReport" });
    expect(byteLength(smallBody)).toBeLessThan(MAX_REQUEST_BODY_BYTES);
  });

  it("גוף גדול מדי חורג מהמגבלה", () => {
    const hugeBody = "a".repeat(MAX_REQUEST_BODY_BYTES + 1);
    expect(byteLength(hugeBody)).toBeGreaterThan(MAX_REQUEST_BODY_BYTES);
  });

  it("byteLength סופר בתים, לא תווים - תווים רב-בייטיים (עברית) נספרים נכון", () => {
    // "א" בעברית הוא 2 בתים ב-UTF-8, לא 1
    expect(byteLength("א")).toBe(2);
    expect(byteLength("אבג")).toBe(6);
  });
});
