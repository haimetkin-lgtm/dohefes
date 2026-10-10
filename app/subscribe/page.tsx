"use client";

import { useEffect, useState } from "react";
import { CATALOG, formatPriceNis } from "@/lib/catalog";
import { SITE_PATHS } from "@/lib/site";
import {
  describeSubscriptionError, fetchPlans, rememberNext, startSubscriptionCheckout, useSession,
  type Billing, type PlanKey, type PublicPlan,
} from "@/lib/subscriptions";

const WA = "972523728828";
const fmt = (n: number) => n.toLocaleString("he-IL");

function Check({ light }: { light?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" className="shrink-0 mt-0.5" aria-hidden="true">
      <path d="M4 10.5l4 4 8-9" fill="none" stroke={light ? "#8fd3ab" : "#1D6F42"} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Pill<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="inline-flex bg-white rounded-full border border-gray-200 shadow-sm p-1 text-sm">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`px-4 py-1.5 rounded-full cursor-pointer transition-colors ${value === v ? "bg-[#1D6F42] text-white font-medium" : "text-gray-600 hover:text-gray-900"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export default function SubscribePage() {
  const { session, loading } = useSession();
  const [plans, setPlans] = useState<PublicPlan[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [billing, setBilling] = useState<Billing>("full");
  const [busyPlan, setBusyPlan] = useState<PlanKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paymentFailed, setPaymentFailed] = useState(false);

  useEffect(() => {
    fetchPlans().then(setPlans).catch(() => setLoadError(true));
    void Promise.resolve().then(() => setPaymentFailed(new URLSearchParams(window.location.search).get("payment") === "failed"));
  }, []);

  async function buy(plan: PlanKey) {
    setError(null);
    if (!session) {
      rememberNext("/subscribe/");
      window.location.assign(SITE_PATHS.login);
      return;
    }
    setBusyPlan(plan);
    try {
      window.location.assign(await startSubscriptionCheckout(session.access_token, plan, billing));
    } catch (e) {
      const code = (e as Error).message;
      setError(describeSubscriptionError(code === "checkout_failed" ? "" : code));
      setBusyPlan(null);
    }
  }

  const wa = (text: string) => `https://wa.me/${WA}?text=${encodeURIComponent(text)}`;

  return (
    <main className="max-w-5xl mx-auto px-4 py-10">
      <div className="text-center max-w-2xl mx-auto">
        <h1 className="text-2xl md:text-3xl font-bold text-[#14502F] mb-2">מנויים שנתיים</h1>
        <p className="text-sm md:text-base text-gray-600 leading-relaxed">
          פותחים פרויקטים בכמות על חשבון המנוי, בלי לשלם {formatPriceNis(CATALOG.baseReport.priceAgorot)} על כל דוח.
          כל פרויקט כולל שמירה בקישור קבוע, ייצוא Excel, הדפסה ודוח מעקב בנייה. המנוי שנתי וללא חידוש אוטומטי.
        </p>
        <p className="text-xs text-gray-500 mt-1">המחשבון עצמו נשאר חינמי לכולם. כל המחירים באתר זה כוללים מע״מ.</p>
      </div>

      {paymentFailed && (
        <p className="text-sm text-[#8a2f22] bg-[#fbeeea] rounded-lg px-3 py-2 mt-4 text-center">התשלום לא הושלם ולא חויבתם. אפשר לנסות שוב.</p>
      )}

      <div className="flex justify-center mt-6 mb-8">
        <Pill value={billing} onChange={setBilling} options={[["full", "שנתי (כ-10% הנחה)"], ["installments", "12 תשלומים"]]} />
      </div>

      {loadError && <p className="text-sm text-[#8a2f22] text-center">לא הצלחנו לטעון את החבילות. נסו לרענן, או צרו קשר בוואטסאפ.</p>}
      {!plans && !loadError && <p className="text-sm text-gray-500 text-center">טוען חבילות...</p>}
      {error && <p className="text-sm text-[#8a2f22] bg-[#fbeeea] rounded-lg px-3 py-2 mb-4 text-center">{error}</p>}
      {session && !loading && <p className="text-xs text-gray-500 mb-4 text-center">מחוברים כ-{session.user.email}</p>}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch">
        {plans?.map((p) => {
          const price = p.prices.dohefes;
          const dark = p.availability === "quote";
          const showFull = billing === "full" && price.fullYearNis > 0;
          const yearNis = showFull ? price.fullYearNis : price.installmentsYearNis;
          const perProject = !dark && p.checksPerMonth > 0 ? Math.round(yearNis / (p.checksPerMonth * 12)) : 0;
          return (
            <div
              key={p.key}
              className={`flex flex-col rounded-2xl p-5 shadow-sm border ${
                dark ? "bg-[#14502F] text-white border-[#14502F]" : "bg-white border-gray-200"
              }`}
            >
              <h2 className={`font-bold text-lg ${dark ? "text-white" : "text-[#14502F]"}`}>{p.name}</h2>
              <p className={`text-xs mt-1 mb-4 min-h-[2.5rem] ${dark ? "text-gray-200" : "text-gray-500"}`}>{p.audience}</p>

              {p.availability === "available" && (
                <div className="mb-4">
                  {showFull ? (
                    <>
                      <div className="text-3xl font-bold text-[#1D6F42]">
                        {fmt(price.fullYearNis)} ₪ <span className="text-base font-medium text-gray-500">/ שנה</span>
                      </div>
                      <div className="text-sm text-gray-400 line-through">{fmt(price.installmentsYearNis)} ₪ / שנה</div>
                    </>
                  ) : (
                    <>
                      <div className="text-3xl font-bold text-[#1D6F42]">
                        {fmt(price.installmentsMonthlyNis)} ₪ <span className="text-base font-medium text-gray-500">/ חודש</span>
                      </div>
                      <div className="text-sm text-gray-500">12 תשלומים, {fmt(price.installmentsYearNis)} ₪ לשנה</div>
                    </>
                  )}
                  {perProject > 0 && (
                    <div className="text-xs text-gray-500 mt-1">
                      בניצול מלא של המכסה: כ-{fmt(perProject)} ₪ לפרויקט, במקום {formatPriceNis(CATALOG.baseReport.priceAgorot)}.
                    </div>
                  )}
                </div>
              )}
              {dark && <div className="mb-4 text-2xl font-bold">הצעת מחיר מותאמת</div>}

              <ul className="space-y-2 mb-6 text-sm flex-1">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check light={dark} />
                    <span className={dark ? "text-gray-100" : "text-gray-700"}>{f}</span>
                  </li>
                ))}
              </ul>

              {p.availability === "available" && (
                <button
                  onClick={() => buy(p.key)}
                  disabled={busyPlan !== null}
                  className="w-full bg-[#1D6F42] text-white font-bold py-3 rounded-xl hover:bg-[#14502F] disabled:opacity-50 cursor-pointer disabled:cursor-default transition-colors"
                >
                  {busyPlan === p.key ? "מעביר לתשלום..." : session ? "לרכישה" : "הרשמה ורכישה"}
                </button>
              )}
              {p.availability === "quote" && (
                <a
                  href={wa("שלום חיים, אני מעוניין בהצעת מחיר למנוי דוחות אפס לארגון")}
                  target="_blank"
                  className="block text-center bg-white text-[#14502F] font-bold py-3 rounded-xl hover:bg-gray-100 transition-colors"
                >
                  בקשת הצעת מחיר
                </a>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-500 mt-8 leading-relaxed text-center max-w-2xl mx-auto">
        פרויקט הוא דוח אפס אחד שנפתח על חשבון המנוי. מכסת הפרויקטים מתחדשת בראשון לכל חודש ואינה נצברת. אחרי שפרויקט נפתח אפשר לערוך אותו,
        לייצא ולהדפיס בלי הגבלה. שימוש בכלי כפוף ל
        <a href="/dohefes/terms/" className="underline">תנאי השימוש והגבלת האחריות</a>.
      </p>
      <p className="text-sm text-gray-500 mt-4 text-center">
        כבר מנויים? <a href={SITE_PATHS.login} className="text-[#1D6F42] underline">כניסה לאזור האישי</a>
      </p>
    </main>
  );
}
