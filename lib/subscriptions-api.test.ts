import { describe, expect, it } from "vitest";
import {
  describeSubscriptionError,
  fetchPlans,
  onlyDohefes,
  openSubscriberReport,
  startSubscriptionCheckout,
  usableDohefesSubscription,
} from "./subscriptions-api";
import type { MySubscription } from "./subscriptions-api";

const T_BASE = "a".repeat(64);
const T_TRACK = "b".repeat(64);

function sub(overrides: Partial<MySubscription>): MySubscription {
  return {
    id: "s1", plan: "regular", products: "dohefes", seats: 1, status: "active", is_owner: true,
    checks_per_month: 2, usage_checks: 0, starts_at: "2026-10-01", ends_at: "2027-10-01", members: [],
    ...overrides,
  };
}

function fakeFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  }) as typeof fetch;
  return { fn, calls };
}

describe("onlyDohefes ו-usableDohefesSubscription", () => {
  it("מסננות מנויים של אתרים אחרים", () => {
    const subs = [sub({ id: "m", products: "machria" }), sub({ id: "d" }), sub({ id: "b", products: "both" })];
    expect(onlyDohefes(subs).map((s) => s.id)).toEqual(["d"]);
  });

  it("מנוי עם מכסה פנויה מזוהה, ומנוי שהמכסה שלו נוצלה לא", () => {
    expect(usableDohefesSubscription([sub({ usage_checks: 1 })])?.id).toBe("s1");
    expect(usableDohefesSubscription([sub({ usage_checks: 2 })])).toBeNull();
    expect(usableDohefesSubscription([sub({ products: "machria" })])).toBeNull();
    expect(usableDohefesSubscription([])).toBeNull();
  });
});

describe("fetchPlans", () => {
  it("מבקשת את קטלוג דוחות אפס מהשרת", async () => {
    const { fn, calls } = fakeFetch(200, { plans: [{ key: "regular" }] });
    expect(await fetchPlans(fn)).toEqual([{ key: "regular" }]);
    expect(calls[0].url).toBe("https://www.insure.co.il/api/subscriptions/plans?product=dohefes");
  });

  it("זורקת כשהשרת נכשל", async () => {
    await expect(fetchPlans(fakeFetch(500, {}).fn)).rejects.toThrow("plans_failed");
  });
});

describe("startSubscriptionCheckout", () => {
  it("שולחת רק חבילה, תשלום ומוצר, בלי מחיר, עם האסימון של המשתמש", async () => {
    const { fn, calls } = fakeFetch(200, { payment_url: "https://secure.cardcom.solutions/x" });
    expect(await startSubscriptionCheckout("user-token", "office", "installments", fn)).toBe("https://secure.cardcom.solutions/x");
    expect(calls[0].url).toBe("https://www.insure.co.il/api/subscriptions/checkout");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ plan: "office", products: "dohefes", billing: "installments", origin: "dohefes" });
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer user-token");
  });

  it("מעבירה את קוד השגיאה של השרת", async () => {
    await expect(startSubscriptionCheckout("t", "regular", "full", fakeFetch(409, { error: "already_subscribed" }).fn)).rejects.toThrow(
      "already_subscribed"
    );
    await expect(startSubscriptionCheckout("t", "regular", "full", fakeFetch(200, {}).fn)).rejects.toThrow("checkout_failed");
  });
});

describe("openSubscriberReport", () => {
  const okBody = { report_id: "r1", replayed: false, remaining: 1, access_tokens: { baseReport: T_BASE, trackingReports: T_TRACK } };

  it("שולחת סוג עסקה ומפתח idempotency בלבד ומחזירה את הדוח והאסימונים", async () => {
    const { fn, calls } = fakeFetch(200, okBody);
    expect(await openSubscriberReport("tok", "pinuyBinui", "key-12345678", fn)).toEqual({
      reportId: "r1", replayed: false, remaining: 1, baseReportToken: T_BASE, trackingToken: T_TRACK,
    });
    expect(calls[0].url).toBe("https://www.insure.co.il/api/subscriber/dohefes-report");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ deal_type: "pinuyBinui", idempotency_key: "key-12345678" });
  });

  it("ניסיון חוזר מסומן replayed וללא מכסה נותרת", async () => {
    const r = await openSubscriberReport("tok", "basic", "key-12345678", fakeFetch(200, { ...okBody, replayed: true, remaining: null }).fn);
    expect(r.replayed).toBe(true);
    expect(r.remaining).toBeNull();
  });

  it("מעבירה קוד שגיאה מהשרת, כולל חריגת מכסה", async () => {
    await expect(openSubscriberReport("t", "basic", "key-12345678", fakeFetch(402, { error: "quota_exceeded" }).fn)).rejects.toThrow("quota_exceeded");
    await expect(openSubscriberReport("t", "basic", "key-12345678", fakeFetch(403, { error: "no_subscription" }).fn)).rejects.toThrow("no_subscription");
  });

  it("נכשלת סגור על תשובה תקינה בצורה אבל עם אסימון פגום או חסר", async () => {
    const bad = (access_tokens: unknown) => fakeFetch(200, { ...okBody, access_tokens }).fn;
    await expect(openSubscriberReport("t", "basic", "key-12345678", bad({ baseReport: "short", trackingReports: T_TRACK }))).rejects.toThrow("open_failed");
    await expect(openSubscriberReport("t", "basic", "key-12345678", bad({ baseReport: T_BASE }))).rejects.toThrow("open_failed");
    await expect(openSubscriberReport("t", "basic", "key-12345678", bad(undefined))).rejects.toThrow("open_failed");
    await expect(openSubscriberReport("t", "basic", "key-12345678", fakeFetch(200, {}).fn)).rejects.toThrow("open_failed");
  });
});

describe("describeSubscriptionError", () => {
  it("נותנת הודעה ברורה לכל קוד מוכר, וברירת מחדל כללית לאחרים", () => {
    for (const code of ["quota_exceeded", "no_subscription", "login_required", "already_subscribed", "email_not_confirmed", "plan_not_available"]) {
      expect(describeSubscriptionError(code).length).toBeGreaterThan(10);
    }
    expect(describeSubscriptionError("something_else")).toContain("נסו שוב");
    expect(describeSubscriptionError("quota_exceeded")).not.toBe(describeSubscriptionError("something_else"));
  });
});
