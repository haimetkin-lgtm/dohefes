import { defineConfig } from "vitest/config";

// תשתית בדיקות מינימלית, בכוונה מוגבלת ל-lib/calc (מנוע החישוב הטהור) + supabase/functions/_shared
// (עזרי Edge Functions טהורים - ולידציה/hash/registry, בלי React/דפדפן/Supabase client אמיתי).
// לא מרחיבים כרגע למסכי React או לשאר הפרויקט, ר' דיון בסבב "דור 2".
//
// עדכון (secure-payment-foundation, commit create-payment-order): אין סביבת Deno test זמינה
// כאן - קבצי ה-Edge Function עצמם (index.ts, npm:/Deno.serve) לא ניתנים להרצה תחת Vitest/Node
// כלל. לוגיקת ה-helpers הטהורה (payment-products.ts/payment-security.ts) נכתבה בכוונה בלי שום
// ייבוא ספציפי ל-Deno (רק Web Crypto API הגלובלי, זהה ב-Deno/Node) בדיוק כדי שאפשר יהיה לבדוק
// אותה כאן, בלי לשכפל את הלוגיקה בקובץ בדיקה נפרד. התנהגות ברמת ה-handler (retry/CORS/Cardcom
// failure וכו', שדורשת Deno.serve/mocking של fetch ל-Cardcom) לא נבדקה אוטומטית בסבב הזה - ר'
// דיווח המגבלה בדוח ה-commit.
//
// עדכון (audit מחזור חיים של access token, 2026-08-28): נוסף lib/payment (payment-storage.ts) -
// מודול טהור לניהול pendingPurchases/productAccess ב-localStorage, ללא תלות ב-React/window (ר'
// StorageLike ב-payment-storage.ts) - אותה סיבה בדיוק כמו lib/calc: ניתן לבדוק ישירות ב-Vitest.
export default defineConfig({
  test: {
    include: ["lib/calc/**/*.test.ts", "lib/payment/**/*.test.ts", "supabase/functions/_shared/**/*.test.ts"],
  },
});
