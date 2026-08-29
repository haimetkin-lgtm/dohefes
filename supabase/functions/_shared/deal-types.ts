// רשימת סוגי עסקה תקפים - Commit 6a (baseReport secure backend). מראה את lib/calc/types.ts
// (DealType) אך מוגדרת כאן מחדש כערך runtime, לא type בלבד: טיפוסי TypeScript נמחקים בזמן
// קומפילציה ולא ניתנים לאימות בתוך RPC/Edge Function שרצים על קלט חיצוני בזמן ריצה. אין דרך
// טכנית לשתף קבוע ממשי בין שני ה-runtimes (Next.js בצד אחד, Deno/Vitest בצד שני) - בדיוק כמו
// MAX_TRACKING_BODY_BYTES/MAX_TRACKING_ITEMS (tracking-validator.ts), מתועד כאן ושם במפורש
// כדי שלא יסטו זה מזה בעתיד. **אותה רשימה בדיוק** חוזרת גם ב-migrations/20260829151144_dohefes_base_report_secure_backend.sql
// (p_deal_type = any(array[...])) - שלוש מקומות (כאן, שם, lib/calc/types.ts) חייבים להישאר מסונכרנים ידנית.
//
// **אין נגיעה ב-lib/calc/types.ts מקובץ זה או ממקום שקורא לו** - מחוץ להיקף Commit 6a
// ("ללא React") - הקובץ הזה עצמאי לגמרי, לא מייבא ולא מיובא על ידי קוד ה-UI.
//
// קובץ טהור, בלי שום ייבוא ספציפי ל-Deno - ניתן לבדיקה ישירה מ-Vitest, ר. deal-types.test.ts.

export const DEAL_TYPES = ["tama38", "basic", "kombinatsia", "pinuyBinui", "kombinatsiaTemurot", "purchaseGroup", "mixedUse"] as const;

export type DealTypeValue = (typeof DEAL_TYPES)[number];

export function isDealType(value: unknown): value is DealTypeValue {
  return typeof value === "string" && (DEAL_TYPES as readonly string[]).includes(value);
}
