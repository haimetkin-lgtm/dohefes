"use client";

import { useEffect, useState } from "react";
import { supabase, supabaseConfigured, getCustomOrderStatus } from "@/lib/supabase";

// חייב להיות www: הכתובת בלי www מפנה (308), ודפדפן דוחה בקשת preflight שמקבלת הפניה.
const BUILD_SKELETON_URL = "https://www.insure.co.il/api/dohefes/build-skeleton";

type OrderState = "loading" | "no_order" | "waiting" | "ready" | "submitted";

export default function CustomIntakePage() {
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderState, setOrderState] = useState<OrderState>("loading");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // מזהה ההזמנה מגיע בכתובת אחרי התשלום. נקרא ישירות מהכתובת (לא useSearchParams) כדי לא לדרוש Suspense בייצוא סטטי.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("order");
    if (!id) {
      setOrderState("no_order");
      return;
    }
    setOrderId(id);
  }, []);

  // התשלום מסומן רק על ידי השרת, אחרי אישור קארדקום. עד אז בודקים כל כמה שניות.
  useEffect(() => {
    if (!orderId || orderState === "ready" || orderState === "submitted") return;
    let cancelled = false;
    async function check() {
      const order = await getCustomOrderStatus(orderId as string);
      if (cancelled) return;
      if (!order) setOrderState("no_order");
      else if (order.status !== "pending_payment") setOrderState("submitted");
      else setOrderState(order.paid ? "ready" : "waiting");
    }
    check();
    const interval = setInterval(check, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [orderId, orderState]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim() || !description.trim() || !email.trim()) {
      setError("נא למלא שם, נייד, אימייל ותיאור הפרויקט לפחות.");
      return;
    }
    if (!email.includes("@")) {
      setError("כתובת האימייל לא תקינה. אליה יישלח קישור לשלד הדוח כשיהיה מוכן.");
      return;
    }
    setSubmitting(true);
    setError(null);

    if (!supabaseConfigured) {
      // גיבוי זמני: פותח וואטסאפ עם הפרטים, עד שהמערכת מחוברת לאחסון קבצים
      const waText = encodeURIComponent(
        `שלום חיים, שילמתי עבור דוח אפס בהתאמה אישית.\nשם: ${name}\nנייד: ${phone}\nאימייל: ${email}\n\nתיאור הפרויקט:\n${description}\n\n(אצרף קבצים כאן בצ'אט)`,
      );
      window.open(`https://wa.me/972523728828?text=${waText}`, "_blank");
      setDone(true);
      setSubmitting(false);
      return;
    }

    try {
      const filePaths: string[] = [];
      for (const file of files) {
        // הקבצים נשמרים בתיקיית ההזמנה עצמה. השרת מקבל רק נתיבים מתוך התיקייה הזו.
        const path = `custom-orders/${orderId}/${Date.now()}-${file.name.replace(/[/\\]/g, "_")}`;
        const { error: uploadError } = await supabase.storage.from("dohefes-uploads").upload(path, file);
        if (!uploadError) filePaths.push(path);
      }

      // שליחת הפרטים מתקבלת רק להזמנה ששולמה בפועל (אישור קארדקום לשרת), ורק פעם אחת
      const { data: accepted, error: submitError } = await supabase.rpc("dohefes_submit_custom_order", {
        p_id: orderId,
        p_name: name.trim(),
        p_phone: phone.trim(),
        p_email: email.trim(),
        p_description: description.trim(),
        p_file_paths: filePaths,
      });
      if (submitError || !accepted) throw submitError ?? new Error("order not accepted");
      setDone(true);
      // מפעילים את הסוכן החכם ברקע. לא ממתינים לתשובה, הלקוח כבר רואה מסך "התקבל"
      // והתוצאה תישלח אליו במייל כשתהיה מוכנה (ר' insure-vda/src/lib/dohefes/skeleton.ts)
      fetch(BUILD_SKELETON_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: orderId }),
      }).catch(() => {});
    } catch {
      setError("אירעה שגיאה בשמירת הפרטים. אפשר לנסות שוב, או לפנות בוואטסאפ.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!done && orderState === "loading") {
    return <main className="max-w-lg mx-auto px-4 py-16 text-center text-sm text-gray-500">טוען...</main>;
  }

  if (!done && orderState === "no_order") {
    return (
      <main className="max-w-lg mx-auto px-4 py-16 text-center">
        <div className="text-lg font-bold text-[#14502F] mb-2">לא נמצאה הזמנה</div>
        <p className="text-sm text-gray-600 mb-4">
          הדף הזה נפתח אחרי תשלום. אם שילמתם ואתם רואים הודעה זו, פנו אלינו בוואטסאפ ונאתר את ההזמנה.
        </p>
        <a href="/dohefes/custom/" className="text-sm text-[#1D6F42] underline">
          חזרה לעמוד הרכישה
        </a>
      </main>
    );
  }

  if (!done && orderState === "waiting") {
    return (
      <main className="max-w-lg mx-auto px-4 py-16 text-center">
        <div className="text-lg font-bold text-[#14502F] mb-2">מאמתים את התשלום מול חברת האשראי...</div>
        <p className="text-sm text-gray-600">
          אישור התשלום מגיע בדרך כלל תוך שניות והדף יתעדכן אוטומטית. אם זה נמשך יותר מכמה דקות, פנו אלינו בוואטסאפ.
        </p>
      </main>
    );
  }

  if (done || orderState === "submitted") {
    return (
      <main className="max-w-lg mx-auto px-4 py-16 text-center">
        <div className="text-lg font-bold text-[#14502F] mb-2">התקבל, תודה</div>
        <p className="text-sm text-gray-600">נעבור על הפרטים ונבנה עבורכם את שלד דוח האפס. נחזור אליכם בקרוב.</p>
      </main>
    );
  }

  return (
    <main className="max-w-lg mx-auto px-4 py-10">
      <h1 className="text-xl font-bold text-[#14502F] mb-1">פרטי הפרויקט</h1>
      <p className="text-sm text-gray-500 mb-6">
        התשלום התקבל. עכשיו נשאר לספר לנו על הפרויקט, ככל שתפרטו יותר, כך נוכל להתאים טוב יותר.
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-600 text-xs">
            שם מלא <span className="text-[#8a2f22]">(שדה חובה)</span>
          </span>
          <input
            name="name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-right"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-600 text-xs">
            נייד <span className="text-[#8a2f22]">(שדה חובה)</span>
          </span>
          <input
            name="phone"
            type="tel"
            autoComplete="tel"
            dir="ltr"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-right"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-600 text-xs">
            אימייל <span className="text-[#8a2f22]">(שדה חובה)</span>
          </span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-right"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-600 text-xs">
            תיאור חופשי ומורחב של הפרויקט: מיקום, מהות, שטחים, תמהיל דירות משוער, כל מה שידוע{" "}
            <span className="text-[#8a2f22]">(שדה חובה)</span>
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={8}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-right"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-500 text-xs">קבצים (פרוגרמה, Word, Excel, PDF), אופציונלי</span>
          <input
            type="file"
            multiple
            accept=".doc,.docx,.xls,.xlsx,.pdf"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            className="border border-gray-300 rounded-lg px-3 py-2 text-xs"
          />
        </label>

        {error && <p className="text-sm text-[#8a2f22]">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-[#1D6F42] hover:bg-[#14502F] text-white font-bold py-3 rounded-lg disabled:opacity-50 transition-colors"
        >
          {submitting ? "שולח..." : "שליחה"}
        </button>
      </form>
    </main>
  );
}
