"use client";

import { useState } from "react";
import { supabase, supabaseConfigured, CUSTOM_PRICE_NIS } from "@/lib/supabase";

const BUILD_SKELETON_URL = "https://insure.co.il/api/dohefes/build-skeleton";

export default function CustomIntakePage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

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
        const path = `custom-orders/${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage.from("dohefes-uploads").upload(path, file);
        if (!uploadError) filePaths.push(path);
      }

      const { data: order, error: insertError } = await supabase
        .from("dohefes_custom_orders")
        .insert({
          name,
          phone,
          email,
          description,
          file_paths: filePaths,
          price_nis: CUSTOM_PRICE_NIS,
          paid: true,
          status: "submitted",
        })
        .select("id")
        .single();
      if (insertError) throw insertError;
      setDone(true);
      // מפעילים את הסוכן החכם ברקע. לא ממתינים לתשובה, הלקוח כבר רואה מסך "התקבל"
      // והתוצאה תישלח אליו במייל כשתהיה מוכנה (ר' insure-vda/src/lib/dohefes/skeleton.ts)
      if (order?.id) {
        fetch(BUILD_SKELETON_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_id: order.id }),
        }).catch(() => {});
      }
    } catch {
      setError("אירעה שגיאה בשמירת הפרטים. אפשר לנסות שוב, או לפנות בוואטסאפ.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
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
