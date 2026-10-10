// קריאות לשרת המנויים והלוגיקה הטהורה סביבן. בלי React ובלי Supabase client, כדי שאפשר לבדוק בבדיקות יחידה.
// הסשן והקריאות שדורשות Supabase נמצאים ב-lib/subscriptions.ts.
//
// שרת המנויים הוא ריפו insure-vda. חייב להיות www: הכתובת בלי www מפנה (308), ודפדפן דוחה preflight שמקבל הפניה.
// ההרשאה והמכסה נבדקות רק שם. כל מה שכאן הוא תצוגה וקריאות, לעולם לא החלטת הרשאה.
import type { DealType } from "./calc/types";

export const SUBSCRIPTIONS_API = "https://www.insure.co.il/api";

export type PlanKey = "regular" | "office" | "org";
export type Billing = "full" | "installments";
type Fetcher = typeof fetch;

export interface PlanPrices {
  installmentsMonthlyNis: number;
  installmentsYearNis: number;
  fullYearNis: number;
}

export interface PublicPlan {
  key: PlanKey;
  name: string;
  audience: string;
  availability: "available" | "coming_soon" | "quote";
  seats: number;
  /** בדוחות אפס: מספר הפרויקטים שנפתחים בחודש */
  checksPerMonth: number;
  features: string[];
  prices: { dohefes: PlanPrices };
}

export interface MySubscription {
  id: string;
  plan: string;
  products: string;
  seats: number;
  status: string;
  is_owner: boolean;
  checks_per_month: number;
  usage_checks: number;
  starts_at: string;
  ends_at: string;
  members: string[] | null;
}

export const PLAN_NAMES: Record<string, string> = {
  regular: "מנוי יחיד",
  office: "מנוי משרדי",
  org: "מנוי לארגון",
};

export async function fetchPlans(fetcher: Fetcher = fetch): Promise<PublicPlan[]> {
  const res = await fetcher(`${SUBSCRIPTIONS_API}/subscriptions/plans?product=dohefes`);
  if (!res.ok) throw new Error("plans_failed");
  const body = await res.json();
  return body.plans as PublicPlan[];
}

/** המנויים של המשתמש לדוחות אפס בלבד (בחשבון אחד יכולים להיות גם מנויים לאתרים אחרים). */
export function onlyDohefes(subs: MySubscription[]): MySubscription[] {
  return subs.filter((s) => s.products === "dohefes");
}

/** מנוי דוחות אפס שנשארה בו מכסה החודש. השרת מחליט בפועל, זה רק כדי לדעת מה להציג. */
export function usableDohefesSubscription(subs: MySubscription[]): MySubscription | null {
  return onlyDohefes(subs).find((s) => s.usage_checks < s.checks_per_month) ?? null;
}

async function authedPost(path: string, token: string, payload: unknown, fetcher: Fetcher) {
  const res = await fetcher(`${SUBSCRIPTIONS_API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

// יוצר דף תשלום למנוי. החבילה והמחיר נקבעים בשרת, כאן רק בוחרים מה לקנות.
export async function startSubscriptionCheckout(
  token: string,
  plan: PlanKey,
  billing: Billing,
  fetcher: Fetcher = fetch
): Promise<string> {
  const r = await authedPost("/subscriptions/checkout", token, { plan, products: "dohefes", billing, origin: "dohefes" }, fetcher);
  if (!r.ok || !r.body.payment_url) throw new Error(r.body.error || "checkout_failed");
  return r.body.payment_url as string;
}

export interface OpenedReport {
  reportId: string;
  replayed: boolean;
  remaining: number | null;
  baseReportToken: string;
  trackingToken: string;
}

const HEX_TOKEN = /^[0-9a-f]{64}$/;

/**
 * פותח דוח חדש על חשבון המנוי (יחידת מכסה אחת). האסימונים חוזרים פעם אחת בלבד וצריך לשמור אותם מיד.
 * ניסיון חוזר עם אותו idempotencyKey מחזיר את אותו דוח בלי לנצל מכסה שוב, ולכן הקורא חייב להשתמש באותו מפתח
 * בכל ניסיון חוזר של אותה פעולה, ובמפתח חדש רק לדוח חדש.
 */
export async function openSubscriberReport(
  token: string,
  dealType: DealType,
  idempotencyKey: string,
  fetcher: Fetcher = fetch
): Promise<OpenedReport> {
  const r = await authedPost("/subscriber/dohefes-report", token, { deal_type: dealType, idempotency_key: idempotencyKey }, fetcher);
  const tokens = r.body?.access_tokens;
  if (
    !r.ok ||
    typeof r.body?.report_id !== "string" ||
    typeof tokens?.baseReport !== "string" || !HEX_TOKEN.test(tokens.baseReport) ||
    typeof tokens?.trackingReports !== "string" || !HEX_TOKEN.test(tokens.trackingReports)
  ) {
    throw new Error(r.body?.error || "open_failed");
  }
  return {
    reportId: r.body.report_id,
    replayed: r.body.replayed === true,
    remaining: typeof r.body.remaining === "number" ? r.body.remaining : null,
    baseReportToken: tokens.baseReport,
    trackingToken: tokens.trackingReports,
  };
}

/** הודעה בעברית פשוטה לכל קוד שגיאה שהשרת יכול להחזיר. */
export function describeSubscriptionError(code: string): string {
  switch (code) {
    case "quota_exceeded":
      return "המכסה החודשית של המנוי נוצלה. היא מתחדשת בראשון לכל חודש.";
    case "no_subscription":
      return "אין בחשבון הזה מנוי פעיל לדוחות אפס.";
    case "login_required":
      return "יש להתחבר מחדש.";
    case "already_subscribed":
      return "כבר יש לכם מנוי פעיל מהסוג הזה. ניתן לראות אותו באזור האישי.";
    case "email_not_confirmed":
      return "כתובת האימייל עדיין לא אומתה. אמתו אותה דרך המייל שנשלח אליכם ונסו שוב.";
    case "plan_not_available":
      return "החבילה הזו עדיין לא זמינה לרכישה.";
    default:
      return "משהו השתבש. נסו שוב בעוד רגע, ואם זה חוזר צרו קשר.";
  }
}
