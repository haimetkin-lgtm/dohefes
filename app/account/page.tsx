"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { listActiveReports, resolveActiveAccess } from "@/lib/payment/payment-storage";
import { SITE_PATHS } from "@/lib/site";
import {
  getMySubscriptions, onlyDohefes, setMembers, useSession, rememberNext, PLAN_NAMES, type MySubscription,
} from "@/lib/subscriptions";

const heDate = (iso: string) => new Date(iso).toLocaleDateString("he-IL");

function Meter({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
      <div className={`h-full ${pct >= 100 ? "bg-[#8a2f22]" : "bg-[#1D6F42]"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function Members({ sub, onSaved }: { sub: MySubscription; onSaved: () => void }) {
  const [text, setText] = useState((sub.members ?? []).join("\n"));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const extraSeats = sub.seats - 1;

  async function save() {
    const emails = Array.from(new Set(text.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)));
    setBusy(true);
    setMsg(null);
    const ok = await setMembers(sub.id, emails);
    setBusy(false);
    if (ok) {
      setMsg({ ok: true, text: "נשמר. כל משתמש ייכנס עם האימייל הזה ויעבוד על אותה מכסה משותפת." });
      onSaved();
    } else {
      setMsg({ ok: false, text: `לא נשמר. אפשר עד ${extraSeats} משתמשים נוספים, וכל כתובת חייבת להיות תקינה.` });
    }
  }

  return (
    <div className="mt-4 border-t border-gray-100 pt-4">
      <div className="text-sm font-medium text-[#14502F] mb-1">משתמשים נוספים במשרד (עד {extraSeats})</div>
      <p className="text-xs text-gray-500 mb-2">כתובת אימייל בכל שורה. כל משתמש צריך להירשם עם אותה כתובת ולאמת אותה.</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        dir="ltr"
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
        placeholder="name@example.com"
      />
      {msg && <p className={`text-sm mt-1 ${msg.ok ? "text-[#14502F]" : "text-[#8a2f22]"}`}>{msg.text}</p>}
      <button
        onClick={save}
        disabled={busy}
        className="mt-2 bg-[#1D6F42] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#14502F] disabled:opacity-50 cursor-pointer"
      >
        {busy ? "שומר..." : "שמירת משתמשים"}
      </button>
    </div>
  );
}

interface DeviceReport {
  reportId: string;
  activatedAt: string;
  hasTracking: boolean;
}

function readDeviceReports(): DeviceReport[] {
  try {
    return listActiveReports(window.localStorage, "baseReport").map((r) => ({
      ...r,
      hasTracking: resolveActiveAccess(window.localStorage, r.reportId, "trackingReports") !== null,
    }));
  } catch {
    return [];
  }
}

// הגישה לדוח נשמרת בדפדפן. כשהרשימה ריקה או שחסר דוח, צריך לפתוח אותו מאותו מכשיר ודפדפן שבו נפתח.
function DeviceReports({ reports }: { reports: DeviceReport[] }) {
  return (
    <div className="mt-6 bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      <h2 className="font-bold text-[#14502F] mb-1">הדוחות השמורים במכשיר הזה</h2>
      <p className="text-xs text-gray-500 mb-3">
        הגישה לדוח נשמרת בדפדפן שבו הוא נפתח. כדי לחזור אליו, היכנסו מאותו מכשיר ודפדפן, או שמרו את הקישור הקבוע.
      </p>
      {reports.length === 0 ? (
        <p className="text-sm text-gray-500">אין עדיין דוחות שמורים במכשיר הזה.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {reports.map((r) => (
            <li key={r.reportId} className="py-2.5 flex items-baseline justify-between gap-3 text-sm">
              <div>
                <a href={SITE_PATHS.calculatorReport(r.reportId)} className="text-[#1D6F42] underline font-medium">
                  פתיחת הדוח
                </a>
                <div className="text-xs text-gray-500">נפתח ב-{heDate(r.activatedAt)}</div>
              </div>
              {r.hasTracking && (
                <a href={SITE_PATHS.tracking(r.reportId)} className="text-xs text-[#1D6F42] underline whitespace-nowrap">
                  מעקב בנייה
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AccountPage() {
  const router = useRouter();
  const { session, loading } = useSession();
  const [subs, setSubs] = useState<MySubscription[] | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const polls = useRef(0);
  const [deviceReports, setDeviceReports] = useState<DeviceReport[]>([]);

  const load = useCallback(async () => {
    const list = onlyDohefes(await getMySubscriptions());
    setSubs(list);
    setDeviceReports(readDeviceReports());
    return list;
  }, []);

  // לא מחוברים: מעבירים להתחברות וחוזרים לכאן
  useEffect(() => {
    if (loading || session) return;
    rememberNext("/account/");
    router.replace("/login/");
  }, [loading, session, router]);

  // אחרי תשלום, האישור מקארדקום מגיע לשרת כמה שניות אחרי החזרה לאתר. ממתינים עד כ-90 שניות.
  useEffect(() => {
    if (!session) return;
    const justPaid = new URLSearchParams(window.location.search).get("subscribed") === "1";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let alive = true;
    const tick = async () => {
      const list = await load();
      if (!alive) return;
      if (list.length === 0 && justPaid && polls.current < 30) {
        polls.current += 1;
        setWaiting(true);
        timer = setTimeout(tick, 3000);
      } else {
        setWaiting(false);
        if (list.length === 0 && justPaid) setTimedOut(true);
      }
    };
    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [session, load]);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  if (loading || !session) return <main className="max-w-lg mx-auto px-4 py-10 text-sm text-gray-500">טוען...</main>;

  return (
    <main className="max-w-lg mx-auto px-4 py-10">
      <div className="flex items-baseline justify-between mb-1">
        <h1 className="text-xl font-bold text-[#14502F]">האזור האישי</h1>
        <button onClick={signOut} className="text-xs text-gray-500 underline cursor-pointer">יציאה</button>
      </div>
      <p className="text-sm text-gray-500 mb-6" dir="ltr" style={{ textAlign: "right" }}>{session.user.email}</p>

      {waiting && (
        <div className="bg-[#EAF3EC] border border-[#BFE0CC] rounded-xl px-4 py-3 text-sm text-[#14502F] mb-4">
          התשלום התקבל, מפעילים את המנוי. זה לוקח כמה שניות...
        </div>
      )}
      {timedOut && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 mb-4">
          ההפעלה לוקחת יותר מהרגיל. אם חויבתם, אל תשלמו שוב: רעננו את העמוד בעוד דקה, ואם המנוי לא מופיע צרו קשר בוואטסאפ.
        </div>
      )}

      {subs && subs.length === 0 && !waiting && !timedOut && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <p className="text-sm text-gray-700 mb-3">אין לכם מנוי פעיל לדוחות אפס בחשבון הזה.</p>
          <a href={SITE_PATHS.subscribe} className="inline-block bg-[#1D6F42] text-white font-bold px-5 py-2.5 rounded-lg hover:bg-[#14502F]">
            לצפייה בחבילות
          </a>
          <p className="text-xs text-gray-500 mt-3">
            אם הצטרפתם כמשתמש במנוי של משרד, יש להתחבר עם האימייל שהבעלים הזין, ולאמת אותו.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {subs?.map((s) => {
          const exhausted = s.usage_checks >= s.checks_per_month;
          return (
            <div key={s.id} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <h2 className="font-bold text-[#14502F]">{PLAN_NAMES[s.plan] ?? s.plan}</h2>
                <span className="text-xs text-gray-500">דוחות אפס</span>
              </div>
              <div className="text-xs text-gray-500 mb-4">
                בתוקף עד {heDate(s.ends_at)}
                {s.is_owner ? "" : " · אתם משתמשים במנוי של המשרד"}
              </div>

              <div className="flex justify-between text-sm mb-1">
                <span>פרויקטים שנפתחו החודש</span>
                <strong>{s.usage_checks} מתוך {s.checks_per_month}</strong>
              </div>
              <Meter used={s.usage_checks} total={s.checks_per_month} />
              <p className="text-xs text-gray-500 mt-1">המכסה מתחדשת בראשון לכל חודש ואינה נצברת. פרויקט שנפתח נשאר פתוח לעריכה, ייצוא והדפסה ללא הגבלה.</p>

              {exhausted ? (
                <p className="mt-4 text-sm text-[#8a2f22]">
                  המכסה החודשית נוצלה. היא תתחדש בראשון לחודש הבא, ובינתיים אפשר לרכוש דוח בודד דרך{" "}
                  <a href="/dohefes/start/" className="underline">עמוד ההזמנה</a>.
                </p>
              ) : (
                <a href={SITE_PATHS.calculator} className="mt-4 block text-center bg-[#1D6F42] text-white font-bold py-2.5 rounded-lg hover:bg-[#14502F]">
                  פתיחת פרויקט חדש במחשבון
                </a>
              )}

              {s.is_owner && s.seats > 1 && <Members sub={s} onSaved={load} />}
            </div>
          );
        })}
      </div>

      <DeviceReports reports={deviceReports} />
    </main>
  );
}
