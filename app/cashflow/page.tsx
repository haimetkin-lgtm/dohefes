"use client";

// שער הרשאה + שלד בלבד ל-cashFlowAnalysis (ר' GEN2_CASHFLOW_UI_DESIGN.md §0.1.5/§10) - **לא**
// טופס התזרים המלא. תפקידו היחיד כרגע: לקבוע אם יש הרשאה תקפה (מול השרת, לא רק לפי אחסון
// מקומי - כלל 5, "אין להסתמך על עצם קיום token מקומי כהוכחת הרשאה"), ולתווך רכישה חדשה.
//
// **אין קישור לעמוד הזה משום מקום עדיין** (לא מ-/calculator, לא מ-/report) - בכוונה, כדי
// שהראוט הלא-מחובר לא ייחשף ללקוחות לפני פריסת ה-Edge Functions.

import { useEffect, useState } from "react";
import { supabase, supabaseConfigured, CASHFLOW_ANALYSIS_PRICE_NIS } from "@/lib/supabase";
import { generateIdempotencyKey, getProductAccess, purchaseProduct } from "@/lib/payment/payment-client";
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
  /** create-payment-order מחזירה "paid" בלי שיש לנו productAccess מקומי - קורה כשההזמנה כבר
   *  שולמה במלואה במכשיר/דפדפן אחר, או שרשומת ה-pending המקומית פגה (TTL) לפני שחזרה מ-Cardcom
   *  הושלמה. **אין דרך לשחזר את ה-access token האבוד** (רק hash שלו נשמר בשרת, לא הערך הגולמי -
   *  ר' §0.1.5ז) - זו בדיוק המגבלה המתועדת "אין שחזור אוטומטי במכשיר אחר", לא תקלה לתקן כאן. */
  | { kind: "already_paid_elsewhere" };

/**
 * **חייבת לרוץ בתוך effect, לא כ-lazy useState initializer** - reportId/localStorage לא ידועים
 * בזמן ה-prerender של static export (`window` לא קיים שם), כך שחישוב synchronous-during-render
 * שתלוי בהם היה מייצר HTML שונה בין השרת ללקוח (hydration mismatch אמיתי - נבדק ותוקן בפועל,
 * לא תיאורטי). לכן ה-state ההתחלתי הוא קבוע זהה תמיד ("checking_access"), וההחלטה בפועל קורית
 * כאן - **אותו דפוס בדיוק** כמו app/report/page.tsx ו-app/tracking/page.tsx הקיימים (setState
 * סינכרוני בגוף effect לקריאת URL/storage, שם accepted-baseline מתועד ב-eslint - ר' דוח ה-commit).
 */
export default function CashflowGatePage() {
  const [state, setState] = useState<PageState>({ kind: "checking_access" });
  const [reportId, setReportId] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id || !UUID_PATTERN.test(id) || !supabaseConfigured) {
      setState({ kind: "invalid_report" });
      return;
    }
    setReportId(id);

    const active = resolveActiveAccess(window.localStorage, id, PRODUCT_TYPE);
    if (active) {
      // כלל 5: token מקומי הוא רק "מועמד" - תמיד מאמתים מחדש מול השרת, לא מסתפקים בקיומו.
      getProductAccess(supabase.functions, { reportId: id, productType: PRODUCT_TYPE, accessToken: active.accessToken }).then((result) => {
        if (result.kind === "active") {
          touchActiveAccess(window.localStorage, id, PRODUCT_TYPE, new Date());
          setState({ kind: "active" });
        } else if (result.kind === "retryable") {
          // תקלת רשת/Function לא זמינה - **לא** שקול ל-revoked, לא מוחקים credential על בסיס
          // תקלה חולפת.
          setState({ kind: "function_unavailable" });
        } else {
          // unavailable, pending סותר, או error מבני - כולם מטופלים כאובדן הרשאה, כלל 4.
          revokeActiveAccess(window.localStorage, id, PRODUCT_TYPE);
          setState({ kind: "revoked" });
        }
      });
      return;
    }

    const pending = resolvePendingByReportAndProduct(window.localStorage, id, PRODUCT_TYPE, new Date());
    if (pending.ok) {
      setState({ kind: "pending_checkout", paymentContextId: pending.paymentContextId });
      return;
    }

    setState({ kind: "not_purchased" });
  }, []);

  // ניווט בפועל ל-checkout - effect נפרד, לא מתוך handlePurchase ישירות (מוטציה של window.location
  // מחוץ לרכיב "מחוץ לגבולות render" - התבנית המומלצת היא effect, כמו ב-app/payment-return).
  useEffect(() => {
    if (!redirectUrl) return;
    window.location.href = redirectUrl;
  }, [redirectUrl]);

  async function handlePurchase() {
    if (!reportId) return;
    const key = idempotencyKey ?? generateIdempotencyKey();
    setIdempotencyKey(key);
    setState({ kind: "purchasing" });

    const result = await purchaseProduct(supabase.functions, window.localStorage, { reportId, productType: PRODUCT_TYPE, idempotencyKey: key }, new Date());

    if (result.kind === "redirect") {
      setRedirectUrl(result.checkoutUrl);
      return;
    }
    if (result.kind === "already_paid") {
      // אין לנו productAccess מקומי (אחרת לא היינו מגיעים לפעולת רכישה בכלל) - אין access token
      // זמין לבדוק אותו מולו. לא ממציאים token/מנחשים - ר' הערת already_paid_elsewhere.
      setState({ kind: "already_paid_elsewhere" });
      return;
    }
    if (result.kind === "storage_failed") {
      setIdempotencyKey(null); // ניסיון חדש (לא אותו attempt) - הפעולה נכשלה לגמרי, לא retry על אותה בקשה
      setState({ kind: "purchase_error", message: "לא הצלחנו לשמור את פרטי הרכישה במכשיר הזה. נסה שוב, או נקה מקום אחסון בדפדפן." });
      return;
    }
    if (result.kind === "retryable") {
      // אותו idempotencyKey נשמר (state לא מתאפס) - ניסיון חוזר הוא **אותה** בקשה, לא חדשה.
      setState({ kind: "purchase_error", message: "אירעה תקלה זמנית. אפשר לנסות שוב." });
      return;
    }
    setIdempotencyKey(null);
    const friendly = result.reason === "report_not_eligible" ? "יש לרכוש קודם את דוח הכדאיות הבסיסי לפרויקט הזה." : "לא ניתן להשלים את הרכישה כרגע.";
    setState({ kind: "purchase_error", message: friendly });
  }

  return (
    <main className="max-w-lg mx-auto px-4 py-16 text-center">
      <div role="status" aria-live="polite">
        {renderState(state, handlePurchase)}
      </div>
    </main>
  );
}

function renderState(state: PageState, onPurchase: () => void) {
  switch (state.kind) {
    case "invalid_report":
      return (
        <>
          <p className="text-gray-700 mb-4">לא נמצא דוח מתאים. יש להגיע לעמוד הזה מתוך דוח קיים.</p>
          <a href="/dohefes/calculator/" className="text-[#1D6F42] underline text-sm">
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
          <p className="text-sm text-gray-500 mb-4">אפשר לבדוק את הסטטוס שלה במקום להתחיל רכישה חדשה.</p>
          <a
            href={`/dohefes/payment-return/?ReturnValue=${encodeURIComponent(state.paymentContextId)}&outcome=success`}
            className="inline-block bg-[#1D6F42] hover:bg-[#14502F] text-white font-medium text-sm px-5 py-2.5 rounded-lg transition-colors"
          >
            בדיקת סטטוס הרכישה ←
          </a>
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
          <a href="/dohefes/calculator/" className="text-[#1D6F42] underline text-sm">
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
