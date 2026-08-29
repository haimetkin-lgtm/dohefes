"use client";

// עמוד החזרה מ-Cardcom (SuccessRedirectUrl/ErrorRedirectUrl) לכל מוצר שעובר דרך מנגנון
// התשלום המאובטח לכל מוצרי הקטלוג, כולל baseReport. כל
// לוגיקת המעברים חיה ב-state machine טהורה נפרדת (lib/payment/payment-return-state.ts, נבדקת
// בעצמה) - הקומפוננטה הזו רק מריצה side effects (storage/רשת/timers/ניווט) לפי ה-state
// הנוכחי, ומציירת טקסט.
//
// **outcome=success|cancelled הוא רמז ניסוח בלבד** - נקרא פעם אחת לבחירת הטקסט הראשוני, אף
// פעם לא נבדק כדי להחליט מה קרה בפועל. השלב הראשון תמיד שולח לבדיקה אמיתית מול
// dohefes-get-product-access.
//
// **מקור: reconciliation מול gen2-cashflow-ui-implementation (Commit 5b)** - הובא כמעט כמות
// שהוא, עם שינוי אחד מכוון: שלב 5 (redirecting) מפנה כעת **לפי productType**
// (resolveProductRedirectPath), לא ל-/cashflow תמיד.

import { useEffect, useReducer } from "react";
import type { Dispatch } from "react";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { SITE_PATHS } from "@/lib/site";
import { getProductAccess } from "@/lib/payment/payment-client";
import { promoteToActive, resolvePendingByContext, revokeActiveAccess } from "@/lib/payment/payment-storage";
import {
  INITIAL_PAYMENT_RETURN_STATE,
  extractReturnValue,
  nextPollDelayMs,
  reducePaymentReturnState,
  resolveProductRedirectPath,
} from "@/lib/payment/payment-return-state";

/** קריאה סינכרונית טהורה במהלך render עצמו - לא ref, לא state - כדי לא להפר את חוקי React
 *  (אין setState/גישה ל-ref בזמן render). בטוח מול static export: `typeof window` שומר על
 *  build-time prerender (בלי window בכלל) מלהתרסק - שם פשוט מוחזר null, וה-hydration בדפדפן
 *  האמיתי מחשב את הערך הנכון באותה קריאה. */
function readOutcomeHint(): "success" | "cancelled" | null {
  if (typeof window === "undefined") return null;
  const outcomeParam = new URLSearchParams(window.location.search).get("outcome");
  return outcomeParam === "success" || outcomeParam === "cancelled" ? outcomeParam : null;
}

export default function PaymentReturnPage() {
  const [state, dispatch] = useReducer(reducePaymentReturnState, INITIAL_PAYMENT_RETURN_STATE);
  const outcomeHint = readOutcomeHint();

  // שלב 1: איתור ה-pending המקומי לפי ReturnValue מה-URL - פעם אחת, בעת טעינת הדף. **אין ניחוש
  // "ההזמנה האחרונה"** - אם אין ReturnValue תואם או pending תואם לו, המצב הוא CONTEXT_NOT_FOUND
  // (-> unavailable), לא בחירה שרירותית מתוך מה שקיים ב-localStorage.
  useEffect(() => {
    const search = window.location.search;

    if (!supabaseConfigured) {
      dispatch({ type: "CONTEXT_NOT_FOUND" });
      return;
    }

    const returnValue = extractReturnValue(search);
    if (!returnValue) {
      dispatch({ type: "CONTEXT_NOT_FOUND" });
      return;
    }

    const pending = resolvePendingByContext(window.localStorage, returnValue, new Date());
    if (!pending) {
      dispatch({ type: "CONTEXT_NOT_FOUND" });
      return;
    }

    dispatch({
      type: "CONTEXT_FOUND",
      context: { paymentContextId: returnValue, reportId: pending.reportId, productType: pending.productType, accessToken: pending.accessToken },
    });
  }, []);

  // שלב 2: בכל כניסה ל-checking - קריאה אמיתית ל-dohefes-get-product-access (הוכחת תשלום
  // היחידה - לא נגזר מ-outcome ב-URL). outcome שאינו active **לא מוחק credential** מלבד
  // unavailable/error מבני, שבהם revokeActiveAccess מנקה entitlement מקומי לא-תקף במפורש.
  useEffect(() => {
    if (state.kind !== "checking") return;
    let cancelled = false;
    const { reportId, productType, accessToken } = state;

    getProductAccess(supabase.functions, { reportId, productType, accessToken }).then((result) => {
      if (cancelled) return;
      if (result.kind === "active") {
        dispatch({ type: "ACCESS_ACTIVE" });
      } else if (result.kind === "pending") {
        dispatch({ type: "ACCESS_PENDING" });
      } else if (result.kind === "retryable") {
        dispatch({ type: "ACCESS_RETRYABLE" });
      } else {
        // unavailable, או error מבני (תשובה לא תקינה) - שתיהן מטופלות זהה: הודעה גנרית, בלי
        // להבחין ללקוח מה בדיוק קרה.
        revokeActiveAccess(window.localStorage, reportId, productType);
        dispatch({ type: "ACCESS_UNAVAILABLE" });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [state]);

  // שלב 3: בכניסה ל-promoting - מעבר בפועל מ-pending ל-productAccess (סדר פעולות אכוף בתוך
  // promoteToActive - כתיבה ל-productAccess **לפני** מחיקת ה-pending, לא ההפך).
  useEffect(() => {
    if (state.kind !== "promoting") return;
    const result = promoteToActive(window.localStorage, state.paymentContextId, new Date());
    dispatch({ type: result.ok ? "PROMOTE_SUCCEEDED" : "PROMOTE_FAILED" });
  }, [state]);

  // שלב 4: בכניסה ל-pending - שידול הבדיקה הבאה עם backoff.
  useEffect(() => {
    if (state.kind !== "pending") return;
    const timer = window.setTimeout(() => dispatch({ type: "POLL_AGAIN" }), nextPollDelayMs(state.attempt));
    return () => window.clearTimeout(timer);
  }, [state]);

  // שלב 5: redirecting - ניווט בפועל למוצר **לפי productType**, בלי שום דגל/token ב-URL.
  useEffect(() => {
    if (state.kind !== "redirecting") return;
    const target = resolveProductRedirectPath(state.productType, state.reportId);
    if (target.kind === "path") {
      window.location.replace(target.path);
    }
    // kind==="unmapped" נשמר כהגנת-עומק למוצר עתידי ללא יעד.
  }, [state]);

  return (
    <main className="max-w-lg mx-auto px-4 py-16 text-center">
      <div role="status" aria-live="polite">
        {renderByState(state, dispatch, outcomeHint)}
      </div>
    </main>
  );
}

function renderByState(
  state: ReturnType<typeof reducePaymentReturnState>,
  dispatch: Dispatch<Parameters<typeof reducePaymentReturnState>[1]>,
  outcomeHint: "success" | "cancelled" | null
) {
  switch (state.kind) {
    case "resolving_context":
      return <p className="text-gray-500 text-sm">טוען...</p>;

    case "checking":
    case "pending":
    case "promoting":
      return (
        <>
          <p className="text-[#14502F] font-bold mb-2">
            {outcomeHint === "cancelled" ? "בודקים את סטטוס התשלום..." : "מאמתים את התשלום..."}
          </p>
          <p className="text-sm text-gray-500">זה עשוי לקחת עד כדקה. אין צורך לרענן את הדף.</p>
        </>
      );

    case "redirecting": {
      const target = resolveProductRedirectPath(state.productType, state.reportId);
      if (target.kind === "unmapped") {
        // baseReport - אין עדיין נתיב "אחרי entitlement מאובטח" מוגדר (המודל הישן עדיין
        // בשימוש, ר' ההערה ב-payment-return-state.ts). הודעה כללית, לא redirect שגוי.
        return (
          <>
            <p className="text-[#14502F] font-bold mb-2">התשלום אושר</p>
            <p className="text-sm text-gray-500">
              נא לפנות לדף הדוח שלך ישירות, או ליצור קשר אם הקישור אינו זמין.
            </p>
          </>
        );
      }
      return <p className="text-[#14502F] font-bold">התשלום אושר, מעבירים אותך למוצר...</p>;
    }

    case "timeout":
      return (
        <>
          <p className="text-[#14502F] font-bold mb-2">עדיין מעבדים את התשלום</p>
          <p className="text-sm text-gray-500 mb-4">זה יכול לקחת כמה דקות. אפשר לבדוק שוב עכשיו.</p>
          <button
            type="button"
            onClick={() => dispatch({ type: "MANUAL_RETRY" })}
            className="bg-[#1D6F42] hover:bg-[#14502F] focus-visible:ring-2 focus-visible:ring-[#1D6F42] focus-visible:outline-none text-white font-medium text-sm px-5 py-2.5 rounded-lg transition-colors"
          >
            בדוק שוב
          </button>
        </>
      );

    case "storage_error":
      return (
        <>
          <p className="text-[#14502F] font-bold mb-2">התשלום אושר, אך הייתה תקלה זמנית בשמירת הגישה</p>
          <p className="text-sm text-gray-500 mb-4">רענון הדף אמור לפתור את זה.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="bg-[#1D6F42] hover:bg-[#14502F] focus-visible:ring-2 focus-visible:ring-[#1D6F42] focus-visible:outline-none text-white font-medium text-sm px-5 py-2.5 rounded-lg transition-colors"
          >
            רענון הדף
          </button>
        </>
      );

    case "unavailable":
      return (
        <>
          <p className="text-gray-700 mb-4">לא הצלחנו לאמת רכישה. אם ביצעת תשלום, נסה לרענן בעוד רגע.</p>
          <a href={SITE_PATHS.calculator} className="text-[#1D6F42] underline text-sm">
            חזרה לדוח ←
          </a>
        </>
      );
  }
}
