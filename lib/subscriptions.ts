"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { MySubscription } from "./subscriptions-api";

export * from "./subscriptions-api";

// הסשן של המשתמש. loading נשאר true עד שהדפדפן סיים לקרוא את הסשן השמור (וגם לטפל בחזרה מגוגל).
// ה-client משותף לכל האתרים תחת אותו origin ולכן הכניסה משותפת.
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!alive) return;
      setSession(next);
      setLoading(false);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return { session, loading };
}

export async function getMySubscriptions(): Promise<MySubscription[]> {
  const { data, error } = await supabase.rpc("my_subscriptions");
  if (error || !Array.isArray(data)) return [];
  return data as MySubscription[];
}

export async function setMembers(subscriptionId: string, emails: string[]): Promise<boolean> {
  const { data, error } = await supabase.rpc("subscription_set_members", {
    p_subscription_id: subscriptionId,
    p_emails: emails,
  });
  return !error && data === true;
}

// זוכר לאן לחזור אחרי התחברות (כולל חזרה מגוגל)
const NEXT_KEY = "dohefes_after_login";
export function rememberNext(path: string) {
  try { sessionStorage.setItem(NEXT_KEY, path); } catch {}
}
export function takeNext(): string | null {
  try {
    const v = sessionStorage.getItem(NEXT_KEY);
    sessionStorage.removeItem(NEXT_KEY);
    return v;
  } catch {
    return null;
  }
}
