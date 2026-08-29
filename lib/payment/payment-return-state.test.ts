import { describe, expect, it } from "vitest";
import {
  INITIAL_PAYMENT_RETURN_STATE,
  MAX_POLL_ATTEMPTS,
  extractReturnValue,
  nextPollDelayMs,
  reducePaymentReturnState,
  resolveProductRedirectPath,
} from "./payment-return-state";
import type { PaymentContext, PaymentReturnState } from "./payment-return-state";

const CTX: PaymentContext = {
  paymentContextId: "po_abc",
  reportId: "11111111-1111-1111-1111-111111111111",
  productType: "trackingReports",
  accessToken: "tok-1",
};

describe("extractReturnValue - case-insensitive", () => {
  it.each(["ReturnValue", "returnvalue", "RETURNVALUE", "ReTuRnVaLuE"])("מזהה את המפתח %s", (key) => {
    expect(extractReturnValue(`?${key}=po_abc&outcome=success`)).toBe("po_abc");
  });

  it("querystring ריק - null", () => {
    expect(extractReturnValue("")).toBeNull();
  });

  it("אין ReturnValue בכלל - null, לא זורק", () => {
    expect(extractReturnValue("?outcome=success")).toBeNull();
  });

  it("ReturnValue עם ערך ריק - null, לא מחרוזת ריקה", () => {
    expect(extractReturnValue("?ReturnValue=&outcome=success")).toBeNull();
  });
});

describe("resolving_context -> checking/unavailable", () => {
  it("CONTEXT_FOUND -> checking עם attempt=0 וההקשר המלא", () => {
    const next = reducePaymentReturnState(INITIAL_PAYMENT_RETURN_STATE, { type: "CONTEXT_FOUND", context: CTX });
    expect(next).toEqual({ ...CTX, kind: "checking", attempt: 0 });
  });

  it("CONTEXT_NOT_FOUND -> unavailable", () => {
    const next = reducePaymentReturnState(INITIAL_PAYMENT_RETURN_STATE, { type: "CONTEXT_NOT_FOUND" });
    expect(next).toEqual({ kind: "unavailable" });
  });
});

describe("checking -> active/pending/unavailable", () => {
  const checkingState: PaymentReturnState = { ...CTX, kind: "checking", attempt: 0 };

  it("ACCESS_ACTIVE -> promoting, שומר את ההקשר", () => {
    const next = reducePaymentReturnState(checkingState, { type: "ACCESS_ACTIVE" });
    expect(next).toEqual({ ...CTX, kind: "promoting" });
  });

  it("ACCESS_UNAVAILABLE -> unavailable", () => {
    const next = reducePaymentReturnState(checkingState, { type: "ACCESS_UNAVAILABLE" });
    expect(next).toEqual({ kind: "unavailable" });
  });

  it("ACCESS_PENDING -> pending, attempt מוגדל ב-1", () => {
    const next = reducePaymentReturnState(checkingState, { type: "ACCESS_PENDING" });
    expect(next).toEqual({ ...CTX, kind: "pending", attempt: 1 });
  });

  it("ACCESS_RETRYABLE מתנהג זהה ל-ACCESS_PENDING (ממשיך polling)", () => {
    const next = reducePaymentReturnState(checkingState, { type: "ACCESS_RETRYABLE" });
    expect(next).toEqual({ ...CTX, kind: "pending", attempt: 1 });
  });
});

describe("pending -> checking (POLL_AGAIN) / timeout (תקרה)", () => {
  it("POLL_AGAIN -> checking, attempt נשמר (לא מתאפס)", () => {
    const pendingState: PaymentReturnState = { ...CTX, kind: "pending", attempt: 5 };
    const next = reducePaymentReturnState(pendingState, { type: "POLL_AGAIN" });
    expect(next).toEqual({ ...CTX, kind: "checking", attempt: 5 });
  });

  it("הגעה ל-MAX_POLL_ATTEMPTS מתוך checking -> timeout, לא pending נוסף", () => {
    const checkingAtCeiling: PaymentReturnState = { ...CTX, kind: "checking", attempt: MAX_POLL_ATTEMPTS };
    const next = reducePaymentReturnState(checkingAtCeiling, { type: "ACCESS_PENDING" });
    expect(next).toEqual({ ...CTX, kind: "timeout" });
  });

  it("נסיון אחד לפני התקרה עדיין מייצר pending, לא timeout", () => {
    const checkingBeforeCeiling: PaymentReturnState = { ...CTX, kind: "checking", attempt: MAX_POLL_ATTEMPTS - 1 };
    const next = reducePaymentReturnState(checkingBeforeCeiling, { type: "ACCESS_PENDING" });
    expect(next).toEqual({ ...CTX, kind: "pending", attempt: MAX_POLL_ATTEMPTS });
  });

  it("אין לולאה אינסופית - סימולציית polling מלאה תמיד מגיעה ל-timeout במספר סופי של צעדים", () => {
    let state: PaymentReturnState = { ...CTX, kind: "checking", attempt: 0 };
    let steps = 0;
    while (state.kind === "checking" || state.kind === "pending") {
      if (state.kind === "checking") {
        state = reducePaymentReturnState(state, { type: "ACCESS_PENDING" });
      } else {
        state = reducePaymentReturnState(state, { type: "POLL_AGAIN" });
      }
      steps += 1;
      expect(steps).toBeLessThan(1000); // רשת-ביטחון לבדיקה עצמה - לא אמור להגיע לזה בכלל
    }
    expect(state.kind).toBe("timeout");
  });
});

describe("promoting -> redirecting/storage_error", () => {
  const promotingState: PaymentReturnState = { ...CTX, kind: "promoting" };

  it("17. PROMOTE_SUCCEEDED -> redirecting עם reportId **וגם productType** (לא reportId בלבד - נדרש לקביעת יעד ההפניה, ר' app/payment-return/page.tsx) - לא חושף accessToken/paymentContextId הלאה", () => {
    const next = reducePaymentReturnState(promotingState, { type: "PROMOTE_SUCCEEDED" });
    expect(next).toEqual({ kind: "redirecting", reportId: CTX.reportId, productType: CTX.productType });
    expect(next).not.toHaveProperty("accessToken");
    expect(next).not.toHaveProperty("paymentContextId");
  });

  it("productType אחר (baseReport) מועבר גם הוא נכון ל-redirecting - לא רק trackingReports", () => {
    const baseCtx: PaymentContext = { ...CTX, productType: "baseReport" };
    const next = reducePaymentReturnState({ ...baseCtx, kind: "promoting" }, { type: "PROMOTE_SUCCEEDED" });
    expect(next).toEqual({ kind: "redirecting", reportId: baseCtx.reportId, productType: "baseReport" });
  });

  it("PROMOTE_FAILED -> storage_error, שומר את ההקשר לניסיון חוזר", () => {
    const next = reducePaymentReturnState(promotingState, { type: "PROMOTE_FAILED" });
    expect(next).toEqual({ ...CTX, kind: "storage_error" });
  });
});

describe("timeout -> checking (MANUAL_RETRY)", () => {
  it("MANUAL_RETRY מאפס את attempt חזרה ל-0", () => {
    const timeoutState: PaymentReturnState = { ...CTX, kind: "timeout" };
    const next = reducePaymentReturnState(timeoutState, { type: "MANUAL_RETRY" });
    expect(next).toEqual({ ...CTX, kind: "checking", attempt: 0 });
  });
});

describe("18. אירועים לא-רלוונטיים למצב הנוכחי - מתעלמים, לא זורקים, לא מנחשים context חסר", () => {
  it("MANUAL_RETRY כשלא ב-timeout - state לא משתנה", () => {
    const state: PaymentReturnState = { kind: "resolving_context" };
    expect(reducePaymentReturnState(state, { type: "MANUAL_RETRY" })).toBe(state);
  });

  it("POLL_AGAIN כשלא ב-pending - state לא משתנה", () => {
    const state: PaymentReturnState = { kind: "unavailable" };
    expect(reducePaymentReturnState(state, { type: "POLL_AGAIN" })).toBe(state);
  });

  it("ACCESS_ACTIVE כשכבר redirecting - state לא משתנה (תשובה מאוחרת אחרי שכבר עברו הלאה)", () => {
    const state: PaymentReturnState = { kind: "redirecting", reportId: CTX.reportId, productType: CTX.productType };
    expect(reducePaymentReturnState(state, { type: "ACCESS_ACTIVE" })).toBe(state);
  });

  it("CONTEXT_FOUND כשכבר לא ב-resolving_context - state לא משתנה, אין 'ניחוש' הקשר חדש", () => {
    const state: PaymentReturnState = { kind: "unavailable" };
    expect(reducePaymentReturnState(state, { type: "CONTEXT_FOUND", context: CTX })).toBe(state);
  });
});

describe("resolveProductRedirectPath - 17/18. מיפוי productType -> יעד הפניה", () => {
  it("trackingReports -> /tracking/?id=<reportId>", () => {
    expect(resolveProductRedirectPath("trackingReports", CTX.reportId)).toEqual({ kind: "path", path: `/dohefes/tracking/?id=${CTX.reportId}` });
  });

  it("cashFlowAnalysis -> /cashflow/?id=<reportId> (במיפוי, אין route בפועל בענף הזה - לא נבדק כאן, ר' lib/site.ts)", () => {
    expect(resolveProductRedirectPath("cashFlowAnalysis", CTX.reportId)).toEqual({ kind: "path", path: `/dohefes/cashflow/?id=${CTX.reportId}` });
  });

  it("baseReport -> המחולל המאובטח עם reportId", () => {
    expect(resolveProductRedirectPath("baseReport", CTX.reportId)).toEqual({ kind: "path", path: `/dohefes/calculator/?id=${CTX.reportId}` });
  });
});

describe("nextPollDelayMs - backoff", () => {
  it("2 שניות ל-10 הנסיונות הראשונים (attempt 0-9)", () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      expect(nextPollDelayMs(attempt)).toBe(2000);
    }
  });

  it("5 שניות מ-attempt 10 ואילך", () => {
    expect(nextPollDelayMs(10)).toBe(5000);
    expect(nextPollDelayMs(MAX_POLL_ATTEMPTS)).toBe(5000);
  });
});
