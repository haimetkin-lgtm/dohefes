// שכבת בידוד יחידה לכל הידע הספציפי ל-Cardcom (LowProfile API, v11). כל שם שדה/endpoint שתלוי
// בספק חי כאן ורק כאן - אם/כשיתברר ששם שדה שגוי (ר' אזהרה למטה), התיקון מתומצת לקובץ הזה בלבד,
// לא מפוזר בתוך create-payment-order/index.ts.
//
// ╔═══════════════════════════════════════════════════════════════════════════════════════════╗
// ║ אזהרה מתועדת - קריאה חובה לפני שהקוד הזה מופעל על תנועה אמיתית:                             ║
// ║                                                                                               ║
// ║ שמות השדות/endpoints כאן (TerminalNumber/ApiName/ApiPassword/ReturnValue/Amount/              ║
// ║ SuccessRedirectUrl/FailedRedirectUrl/WebHookUrl/LowProfileId, /api/v11/LowProfile/Create,     ║
// ║ /api/v11/LowProfile/GetLpResult) מבוססים על מחקר רשת (חיפוש + WebFetch) שבוצע בזמן כתיבת      ║
// ║ הקוד הזה - **לא על גישה ישירה, מאומתת ומלאה לתיעוד הרשמי או לחשבון Cardcom בפועל**. ניסיונות  ║
// ║ לגשת ישירות ל-Zendesk/kb.cardcom.co.il/swagger.json נחסמו (403/404/ECONNREFUSED) בסביבת       ║
// ║ הכתיבה הזו. זו בדיוק ההחלטה הפתוחה שכבר מתועדת ב-GEN2_PAYMENT_ENTITLEMENT_DESIGN.md §8        ║
// ║ ("אימות שם ה-API המדויק... מול תיעוד Cardcom/תמיכה") - עדיין לא נסגרה, לא נסגרת כאן.          ║
// ║                                                                                               ║
// ║ **חובה לאמת את כל השדות למטה מול תיעוד Cardcom החי (או תמיכה) בסביבת sandbox, לפני שה-        ║
// ║ Edge Function הזו נפרסת ומופעלת על תנועה אמיתית.** זו בדיוק הסיבה שה-commit הזה לא כולל       ║
// ║ פריסה (deploy) בפועל.                                                                         ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════════╝
//
// ממצא נוסף לדיווח: רשימת ה-secrets שסופקה (CARDCOM_TERMINAL_NUMBER, CARDCOM_API_USERNAME,
// CARDCOM_INDICATOR_URL, CARDCOM_SUCCESS_URL, CARDCOM_ERROR_URL) **אינה כוללת סיסמה/מפתח API**
// (ApiPassword או מקביל) - בכל מקור שנבדק (כולל תיעוד ישן וחדש כאחד), האימות מול Cardcom דורש
// גם משתמש/שם API **וגם** סיסמה/מפתח, לא רק שם. הקוד כאן קורא ל-`CARDCOM_API_PASSWORD` בתור שם
// secret חסר סביר - **שם בלבד, שם ה-secret הזה לא סופק ברשימה המקורית ולא הונח שום ערך** - יש
// לאשר/להגדיר אותו לפני שהקוד הזה יכול לפעול בפועל.

export interface CardcomCredentials {
  terminalNumber: string;
  apiUsername: string;
  /** ר' אזהרת ה-secret החסר למעלה - לא בטוח שזה שם ה-secret הנכון בפועל */
  apiPassword: string;
}

export interface CreateLowProfileRequest {
  amountAgorot: number;
  currencyCode: number;
  /** ה-provider_order_reference שלנו - Cardcom מחזירה אותו בחזרה כדי שנוכל לקשר את ה-callback להזמנה שלנו */
  returnValue: string;
  successRedirectUrl: string;
  failedRedirectUrl: string;
  /** webhook - כתובת קבועה מ-secret/config השרת, לעולם לא מהלקוח */
  indicatorUrl: string;
}

export interface CreateLowProfileResult {
  lowProfileCode: string;
  checkoutUrl: string;
}

/** תוצאה שלילית - לא נזרקת כ-exception (הכשל הוא תרחיש צפוי, לא שגיאת קוד) */
export type CardcomCreateOutcome =
  | { ok: true; result: CreateLowProfileResult }
  | { ok: false; failureCode: string };

const CARDCOM_BASE_URL = "https://secure.cardcom.solutions";
const CREATE_LOW_PROFILE_PATH = "/api/v11/LowProfile/Create";

/**
 * יוצרת "דף תשלום" (LowProfile session) חדש אצל Cardcom. **הצלחה כאן פירושה אך ורק "נוצר דף
 * תשלום"** - לא "שולם"/"אושר". אין קריאה כלשהי כאן שמסמנת תשלום כמאושר - זה תפקידה הבלעדי
 * של cardcom-payment-indicator (Edge Function נפרדת, עתידית, שקוראת ל-GetLpResult) אחרי חזרת
 * המשתמש/הגעת ה-webhook, לא של הפונקציה הזו.
 */
export async function createLowProfile(
  credentials: CardcomCredentials,
  request: CreateLowProfileRequest
): Promise<CardcomCreateOutcome> {
  let response: Response;
  try {
    response = await fetch(`${CARDCOM_BASE_URL}${CREATE_LOW_PROFILE_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        TerminalNumber: credentials.terminalNumber,
        ApiName: credentials.apiUsername,
        ApiPassword: credentials.apiPassword,
        Amount: request.amountAgorot / 100,
        ISOCoinId: request.currencyCode,
        ReturnValue: request.returnValue,
        SuccessRedirectUrl: request.successRedirectUrl,
        FailedRedirectUrl: request.failedRedirectUrl,
        WebHookUrl: request.indicatorUrl,
      }),
    });
  } catch {
    // תקלת רשת/חיבור - לא תקלת קוד. failureCode כללי, בלי לחשוף פרטי חיבור/כתובות פנימיות.
    return { ok: false, failureCode: "provider_unreachable" };
  }

  if (!response.ok) {
    // **לא** קוראים/מחזירים את גוף התגובה המלא - עלול להכיל פרטי כישלון של הספק שלא נועדו
    // לצאת ללקוח (ר' דרישה "אל תחזיר credentials או תגובת ספק מלאה").
    return { ok: false, failureCode: `provider_http_${response.status}` };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, failureCode: "provider_invalid_response" };
  }

  const lowProfileCode = extractString(payload, ["LowProfileId", "LowProfileCode"]);
  const checkoutUrl = extractString(payload, ["Url", "RedirectUrl", "LowProfileUrl"]);

  if (!lowProfileCode || !checkoutUrl) {
    return { ok: false, failureCode: "provider_missing_fields" };
  }

  return { ok: true, result: { lowProfileCode, checkoutUrl } };
}

function extractString(payload: unknown, keys: readonly string[]): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}
