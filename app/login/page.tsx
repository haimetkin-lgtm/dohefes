"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useSession, takeNext } from "@/lib/subscriptions";

type Mode = "signin" | "signup" | "forgot" | "recovery";

const BASE = "/dohefes";

function explain(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login")) return "האימייל או הסיסמה לא נכונים.";
  if (m.includes("email not confirmed")) return "האימייל עדיין לא אומת. חפשו במייל את הודעת האימות (גם בספאם).";
  if (m.includes("already registered") || m.includes("already been registered")) return "האימייל הזה כבר רשום. עברו ל״כניסה״.";
  if (m.includes("password") && m.includes("characters")) return "הסיסמה קצרה מדי. נדרשות לפחות 8 תווים.";
  if (m.includes("rate limit") || m.includes("too many")) return "יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.";
  return "אירעה שגיאה. נסו שוב.";
}

export default function LoginPage() {
  const router = useRouter();
  const { session, loading } = useSession();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // חזרה ממייל איפוס סיסמה
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("recovery");
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // מחוברים (כולל חזרה מגוגל): ממשיכים לאן שרצינו
  useEffect(() => {
    if (loading || !session || mode === "recovery") return;
    router.replace(takeNext() ?? "/account/");
  }, [loading, session, mode, router]);

  const returnUrl = () => `${window.location.origin}${BASE}/login/`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (err) setError(explain(err.message));
      } else if (mode === "signup") {
        if (password.length < 8) {
          setError("הסיסמה צריכה להכיל לפחות 8 תווים.");
        } else {
          const { data, error: err } = await supabase.auth.signUp({
            email: email.trim(),
            password,
            options: { emailRedirectTo: returnUrl() },
          });
          if (err) setError(explain(err.message));
          else if (!data.session) setInfo("שלחנו אליכם מייל לאימות הכתובת. לחצו על הקישור שבו ותחזרו לכאן.");
        }
      } else if (mode === "forgot") {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: returnUrl() });
        if (err) setError(explain(err.message));
        else setInfo("אם הכתובת רשומה, נשלח אליה קישור לבחירת סיסמה חדשה.");
      } else if (mode === "recovery") {
        if (password.length < 8) {
          setError("הסיסמה צריכה להכיל לפחות 8 תווים.");
        } else {
          const { error: err } = await supabase.auth.updateUser({ password });
          if (err) setError(explain(err.message));
          else router.replace(takeNext() ?? "/account/");
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setError(null);
    const { error: err } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: returnUrl() } });
    if (err) setError(explain(err.message));
  }

  const title =
    mode === "signup" ? "הרשמה למנויים" : mode === "forgot" ? "איפוס סיסמה" : mode === "recovery" ? "בחירת סיסמה חדשה" : "כניסת מנויים";

  return (
    <main className="max-w-sm mx-auto px-4 py-10">
      <h1 className="text-xl font-bold text-[#14502F] mb-1">{title}</h1>
      <p className="text-sm text-gray-500 mb-6">
        {mode === "signup" ? "פותחים חשבון, ואז בוחרים מנוי." : mode === "recovery" ? "הזינו סיסמה חדשה לחשבון." : "כניסה לאזור האישי ולפתיחת פרויקטים על חשבון המנוי."}
      </p>

      {(mode === "signin" || mode === "signup") && (
        <>
          <button
            type="button"
            onClick={google}
            className="w-full flex items-center justify-center gap-2 border border-gray-300 bg-white rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 cursor-pointer"
          >
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
              <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" />
              <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
            </svg>
            המשך עם Google
          </button>
          <div className="flex items-center gap-3 my-4 text-xs text-gray-400">
            <span className="flex-1 border-t border-gray-200" />
            או עם אימייל וסיסמה
            <span className="flex-1 border-t border-gray-200" />
          </div>
        </>
      )}

      <form onSubmit={submit} className="space-y-2">
        {mode !== "recovery" && (
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="אימייל"
            dir="ltr"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        )}
        {mode !== "forgot" && (
          <input
            type="password"
            required
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "recovery" ? "סיסמה חדשה (לפחות 8 תווים)" : mode === "signup" ? "סיסמה (לפחות 8 תווים)" : "סיסמה"}
            dir="ltr"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        )}
        {error && <p className="text-sm text-[#8a2f22]">{error}</p>}
        {info && <p className="text-sm text-[#14502F] bg-[#EAF3EC] rounded-lg px-3 py-2">{info}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-[#1D6F42] text-white font-bold py-2.5 rounded-lg hover:bg-[#14502F] disabled:opacity-50 cursor-pointer disabled:cursor-default"
        >
          {busy ? "רגע..." : mode === "signup" ? "פתיחת חשבון" : mode === "forgot" ? "שליחת קישור" : mode === "recovery" ? "שמירת סיסמה" : "כניסה"}
        </button>
      </form>

      <div className="mt-5 text-sm text-gray-600 space-y-1.5 text-center">
        {mode === "signin" && (
          <>
            <p>
              אין לכם חשבון?{" "}
              <button type="button" onClick={() => { setMode("signup"); setError(null); setInfo(null); }} className="text-[#1D6F42] font-medium underline cursor-pointer">
                הרשמה
              </button>
            </p>
            <p>
              <button type="button" onClick={() => { setMode("forgot"); setError(null); setInfo(null); }} className="text-[#1D6F42] underline cursor-pointer">
                שכחתי סיסמה
              </button>
            </p>
          </>
        )}
        {(mode === "signup" || mode === "forgot") && (
          <p>
            <button type="button" onClick={() => { setMode("signin"); setError(null); setInfo(null); }} className="text-[#1D6F42] font-medium underline cursor-pointer">
              חזרה לכניסה
            </button>
          </p>
        )}
        <p>
          <a href={`${BASE}/subscribe/`} className="text-gray-500 underline">עוד לא מנויים? לצפייה בחבילות</a>
        </p>
      </div>
    </main>
  );
}
