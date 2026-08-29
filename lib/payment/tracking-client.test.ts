import { describe, expect, it } from "vitest";
import { getTrackingData, saveTrackingData } from "./tracking-client";
import type { FunctionsInvoker } from "./payment-client";
import type { TrackingItem } from "../tracking/types";

const REPORT_ID = "11111111-1111-1111-1111-111111111111";
const ACCESS_TOKEN = "tok-abc";
const SAMPLE_ITEM: TrackingItem = { id: "i1", phase: "ביסוס", description: "כלונסאות", quantity: 10, unitPriceNis: 5000, actualNis: 3000 };

type InvokerOutcome =
  | { data: unknown }
  | { httpErrorStatus: number; httpErrorBody: unknown }
  | { networkError: true };

/** אותו דפוס בדיוק כמו payment-client.test.ts - invoker מזוייף עם שליטה על success/HTTP-error/network-error. */
function fakeInvoker(outcome: InvokerOutcome): FunctionsInvoker & { calls: Array<{ functionName: string; headers?: Record<string, string>; body?: unknown }> } {
  const calls: Array<{ functionName: string; headers?: Record<string, string>; body?: unknown }> = [];
  return {
    calls,
    async invoke(functionName, options) {
      calls.push({ functionName, headers: options?.headers, body: options?.body });
      if ("data" in outcome) return { data: outcome.data, error: null };
      if ("networkError" in outcome) return { data: null, error: { context: undefined } };
      return { data: null, error: { context: { status: outcome.httpErrorStatus, json: async () => outcome.httpErrorBody } } };
    },
  };
}

describe("getTrackingData - 7. קורא רק ל-dohefes-get-tracking-data", () => {
  it("status='active' + entries+projectName -> kind:'active', שניהם מועברים כמות שהם", async () => {
    const invoker = fakeInvoker({ data: { status: "active", projectName: "רחוב הרצל 12", entries: [SAMPLE_ITEM] } });
    const result = await getTrackingData(invoker, { reportId: REPORT_ID, accessToken: ACCESS_TOKEN });
    expect(result).toEqual({ kind: "active", projectName: "רחוב הרצל 12", entries: [SAMPLE_ITEM] });
    expect(invoker.calls).toEqual([{ functionName: "dohefes-get-tracking-data", headers: { "X-Access-Token": ACCESS_TOKEN }, body: { reportId: REPORT_ID } }]);
  });

  it("6. projectName=null (דוח בלי שם) - מועבר כ-null, לא הופך למחרוזת מומצאת", async () => {
    const invoker = fakeInvoker({ data: { status: "active", projectName: null, entries: [] } });
    const result = await getTrackingData(invoker, { reportId: REPORT_ID, accessToken: ACCESS_TOKEN });
    expect(result).toEqual({ kind: "active", projectName: null, entries: [] });
  });

  it("projectName חסר לגמרי מהתשובה (undefined, לא null מפורש) - נכשל סגור, error - השרת תמיד כולל את השדה (string או null), מפתח חסר הוא תשובה חשודה", async () => {
    const invoker = fakeInvoker({ data: { status: "active", entries: [] } });
    const result = await getTrackingData(invoker, { reportId: REPORT_ID, accessToken: ACCESS_TOKEN });
    expect(result).toEqual({ kind: "error", reason: "invalid_response_shape" });
  });

  it("projectName ממספר/אובייקט (לא string/null) - נכשל סגור, error", async () => {
    const invoker = fakeInvoker({ data: { status: "active", projectName: 123, entries: [] } });
    const result = await getTrackingData(invoker, { reportId: REPORT_ID, accessToken: ACCESS_TOKEN });
    expect(result).toEqual({ kind: "error", reason: "invalid_response_shape" });
  });

  it("8. status='active' + entries=[] (מצב ריק) -> kind:'active', entries:[]", async () => {
    const invoker = fakeInvoker({ data: { status: "active", projectName: "פרויקט", entries: [] } });
    const result = await getTrackingData(invoker, { reportId: REPORT_ID, accessToken: ACCESS_TOKEN });
    expect(result).toEqual({ kind: "active", projectName: "פרויקט", entries: [] });
  });

  it("status='active' בלי entries (חסר) - נכשל סגור, error, לא 'active' עם 0 מנוחש", async () => {
    const invoker = fakeInvoker({ data: { status: "active", projectName: "פרויקט" } });
    const result = await getTrackingData(invoker, { reportId: REPORT_ID, accessToken: ACCESS_TOKEN });
    expect(result).toEqual({ kind: "error", reason: "invalid_response_shape" });
  });

  it("5. status='unavailable' - גם אם השרת (לא אמור) כלל projectName - לא נחשף, kind:'unavailable' בלבד", async () => {
    const invoker = fakeInvoker({ data: { status: "unavailable", projectName: "לא אמור להיחשף" } });
    const result = await getTrackingData(invoker, { reportId: REPORT_ID, accessToken: ACCESS_TOKEN });
    expect(result).toEqual({ kind: "unavailable" });
  });

  it("13. status='unavailable' -> kind:'unavailable'", async () => {
    const invoker = fakeInvoker({ data: { status: "unavailable" } });
    const result = await getTrackingData(invoker, { reportId: REPORT_ID, accessToken: ACCESS_TOKEN });
    expect(result).toEqual({ kind: "unavailable" });
  });

  it("10/11. הטוקן נשלח אך ורק ב-header X-Access-Token - לא בגוף הבקשה, לא ב-URL/query", async () => {
    const invoker = fakeInvoker({ data: { status: "active", projectName: "פרויקט", entries: [] } });
    await getTrackingData(invoker, { reportId: REPORT_ID, accessToken: ACCESS_TOKEN });
    const call = invoker.calls[0];
    expect(call.headers?.["X-Access-Token"]).toBe(ACCESS_TOKEN);
    expect(JSON.stringify(call.body)).not.toContain(ACCESS_TOKEN);
    expect(call.functionName).not.toContain(ACCESS_TOKEN);
  });

  it("שגיאת HTTP retryable (503/500/404/429) -> kind:'retryable'", async () => {
    for (const status of [503, 500, 404, 429]) {
      const invoker = fakeInvoker({ httpErrorStatus: status, httpErrorBody: { error: "x" } });
      const result = await getTrackingData(invoker, { reportId: REPORT_ID, accessToken: ACCESS_TOKEN });
      expect(result).toEqual({ kind: "retryable" });
    }
  });

  it("כשל רשת (network error, אין status בכלל) -> retryable", async () => {
    const invoker = fakeInvoker({ networkError: true });
    const result = await getTrackingData(invoker, { reportId: REPORT_ID, accessToken: ACCESS_TOKEN });
    expect(result).toEqual({ kind: "retryable" });
  });

  it("15. הודעת השגיאה שמוחזרת לעולם לא כוללת את accessToken", async () => {
    const invoker = fakeInvoker({ httpErrorStatus: 500, httpErrorBody: { error: "internal_error" } });
    const result = await getTrackingData(invoker, { reportId: REPORT_ID, accessToken: "super-secret-token-xyz" });
    expect(JSON.stringify(result)).not.toContain("super-secret-token-xyz");
  });
});

describe("saveTrackingData - 8. קורא רק ל-dohefes-save-tracking-data", () => {
  it("9. שמירה ראשונה - status='saved' -> kind:'saved'", async () => {
    const invoker = fakeInvoker({ data: { status: "saved" } });
    const result = await saveTrackingData(invoker, { reportId: REPORT_ID, accessToken: ACCESS_TOKEN, entries: [SAMPLE_ITEM] });
    expect(result).toEqual({ kind: "saved" });
    expect(invoker.calls).toEqual([
      { functionName: "dohefes-save-tracking-data", headers: { "X-Access-Token": ACCESS_TOKEN }, body: { reportId: REPORT_ID, entries: [SAMPLE_ITEM] } },
    ]);
  });

  it("13. status='unavailable' (למשל entitlement בוטלה) -> kind:'unavailable'", async () => {
    const invoker = fakeInvoker({ data: { status: "unavailable" } });
    const result = await saveTrackingData(invoker, { reportId: REPORT_ID, accessToken: ACCESS_TOKEN, entries: [] });
    expect(result).toEqual({ kind: "unavailable" });
  });

  it("status='invalid_payload' -> kind:'invalid_payload'", async () => {
    const invoker = fakeInvoker({ data: { status: "invalid_payload" } });
    const result = await saveTrackingData(invoker, { reportId: REPORT_ID, accessToken: ACCESS_TOKEN, entries: [] });
    expect(result).toEqual({ kind: "invalid_payload" });
  });

  it("10/11. הטוקן נשלח אך ורק ב-X-Access-Token, לעולם לא ב-body (entries עצמו לא כולל טוקן)", async () => {
    const invoker = fakeInvoker({ data: { status: "saved" } });
    await saveTrackingData(invoker, { reportId: REPORT_ID, accessToken: ACCESS_TOKEN, entries: [SAMPLE_ITEM] });
    const call = invoker.calls[0];
    expect(call.headers?.["X-Access-Token"]).toBe(ACCESS_TOKEN);
    expect(JSON.stringify(call.body)).not.toContain(ACCESS_TOKEN);
  });

  it("שגיאת HTTP retryable -> kind:'retryable'", async () => {
    const invoker = fakeInvoker({ httpErrorStatus: 503, httpErrorBody: { error: "x" } });
    const result = await saveTrackingData(invoker, { reportId: REPORT_ID, accessToken: ACCESS_TOKEN, entries: [] });
    expect(result).toEqual({ kind: "retryable" });
  });

  it("15. הודעת השגיאה לעולם לא כוללת את accessToken או payload גולמי", async () => {
    const invoker = fakeInvoker({ httpErrorStatus: 500, httpErrorBody: { error: "internal_error" } });
    const result = await saveTrackingData(invoker, { reportId: REPORT_ID, accessToken: "super-secret-token-xyz", entries: [SAMPLE_ITEM] });
    expect(JSON.stringify(result)).not.toContain("super-secret-token-xyz");
  });
});

describe("אידמפוטנטיות - saveTrackingData הוא upsert מלא, קריאה חוזרת עם אותו payload לא יוצרת בעיה", () => {
  it("קריאה כפולה עם אותם entries בדיוק - שתי קריאות זהות לשרת, שתיהן 'saved', אין state נסתר שמונע קריאה שנייה", async () => {
    const invoker = fakeInvoker({ data: { status: "saved" } });
    const first = await saveTrackingData(invoker, { reportId: REPORT_ID, accessToken: ACCESS_TOKEN, entries: [SAMPLE_ITEM] });
    const second = await saveTrackingData(invoker, { reportId: REPORT_ID, accessToken: ACCESS_TOKEN, entries: [SAMPLE_ITEM] });
    expect(first).toEqual({ kind: "saved" });
    expect(second).toEqual({ kind: "saved" });
    expect(invoker.calls.length).toBe(2);
    expect(invoker.calls[0].body).toEqual(invoker.calls[1].body); // אותו payload בדיוק בשתי הקריאות
  });

  it("אין idempotency-key/header ייחודי-לקריאה בשמירה (בניגוד ל-createPaymentOrder) - upsert לא צריך אחד", async () => {
    const invoker = fakeInvoker({ data: { status: "saved" } });
    await saveTrackingData(invoker, { reportId: REPORT_ID, accessToken: ACCESS_TOKEN, entries: [] });
    const headerKeys = Object.keys(invoker.calls[0].headers ?? {});
    expect(headerKeys).toEqual(["X-Access-Token"]);
  });
});

describe("22. אין mutation - entries שהועברו לא משתנים", () => {
  it("saveTrackingData לא נוגעת במערך entries שהועבר", async () => {
    const invoker = fakeInvoker({ data: { status: "saved" } });
    const entries = [SAMPLE_ITEM];
    const snapshot = JSON.stringify(entries);
    await saveTrackingData(invoker, { reportId: REPORT_ID, accessToken: ACCESS_TOKEN, entries });
    expect(JSON.stringify(entries)).toBe(snapshot);
  });
});
