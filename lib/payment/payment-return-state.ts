// State machine טהור לעמוד app/payment-return - שום תלות ב-React/window/timers. הרכיב React
// (payment-return) הוא רק "מנוע" - מדווח אירועים חיצוניים (context נמצא/get-product-access
// ענתה/promote הצליח וכו') ומצייר לפי ה-state שחוזר. מאפשר לבדוק את כל לוגיקת ה-polling/backoff/
// timeout/מעברי-מצב ב-Vitest טהור, בלי jsdom או React Testing Library.
//
// **`outcome=success|cancelled` מה-URL הוא רמז ניסוח בלבד** - לא מיוצג כאן בכלל ב-state machine,
// כי הוא לא משפיע על שום מעבר מצב - רק על טקסט תחילי שהרכיב React בוחר, לפני שההתקדמות בזרימה
// תלויה בו.
//
// **מקור: reconciliation מול gen2-cashflow-ui-implementation (Commit 5b)**, עם שינוי אחד
// מכוון: מצב "redirecting" נושא כעת גם productType, לא רק reportId - נדרש כדי שהרכיב React
// יוכל לקבוע את יעד ההפניה לפי productType (trackingReports -> /tracking, וכו', ר.
// app/payment-return/page.tsx) - בענף המקור, שבו productType היחיד הלכה למעשה היה
// cashFlowAnalysis, זה לא היה נחוץ.

import type { ProductType } from "./payment-storage";
import { SITE_PATHS } from "../site";

export interface PaymentContext {
  paymentContextId: string;
  reportId: string;
  productType: ProductType;
  accessToken: string;
}

export type PaymentReturnState =
  | { kind: "resolving_context" }
  | (PaymentContext & { kind: "checking"; attempt: number })
  | (PaymentContext & { kind: "pending"; attempt: number })
  | (PaymentContext & { kind: "promoting" })
  | { kind: "redirecting"; reportId: string; productType: ProductType }
  | (PaymentContext & { kind: "timeout" })
  | { kind: "unavailable" }
  | (PaymentContext & { kind: "storage_error" });

export type PaymentReturnEvent =
  | { type: "CONTEXT_FOUND"; context: PaymentContext }
  | { type: "CONTEXT_NOT_FOUND" }
  | { type: "ACCESS_ACTIVE" }
  | { type: "ACCESS_PENDING" }
  /** get-product-access נכשלה באופן חולף (רשת/500) - מטופל **זהה** ל-ACCESS_PENDING מבחינת
   *  ה-state machine (ממשיכים polling), לא מצב נפרד - ר' תיעוד ב-payment-client.ts. */
  | { type: "ACCESS_RETRYABLE" }
  | { type: "ACCESS_UNAVAILABLE" }
  | { type: "PROMOTE_SUCCEEDED" }
  | { type: "PROMOTE_FAILED" }
  /** הטיימר ששודל מהמצב הקודם (pending) ירה - זמן לבדוק שוב. */
  | { type: "POLL_AGAIN" }
  /** לחיצת "בדוק שוב" ידנית מתוך מצב timeout בלבד. */
  | { type: "MANUAL_RETRY" };

/** תקרת נסיונות polling - **לא** לנצח. ~90 שניות בפועל (10 נסיונות כל 2 שניות + 16 נוספים כל
 *  5 שניות, ר' nextPollDelayMs) - מספר קבוע, לא תלוי-זמן-שעון, כדי שה-state machine יישאר טהור
 *  וניתן לבדיקה בלי טיימרים אמיתיים. */
export const MAX_POLL_ATTEMPTS = 26;

/** backoff: 2 שניות לעשרת הנסיונות הראשונים, 5 שניות אחר כך - "polling מוגבל עם backoff", לא
 *  מרווח קבוע לנצח. */
export function nextPollDelayMs(attempt: number): number {
  return attempt < 10 ? 2000 : 5000;
}

export const INITIAL_PAYMENT_RETURN_STATE: PaymentReturnState = { kind: "resolving_context" };

/**
 * מעבר מצב יחיד, טהור - ללא side effects. אירוע שלא רלוונטי למצב הנוכחי (למשל MANUAL_RETRY
 * כשלא ב-timeout) **מוחזר כמו שהוא, ללא שינוי** - לא זורק חריגה. זה מגן, בין השאר, מפני תגובת
 * רשת מאוחרת שמגיעה אחרי שהמשתמש כבר עבר הלאה (למשל לחץ "בדוק שוב" בזמן שתשובת ה-polling
 * הקודמת עדיין "בדרך") - התוצאה המאוחרת פשוט לא עושה כלום, לא דורסת state חדש יותר.
 */
export function reducePaymentReturnState(state: PaymentReturnState, event: PaymentReturnEvent): PaymentReturnState {
  switch (event.type) {
    case "CONTEXT_FOUND":
      if (state.kind !== "resolving_context") return state;
      return { ...event.context, kind: "checking", attempt: 0 };

    case "CONTEXT_NOT_FOUND":
      if (state.kind !== "resolving_context") return state;
      return { kind: "unavailable" };

    case "ACCESS_ACTIVE":
      if (state.kind !== "checking") return state;
      return { ...extractContext(state), kind: "promoting" };

    case "ACCESS_UNAVAILABLE":
      if (state.kind !== "checking") return state;
      return { kind: "unavailable" };

    case "ACCESS_PENDING":
    case "ACCESS_RETRYABLE": {
      if (state.kind !== "checking") return state;
      const nextAttempt = state.attempt + 1;
      if (nextAttempt > MAX_POLL_ATTEMPTS) return { ...extractContext(state), kind: "timeout" };
      return { ...extractContext(state), kind: "pending", attempt: nextAttempt };
    }

    case "POLL_AGAIN":
      if (state.kind !== "pending") return state;
      return { ...extractContext(state), kind: "checking", attempt: state.attempt };

    case "PROMOTE_SUCCEEDED":
      if (state.kind !== "promoting") return state;
      return { kind: "redirecting", reportId: state.reportId, productType: state.productType };

    case "PROMOTE_FAILED":
      if (state.kind !== "promoting") return state;
      return { ...extractContext(state), kind: "storage_error" };

    case "MANUAL_RETRY":
      if (state.kind !== "timeout") return state;
      return { ...extractContext(state), kind: "checking", attempt: 0 };
  }
}

function extractContext(state: PaymentContext): PaymentContext {
  const { paymentContextId, reportId, productType, accessToken } = state;
  return { paymentContextId, reportId, productType, accessToken };
}

/**
 * מיפוי productType -> נתיב היעד אחרי entitlement פעיל (state "redirecting"). **פונקציה טהורה
 * נפרדת, לא switch מוטבע ב-React** - כדי שהמיפוי (ובפרט "אין מיפוי בטוח" ל-baseReport) יהיה
 * ניתן לבדיקה ישירה, בלי לרנדר את הרכיב.
 *
 * - trackingReports -> SITE_PATHS.tracking(reportId).
 * - cashFlowAnalysis -> SITE_PATHS.cashflow(reportId) - הנתיב **קיים במיפוי** לפי ההנחיה
 *   המפורשת ("מותר להשאיר את הנתיב במיפוי"), אך `app/cashflow/page.tsx` **לא** קיים בענף הזה -
 *   route "מת" בפועל, מתועד ולא טעות (ר' lib/site.ts).
 * - baseReport -> `{ kind: "unmapped" }` **במפורש** - baseReport עדיין לא עובר דרך מנגנון
 *   ה-entitlement המאובטח הזה בפועל (עדיין המודל הישן, `?paid=true` + קישור Cardcom קבוע,
 *   ר' PRODUCT_CATALOG_AUDIT.md/blocker `baseReport` בדוחות ה-commit הקודמים) - אין עדיין נתיב
 *   "אחרי entitlement מאובטח" מוגדר עבורו. **לא מנחשים** (calculator? report? עם איזה query
 *   string?) - הרכיב React מציג הודעה כללית ל-unmapped, לא מפנה לשום מקום שגוי.
 */
export type ProductRedirectTarget = { kind: "path"; path: string } | { kind: "unmapped" };

export function resolveProductRedirectPath(productType: ProductType, reportId: string): ProductRedirectTarget {
  switch (productType) {
    case "trackingReports":
      return { kind: "path", path: SITE_PATHS.tracking(reportId) };
    case "cashFlowAnalysis":
      return { kind: "path", path: SITE_PATHS.cashflow(reportId) };
    case "baseReport":
      return { kind: "unmapped" };
  }
}

/** קריאת ReturnValue מ-querystring, **case-insensitive** (תיעוד Cardcom הרשמי מציג דוגמה עם
 *  casing לא-עקבי, terminalnumber/lowprofilecode). מחזירה `null` אם אין שום מפתח שתואם
 *  "returnvalue" בהתעלמות מרישיות, או אם ערכו ריק. */
export function extractReturnValue(search: string): string | null {
  const params = new URLSearchParams(search);
  for (const [key, value] of params.entries()) {
    if (key.toLowerCase() === "returnvalue" && value.length > 0) return value;
  }
  return null;
}
