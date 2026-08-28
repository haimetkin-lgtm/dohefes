"use client";

// שער הרשאה + שלד בלבד ל-cashFlowAnalysis (ר' GEN2_CASHFLOW_UI_DESIGN.md §0.1.5/§10) - **לא**
// טופס התזרים המלא. תפקידו היחיד כרגע: לקבוע אם יש הרשאה תקפה (מול השרת, לא רק לפי אחסון
// מקומי - כלל 5, "אין להסתמך על עצם קיום token מקומי כהוכחת הרשאה"), ולתווך רכישה חדשה.
//
// **אין קישור לעמוד הזה משום מקום עדיין** (לא מ-/calculator, לא מ-/report) - בכוונה, כדי
// שהראוט הלא-מחובר לא ייחשף ללקוחות לפני פריסת ה-Edge Functions.

import { useEffect, useState, useSyncExternalStore } from "react";
import { supabase, supabaseConfigured, CASHFLOW_ANALYSIS_PRICE_NIS } from "@/lib/supabase";
import { SITE_PATHS } from "@/lib/site";
import { generateIdempotencyKey, getProductAccess, purchaseProduct, resumePendingCheckout } from "@/lib/payment/payment-client";
import { resolveActiveAccess, resolvePendingByReportAndProduct, revokeActiveAccess, touchActiveAccess } from "@/lib/payment/payment-storage";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCT_TYPE = "cashFlowAnalysis";

type PageState =
  | { kind: "invalid_report" }
  | { kind: "checking_access" }
  | { kind: "not_purchased" }
  | { kind: "pending_checkout"; paymentContextId: string }
  | { kind: "active" }
  | { kind: "revoked" }
  | { kind: "function_unavailable" }
  | { kind: "purchasing" }
  | { kind: "purchase_error"; message: string }
  | { kind: "resuming" }
  | { kind: "resume_error"; message: string; paymentContextId: string }
  /** create-payment-order מחזירה "paid" בלי שיש לנו productAccess מקומי - קורה כשההזמנה כבר
   *  שולמה במלואה במכשיר/דפדפן אחר, או שרשומת ה-pending המקומית פגה (TTL) לפני שחזרה מ-Cardcom
   *  הושלמה. **אין דרך לשחזר את ה-access token האבוד** (רק hash שלו נשמר בשרת, לא הערך הגולמי -
   *  ר' §0.1.5ז) - זו בדיוק המגבלה המתועדת "אין שחזור אוטומטי במכשיר אחר", לא תקלה לתקן כאן. */
  | { kind: "already_paid_elsewhere" };

// ---------- קריאת reportId מה-URL, hydration-safe (useSyncExternalStore) ----------
//
// **למה לא effect+setState (כפי שנעשה בגרסה קודמת)**: reportId/localStorage לא ידועים בזמן
// ה-prerender של static export (window לא קיים שם) - חישוב synchronous-during-render שתלוי
// בהם היה מייצר HTML שונה בין השרת ללקוח (hydration mismatch אמיתי - נבדק ותוקן בפועל, לא
// תיאורטי, ר' דוח ה-commit). effect+setState "פותר" את זה (app/report, app/tracking הקיימים)
// אך פוגע ב-react-hooks/set-state-in-effect - נבדק ישירות: **גם setState לא-מותנה לגמרי (כמו
// דגל "mounted" ריק) עדיין מסומן**, אז זו לא רק שאלה של תנאי בגוף ה-effect.
// **הפתרון**: useSyncExternalStore - ה-hook הרשמי של React בדיוק למקרה הזה. getServerSnapshot
// (undefined, "עוד לא ידוע") משמש גם ל-SSR וגם לפאס ההידרציה הראשון בדפדפן (זהים - אין mismatch),
// ורק אחרי שההידרציה הושלמה React מסנכרן ל-getSnapshot האמיתי (מ-window.location.search) ומרנדר
// מחדש. undefined="עוד לא ידוע" (תואם-SSR) מובחן במפורש מ-null="נקבע כלא-תקין" - לא אותו ערך.
let cachedSearch: string | undefined;
let cachedReportId: string | null | undefined;

function getClientReportIdSnapshot(): string | null | undefined {
  const search = window.location.search;
  if (cachedSearch === search) return cachedReportId;
  cachedSearch = search;
  const id = new URLSearchParams(search).get("id");
  cachedReportId = id && UUID_PATTERN.test(id) && supabaseConfigured ? id : null;
  return cachedReportId;
}

function getServerReportIdSnapshot(): string | null | undefined {
  return undefined;
}

function subscribeReportId(): () => void {
  // window.location.search לא משתנה בלי remount מלא של העמוד (אין ניווט פנימי בעמוד הזה) - אין
  // מקור אמיתי להירשם אליו, ה-snapshot מחושב מחדש ממילא בכל render.
  return () => {};
}

/** מחושב ישירות ב-render, **לא** effect - בטוח מבחינת hydration כי הוא נגזר מ-reportId שכבר
 *  hydration-safe: ב-render הראשון (גם בשרת וגם בפאס ההידרציה הראשון בדפדפן) reportId===undefined
 *  ותמיד יחזיר "checking_access" משני הצדדים - אין הבדל. רק אחרי שה-reportId מסתנכרן לערך
 *  האמיתי (render שני, אחרי הידרציה) הפונקציה הזו נוגעת בכלל ב-localStorage - render צד-לקוח
 *  טהור, לא מושווה יותר מול HTML של השרת. */
function computeSyncPageState(reportId: string | null | undefined): PageState {
  if (reportId === undefined) return { kind: "checking_access" };
  if (reportId === null) return { kind: "invalid_report" };

  if (resolveActiveAccess(window.localStorage, reportId, PRODUCT_TYPE)) return { kind: "checking_access" };

  const pending = resolvePendingByReportAndProduct(window.localStorage, reportId, PRODUCT_TYPE, new Date());
  if (pending.ok) return { kind: "pending_checkout", paymentContextId: pending.paymentContextId };

  return { kind: "not_purchased" };
}

export default function CashflowGatePage() {
  const reportId = useSyncExternalStore(subscribeReportId, getClientReportIdSnapshot, getServerReportIdSnapshot);
  const [asyncState, setAsyncState] = useState<PageState | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);

  const state = asyncState ?? computeSyncPageState(reportId);

  // אימות רשת אמיתי מול dohefes-get-product-access, רק אם יש productAccess מקומי לאמת (כלל 5) -
  // כל ה-setState כאן קורים בתוך .then(), לא סינכרונית בגוף האפקט.
  useEffect(() => {
    if (!reportId) return;
    if (asyncState) return; // כבר במצב override (פעולת משתמש/תוצאה קודמת) - לא לדרוס
    const active = resolveActiveAccess(window.localStorage, reportId, PRODUCT_TYPE);
    if (!active) return;

    let cancelled = false;
    getProductAccess(supabase.functions, { reportId, productType: PRODUCT_TYPE, accessToken: active.accessToken }).then((result) => {
      if (cancelled) return;
      if (result.kind === "active") {
        touchActiveAccess(window.localStorage, reportId, PRODUCT_TYPE, new Date());
        setAsyncState({ kind: "active" });
      } else if (result.kind === "retryable") {
        // תקלת רשת/Function לא זמינה - **לא** שקול ל-revoked, לא מוחקים credential על בסיס
        // תקלה חולפת.
        setAsyncState({ kind: "function_unavailable" });
      } else {
        // unavailable, pending סותר, או error מבני - כולם מטופלים כאובדן הרשאה, כלל 4.
        revokeActiveAccess(window.localStorage, reportId, PRODUCT_TYPE);
        setAsyncState({ kind: "revoked" });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [reportId, asyncState]);

  // ניווט בפועל ל-checkout - effect נפרד, לא מתוך handlePurchase/handleResume ישירות (מוטציה של
  // window.location מחוץ לגבולות render - התבנית המומלצת היא effect, כמו ב-app/payment-return).
  useEffect(() => {
    if (!redirectUrl) return;
    window.location.href = redirectUrl;
  }, [redirectUrl]);

  async function handlePurchase() {
    if (!reportId) return;
    const key = idempotencyKey ?? generateIdempotencyKey();
    setIdempotencyKey(key);
    setAsyncState({ kind: "purchasing" });

    const result = await purchaseProduct(supabase.functions, window.localStorage, { reportId, productType: PRODUCT_TYPE, idempotencyKey: key }, new Date());

    if (result.kind === "redirect") {
      setRedirectUrl(result.checkoutUrl);
      return;
    }
    if (result.kind === "already_paid") {
      // אין לנו productAccess מקומי (אחרת לא היינו מגיעים לפעולת רכישה בכלל) - אין access token
      // זמין לבדוק אותו מולו. לא ממציאים token/מנחשים - ר' הערת already_paid_elsewhere.
      setAsyncState({ kind: "already_paid_elsewhere" });
      return;
    }
    if (result.kind === "storage_failed") {
      setIdempotencyKey(null); // ניסיון חדש (לא אותו attempt) - הפעולה נכשלה לגמרי, לא retry על אותה בקשה
      setAsyncState({ kind: "purchase_error", message: "לא הצלחנו לשמור את פרטי הרכישה במכשיר הזה. נסה שוב, או נקה מקום אחסון בדפדפן." });
      return;
    }
    if (result.kind === "retryable") {
      // אותו idempotencyKey נשמר (state לא מתאפס) - ניסיון חוזר הוא **אותה** בקשה, לא חדשה.
      setAsyncState({ kind: "purchase_error", message: "אירעה תקלה זמנית. אפשר לנסות שוב." });
      return;
    }
    setIdempotencyKey(null);
    const friendly = result.reason === "report_not_eligible" ? "יש לרכוש קודם את דוח הכדאיות הבסיסי לפרויקט הזה." : "לא ניתן להשלים את הרכישה כרגע.";
    setAsyncState({ kind: "purchase_error", message: friendly });
  }

  /**
   * audit מחזור חיים: לפני הסבב הזה, "יש כבר רכישה בתהליך" הציע רק קישור ל-"בדיקת סטטוס" -
   * משתמש שיצא מ-Cardcom לפני תשלום (חזרה אחורה/סגירת טאב) היה נתקע: לא יכול היה לחזור
   * ל-checkout הקיים, ולא יכול היה ליצור הזמנה חדשה (ה-partial unique index בשרת חוסם הזמנה
   * שנייה לאותו report+product כל עוד יש אחת פעילה). resumePendingCheckout מתקן את זה - בודקת
   * מול השרת, ורק אם באמת יש ספק לגבי תקפות הקישור השמור, מחדשת עם **אותו** idempotencyKey.
   */
  async function handleResume(paymentContextId: string) {
    setAsyncState({ kind: "resuming" });
    const result = await resumePendingCheckout(supabase.functions, window.localStorage, paymentContextId, new Date());

    if (result.kind === "redirect") {
      setRedirectUrl(result.checkoutUrl);
      return;
    }
    if (result.kind === "already_active") {
      setAsyncState({ kind: "active" });
      return;
    }
    if (result.kind === "not_found") {
      // ה-pending פג/נמחק בינתיים (TTL) - אין מה "לחדש", לא יוצרים הזמנה חדשה אוטומטית כאן -
      // חוזרים למסך רכישה רגיל, שממנו רכישה חדשה היא פעולה מפורשת ומודעת של המשתמש.
      setAsyncState({ kind: "not_purchased" });
      return;
    }
    if (result.kind === "storage_failed") {
      setAsyncState({ kind: "resume_error", message: "לא הצלחנו לעדכן את פרטי הרכישה במכשיר הזה. נסה שוב.", paymentContextId });
      return;
    }
    if (result.kind === "retryable") {
      setAsyncState({ kind: "resume_error", message: "אירעה תקלה זמנית. אפשר לנסות שוב.", paymentContextId });
      return;
    }
    setAsyncState({ kind: "resume_error", message: "לא ניתן להמשיך את הרכישה הזו כרגע.", paymentContextId });
  }

  return (
    <main className="max-w-lg mx-auto px-4 py-16 text-center">
      <div role="status" aria-live="polite">
        {renderState(state, handlePurchase, handleResume)}
      </div>
    </main>
  );
}

function renderState(state: PageState, onPurchase: () => void, onResume: (paymentContextId: string) => void) {
  switch (state.kind) {
    case "invalid_report":
      return (
        <>
          <p className="text-gray-700 mb-4">לא נמצא דוח מתאים. יש להגיע לעמוד הזה מתוך דוח קיים.</p>
          <a href={SITE_PATHS.calculator} className="text-[#1D6F42] underline text-sm">
            חזרה למחולל ←
          </a>
        </>
      );

    case "checking_access":
      return <p className="text-gray-500 text-sm">בודקים הרשאה...</p>;

    case "not_purchased":
      return (
        <>
          <h1 className="text-lg font-bold text-[#14502F] mb-2">ניתוח תזרים ומימון מתקדם</h1>
          <p className="text-sm text-gray-500 mb-6">
            מוצר נוסף - {CASHFLOW_ANALYSIS_PRICE_NIS.toLocaleString("he-IL")} ₪, תשלום חד פעמי.
          </p>
          <button
            type="button"
            onClick={onPurchase}
            className="bg-[#1D6F42] hover:bg-[#14502F] focus-visible:ring-2 focus-visible:ring-[#1D6F42] focus-visible:outline-none text-white font-bold px-6 py-3 rounded-lg transition-colors"
          >
            לרכישה ולהתחלת הניתוח - {CASHFLOW_ANALYSIS_PRICE_NIS.toLocaleString("he-IL")} ₪
          </button>
        </>
      );

    case "purchasing":
      return <p className="text-gray-500 text-sm">מעבירים אותך לתשלום...</p>;

    case "purchase_error":
      return (
        <>
          <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm">{state.message}</p>
          <button
            type="button"
            onClick={onPurchase}
            className="bg-[#1D6F42] hover:bg-[#14502F] focus-visible:ring-2 focus-visible:ring-[#1D6F42] focus-visible:outline-none text-white font-medium text-sm px-5 py-2.5 rounded-lg transition-colors"
          >
            נסה שוב
          </button>
        </>
      );

    case "pending_checkout":
      return (
        <>
          <p className="text-[#14502F] font-bold mb-2">יש כבר רכישה בתהליך</p>
          <p className="text-sm text-gray-500 mb-4">אפשר להמשיך אותה במקום להתחיל רכישה חדשה.</p>
          <button
            type="button"
            onClick={() => onResume(state.paymentContextId)}
            className="bg-[#1D6F42] hover:bg-[#14502F] focus-visible:ring-2 focus-visible:ring-[#1D6F42] focus-visible:outline-none text-white font-bold px-6 py-3 rounded-lg transition-colors"
          >
            המשך לתשלום
          </button>
        </>
      );

    case "resuming":
      return <p className="text-gray-500 text-sm">בודקים את הרכישה הקיימת...</p>;

    case "resume_error":
      return (
        <>
          <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm">{state.message}</p>
          <button
            type="button"
            onClick={() => onResume(state.paymentContextId)}
            className="bg-[#1D6F42] hover:bg-[#14502F] focus-visible:ring-2 focus-visible:ring-[#1D6F42] focus-visible:outline-none text-white font-medium text-sm px-5 py-2.5 rounded-lg transition-colors"
          >
            נסה שוב
          </button>
        </>
      );

    case "active":
      return (
        <>
          <h1 className="text-lg font-bold text-[#14502F] mb-2">ניתוח תזרים ומימון מתקדם</h1>
          <p className="text-sm text-gray-500 mb-4">ניתוח התזרים זמין - ממשק ההזנה יתווסף בשלב הבא.</p>
          <p className="text-xs text-gray-400">הגישה למוצר נשמרת בדפדפן הזה. מומלץ לא למחוק את נתוני האתר.</p>
        </>
      );

    case "revoked":
      return (
        <>
          <p className="text-gray-700 mb-4">אין כרגע גישה למוצר הזה.</p>
          <a href={SITE_PATHS.calculator} className="text-[#1D6F42] underline text-sm">
            חזרה לדוח ←
          </a>
        </>
      );

    case "function_unavailable":
      return <p className="text-gray-500 text-sm">אי אפשר לבדוק הרשאה כרגע. נסו לרענן בעוד רגע.</p>;

    case "already_paid_elsewhere":
      return (
        <>
          <p className="text-gray-700 mb-2">נראה שהמוצר הזה כבר נרכש, אך אין לו גישה שמורה בדפדפן הזה.</p>
          <p className="text-sm text-gray-500">
            אם רכשת ממכשיר אחר, יש להיעזר בקישור הגישה שקיבלת שם. לשאלות אפשר לפנות ב
            <a href="mailto:haimetkin@gmail.com" className="text-[#1D6F42] underline">
              מייל
            </a>
            .
          </p>
        </>
      );
  }
}
