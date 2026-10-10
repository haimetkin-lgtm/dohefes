"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { DealType, ProjectInputs, ProjectResult } from "@/lib/calc/types";
import { generateIdempotencyKey } from "@/lib/payment/payment-client";
import { storeActiveAccess } from "@/lib/payment/payment-storage";
import { saveReport } from "@/lib/payment/report-client";
import { SITE_PATHS } from "@/lib/site";
import {
  describeSubscriptionError, getMySubscriptions, onlyDohefes, openSubscriberReport, rememberNext, useSession,
  usableDohefesSubscription, type MySubscription,
} from "@/lib/subscriptions";

// מפתח ה-idempotency של פתיחה שעדיין לא הסתיימה. נשמר ב-sessionStorage כדי שניסיון חוזר (גם אחרי רענון, אם התשובה
// אבדה) ישתמש באותו מפתח ולא ינצל יחידת מכסה נוספת. נמחק בהצלחה או בשגיאה סופית.
const PENDING_KEY = "dohefes.pendingSubscriberOpen";
const FINAL_ERRORS = new Set(["quota_exceeded", "no_subscription", "invalid_request", "login_required"]);

function pendingKey(): string {
  try {
    const existing = sessionStorage.getItem(PENDING_KEY);
    if (existing) return existing;
    const fresh = generateIdempotencyKey();
    sessionStorage.setItem(PENDING_KEY, fresh);
    return fresh;
  } catch {
    return generateIdempotencyKey();
  }
}

function clearPendingKey() {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {}
}

interface Props {
  dealType: DealType;
  inputs: ProjectInputs;
  result: ProjectResult;
  onOpened: (reportId: string, baseReportToken: string) => void;
}

// במחשבון החופשי: מי שמחובר עם מנוי פעיל יכול לפתוח את הפרויקט כדוח שמור על חשבון המנוי. ההרשאה והמכסה נקבעות בשרת,
// והפאנל רק מציג מצב ושולח בקשה. הייצוא נפתח רק אחרי שהשרת החזיר הרשאה והדוח נטען איתה, כמו אחרי תשלום.
export default function SubscriberPanel({ dealType, inputs, result, onOpened }: Props) {
  const { session, loading } = useSession();
  const [loaded, setLoaded] = useState<{ uid: string; subs: MySubscription[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const uid = session?.user.id ?? null;
  const subs = uid && loaded?.uid === uid ? loaded.subs : null;

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    getMySubscriptions().then((list) => {
      if (!cancelled) setLoaded({ uid, subs: onlyDohefes(list) });
    });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  async function open() {
    if (!session || busy) return;
    setBusy(true);
    setError(null);
    try {
      const opened = await openSubscriberReport(session.access_token, dealType, pendingKey());
      const now = new Date();
      const base = storeActiveAccess(window.localStorage, opened.reportId, "baseReport", opened.baseReportToken, now);
      storeActiveAccess(window.localStorage, opened.reportId, "trackingReports", opened.trackingToken, now);
      if (!base.ok) {
        // הדוח נפתח אבל אי אפשר לשמור את הגישה בדפדפן. ניסיון חוזר עם אותו מפתח מנפיק אסימון חדש בלי לנצל מכסה.
        setError("הדוח נפתח, אבל לא הצלחנו לשמור את הגישה אליו בדפדפן הזה. בדקו שהאחסון בדפדפן פתוח ונסו שוב, המכסה לא תנוצל פעם נוספת.");
        setBusy(false);
        return;
      }
      clearPendingKey();
      // שמירה ראשונה של מה שהוזן. אם נכשלה, השמירה האוטומטית של העמוד תנסה שוב.
      await saveReport(supabase.functions, {
        reportId: opened.reportId,
        accessToken: opened.baseReportToken,
        inputs,
        results: result,
      });
      onOpened(opened.reportId, opened.baseReportToken);
    } catch (e) {
      const code = (e as Error).message;
      if (FINAL_ERRORS.has(code)) {
        clearPendingKey();
        getMySubscriptions().then((list) => alive.current && setLoaded({ uid: session.user.id, subs: onlyDohefes(list) }));
      }
      setError(describeSubscriptionError(code));
      setBusy(false);
    }
  }

  const box = "rounded-xl border px-4 py-3 mb-4 text-sm";

  if (loading) return null;

  if (!session) {
    return (
      <div className={`${box} bg-[#EAF3EC] border-[#BFE0CC] text-[#14502F]`}>
        <strong>יש לכם מנוי?</strong> התחברו כדי לשמור ולייצא על חשבון המנוי, בלי תשלום נוסף על הדוח.
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          <a
            href={SITE_PATHS.login}
            onClick={() => rememberNext("/calculator/")}
            className="font-medium underline"
          >
            כניסת מנויים
          </a>
          <a href={SITE_PATHS.subscribe} className="font-medium underline">
            רכישת מנוי
          </a>
        </div>
        <p className="mt-2 text-[11px] text-gray-500">הנתונים שהוזנו במחשבון לא נשמרים במעבר לדף הכניסה.</p>
      </div>
    );
  }

  if (subs === null) return <div className={`${box} bg-white border-gray-200 text-gray-500`}>בודקים את המנוי...</div>;

  const usable = usableDohefesSubscription(subs);
  if (usable) {
    const left = usable.checks_per_month - usable.usage_checks;
    return (
      <div className={`${box} bg-[#EAF3EC] border-[#BFE0CC] text-[#14502F]`}>
        <div>
          <strong>יש לכם מנוי פעיל.</strong> נותרו {left} מתוך {usable.checks_per_month} פרויקטים החודש.
        </div>
        <p className="text-xs text-gray-600 mt-1">
          פתיחה על חשבון המנוי שומרת את הפרויקט בקישור קבוע, ופותחת ייצוא Excel, הדפסה ומעקב בנייה לפרויקט הזה, בלי הגבלה.
        </p>
        {error && <p className="text-sm text-[#8a2f22] mt-2">{error}</p>}
        <button
          type="button"
          onClick={open}
          disabled={busy}
          className="mt-3 bg-[#1D6F42] hover:bg-[#14502F] disabled:opacity-50 disabled:cursor-default text-white font-medium text-sm px-4 py-2 rounded-lg cursor-pointer transition-colors"
        >
          {busy ? "פותח את הפרויקט..." : "שמירה וייצוא על חשבון המנוי (ינצל פרויקט אחד)"}
        </button>
      </div>
    );
  }

  if (subs.length > 0) {
    return (
      <div className={`${box} bg-amber-50 border-amber-200 text-amber-900`}>
        המכסה החודשית של המנוי נוצלה והיא מתחדשת בראשון לכל חודש. בינתיים אפשר לרכוש דוח בודד דרך{" "}
        <a href="/dohefes/start/" className="underline">
          עמוד ההזמנה
        </a>
        , או לצפות ב<a href={SITE_PATHS.account} className="underline">אזור האישי</a>.
      </div>
    );
  }

  return (
    <div className={`${box} bg-white border-gray-200 text-gray-600`}>
      מחוברים כ-<span dir="ltr">{session.user.email}</span>, ואין בחשבון מנוי פעיל לדוחות אפס.{" "}
      <a href={SITE_PATHS.subscribe} className="text-[#1D6F42] underline font-medium">
        לצפייה בחבילות
      </a>
    </div>
  );
}
