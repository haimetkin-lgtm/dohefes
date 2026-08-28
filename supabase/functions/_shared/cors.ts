// עזרי CORS משותפים לפונקציות הנקראות מהדפדפן (dohefes-create-payment-order, dohefes-get-product-access) - לא
// ל-dohefes-cardcom-payment-indicator (server-to-server בלבד, בלי CORS בכלל, ר' הערת הכותרת שם).
//
// חולץ החוצה מ-dohefes-create-payment-order/index.ts כדי לא לשכפל את אותה לוגיקה בפעם השלישית -
// ההתנהגות זהה למה שהיה שם (origin מפורש בלבד מתוך allowlist, לעולם לא "*", בלי
// Access-Control-Allow-Credentials - לא נדרש, אין cookies/session בזרימה הזו).
//
// קובץ טהור, בלי ייבוא ספציפי ל-Deno.

import { isAllowedOrigin } from "./payment-security.ts";

export function jsonResponse(body: unknown, status: number, origin: string | null, allowedOrigins: readonly string[]): Response {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (origin && isAllowedOrigin(origin, allowedOrigins)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export function corsPreflightResponse(
  origin: string | null,
  allowedOrigins: readonly string[],
  allowedHeaders: string
): Response {
  const headers = new Headers();
  if (origin && isAllowedOrigin(origin, allowedOrigins)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", allowedHeaders);
    headers.set("Vary", "Origin");
  }
  return new Response(null, { status: 204, headers });
}
