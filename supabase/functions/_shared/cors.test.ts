import { describe, expect, it } from "vitest";
import { corsPreflightResponse, jsonResponse } from "./cors";

const ALLOWED = ["https://haimetkin-lgtm.github.io", "http://localhost:3000"];
const ALLOWED_HEADERS = "Content-Type, X-Access-Token";

describe("jsonResponse - origin מותר", () => {
  it("מחזיר Access-Control-Allow-Origin **בדיוק** ל-origin שנשלח (echo מדויק, לא wildcard)", async () => {
    const res = jsonResponse({ ok: true }, 200, "https://haimetkin-lgtm.github.io", ALLOWED);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://haimetkin-lgtm.github.io");
    expect(res.headers.get("Vary")).toBe("Origin");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });

  it("origin שני באותה allowlist גם הוא מקבל echo מדויק משלו", () => {
    const res = jsonResponse({}, 200, "http://localhost:3000", ALLOWED);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
  });
});

describe("jsonResponse - origin לא מותר / חסר", () => {
  it("origin לא ברשימה -> אין Access-Control-Allow-Origin בתגובה בכלל (לא ריק, לא wildcard)", () => {
    const res = jsonResponse({ error: "origin_not_allowed" }, 403, "https://evil.example", ALLOWED);
    expect(res.headers.has("Access-Control-Allow-Origin")).toBe(false);
    expect(res.headers.has("Vary")).toBe(false);
    expect(res.status).toBe(403);
  });

  it("origin=null -> אין Access-Control-Allow-Origin", () => {
    const res = jsonResponse({}, 200, null, ALLOWED);
    expect(res.headers.has("Access-Control-Allow-Origin")).toBe(false);
  });

  it("לעולם לא מחזיר \"*\" - גם אם allowedOrigins ריקה", () => {
    const res = jsonResponse({}, 200, "https://haimetkin-lgtm.github.io", []);
    expect(res.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
    expect(res.headers.has("Access-Control-Allow-Origin")).toBe(false);
  });
});

describe("jsonResponse - אין Access-Control-Allow-Credentials", () => {
  it("לא מוגדר בשום תרחיש - אין cookies/session בזרימה הזו", () => {
    const res = jsonResponse({}, 200, "https://haimetkin-lgtm.github.io", ALLOWED);
    expect(res.headers.has("Access-Control-Allow-Credentials")).toBe(false);
  });
});

describe("corsPreflightResponse - origin מותר", () => {
  it("מחזיר 204, Origin מדויק, Methods מוגבל ל-POST+OPTIONS בלבד, Headers כפי שהוזרק", () => {
    const res = corsPreflightResponse("https://haimetkin-lgtm.github.io", ALLOWED, ALLOWED_HEADERS);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://haimetkin-lgtm.github.io");
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe(ALLOWED_HEADERS);
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("Methods לעולם לא כולל שיטות רחבות יותר (לא GET/PUT/DELETE/PATCH/*)", () => {
    const res = corsPreflightResponse("https://haimetkin-lgtm.github.io", ALLOWED, ALLOWED_HEADERS);
    const methods = res.headers.get("Access-Control-Allow-Methods") ?? "";
    for (const forbidden of ["GET", "PUT", "DELETE", "PATCH", "*"]) {
      expect(methods).not.toContain(forbidden);
    }
  });

  it("Headers מוגבל בדיוק למה שהוזרק - לא רחב יותר (לדוגמה, get-product-access לא מכיל Idempotency-Key)", () => {
    const res = corsPreflightResponse("https://haimetkin-lgtm.github.io", ALLOWED, "Content-Type, X-Access-Token");
    expect(res.headers.get("Access-Control-Allow-Headers")).not.toContain("Idempotency-Key");
  });
});

describe("corsPreflightResponse - origin לא מותר / חסר", () => {
  it("origin לא ברשימה -> 204 עדיין (preflight לא חושף שגיאה), אך בלי שום Access-Control-* header", () => {
    const res = corsPreflightResponse("https://evil.example", ALLOWED, ALLOWED_HEADERS);
    expect(res.status).toBe(204);
    expect(res.headers.has("Access-Control-Allow-Origin")).toBe(false);
    expect(res.headers.has("Access-Control-Allow-Methods")).toBe(false);
    expect(res.headers.has("Access-Control-Allow-Headers")).toBe(false);
  });

  it("origin=null -> אותו דבר, בלי headers", () => {
    const res = corsPreflightResponse(null, ALLOWED, ALLOWED_HEADERS);
    expect(res.headers.has("Access-Control-Allow-Origin")).toBe(false);
  });

  it("לעולם לא \"*\"", () => {
    const res = corsPreflightResponse("https://haimetkin-lgtm.github.io", [], ALLOWED_HEADERS);
    expect(res.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
  });
});

describe("שני ה-endpoints (create-payment-order / get-product-access) מקבלים מגבלות headers שונות בכוונה", () => {
  it("Idempotency-Key מותר רק כש-corsPreflightResponse מוזרקת עם allowedHeaders המתאים - אין ברירת מחדל גורפת", () => {
    const forCreateOrder = corsPreflightResponse("https://haimetkin-lgtm.github.io", ALLOWED, "Content-Type, Idempotency-Key");
    const forProductAccess = corsPreflightResponse("https://haimetkin-lgtm.github.io", ALLOWED, "Content-Type, X-Access-Token");

    expect(forCreateOrder.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type, Idempotency-Key");
    expect(forProductAccess.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type, X-Access-Token");
    expect(forProductAccess.headers.get("Access-Control-Allow-Headers")).not.toContain("Idempotency-Key");
    expect(forCreateOrder.headers.get("Access-Control-Allow-Headers")).not.toContain("X-Access-Token");
  });
});
