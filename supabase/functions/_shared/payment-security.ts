// עזרי אבטחה טהורים - ולידציה, token אקראי-קריפטוגרפי, hash, CORS. בלי שום ייבוא ספציפי ל-Deno
// (משתמש רק ב-Web Crypto API הגלובלי - crypto.getRandomValues/crypto.subtle - הזמין בדיוק אותו
// דבר גם ב-Deno וגם ב-Node 20+, בלי import נפרד) - כדי שהקובץ הזה יהיה ניתן לבדיקה ישירה
// מ-Vitest, בלי לשכפל את הלוגיקה. ר' payment-security.test.ts, ודיווח המגבלה (אין סביבת Deno
// test בסביבה הזו) בדוח ה-commit.

// תבנית uuid כללית (8-4-4-4-12 הקסדצימלי) - לא בודקת דווקא bit ה-version (v4) הספציפי, כי
// reportId (מ-gen_random_uuid בצד Supabase) ו-Idempotency-Key (מיוצר בצד לקוח, לפי כלים שונים)
// לא בהכרח שניהם v4 טהור - התבנית הכללית מספיקה לוולידציית קלט, לא לצורך קריפטוגרפי.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** 32 בתים = 256 ביט, לפי הדרישה המפורשת ("token אקראי קריפטוגרפי של לפחות 256 ביט") */
const ACCESS_TOKEN_BYTES = 32;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** לעולם לא נשמר גולמי בשום מקום - רק מוחזר ללקוח פעם אחת (ר' create-payment-order/index.ts) */
export function generateAccessToken(): string {
  const bytes = new Uint8Array(ACCESS_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** SHA-256 hex - זה, ורק זה, מה שנשמר ב-access_token_hash */
export async function hashAccessToken(rawToken: string): Promise<string> {
  const data = new TextEncoder().encode(rawToken);
  const digestBuffer = await crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(digestBuffer));
}

/** מזהה הזמנה פנימי שלנו שנשלח ל-Cardcom כ-ReturnValue/correlation - לא UUID (Cardcom עשוי
 *  להגביל אורך/תווים), פורמט קריא: "po_" + 32 תווי hex אקראיים */
export function generateProviderOrderReference(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `po_${toHex(bytes)}`;
}

/** claim token פנימי בלבד (מנגנון ה-lease ליצירת LowProfile session, ר' payment-order-service.ts) -
 *  **לעולם לא** נחשף ללקוח, לא מוחזר בתגובת HTTP, לא נרשם ללוג - שונה במפורש מ-generateAccessToken
 *  (זה כן נמסר ללקוח) כדי ששני סוגי ה-token לא "יתבלבלו" בקוד עתידי. 128 ביט - מספיק להבחין בין
 *  claims מתחרים (לא סוד קריפטוגרפי כלפי לקוח חיצוני - אף לקוח לא רואה אותו בכלל). */
export function generateClaimToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `claim_${toHex(bytes)}`;
}

/** ALLOWED_ORIGINS: רשימה מופרדת בפסיקים, בלי רווחים מיותרים, בלי ערכים ריקים */
export function parseAllowedOrigins(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/** אין `*` בשום מקום - origin חייב להופיע מילולית ברשימה, לא רק "תבנית סבירה" */
export function isAllowedOrigin(origin: string | null, allowedOrigins: readonly string[]): boolean {
  if (!origin) return false;
  return allowedOrigins.includes(origin);
}

/** בקשה מבנית קטנה מאוד (reportId + productType בלבד) - 4KB נדיב בהרבה ממה שנדרש בפועל,
 *  עדיין חוסם payload גדול בטעות/בזדון */
export const MAX_REQUEST_BODY_BYTES = 4096;

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
