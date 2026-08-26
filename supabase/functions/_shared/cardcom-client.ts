// Cardcom LowProfile API client - שכבת בידוד יחידה לכל הידע הספציפי ל-Cardcom.
//
// **אומת מול תיעוד רשמי** (סופק על ידי המשתמש, לא מחקר רשת):
// https://support.cardcom.solutions/hc/he/articles/360021519340-Low-profile-interface-EN-Step-1-2
// גרסה קודמת של הקובץ הזה הסתמכה על מחקר רשת חלקי ("api/v11/...", CARDCOM_API_PASSWORD) -
// **כל ההנחות שלא אומתו הוסרו** - הממשק כאן הוא Name-To-Value, API Level 10, לא v11 JSON.
//
// קובץ טהור, בלי ייבוא ספציפי ל-Deno (רק fetch/URL/URLSearchParams הגלובליים - זמינים זהה
// ב-Deno וב-Node) - נבדק ישירות ב-cardcom-client.test.ts דרך mock ל-fetch הגלובלי.

import { agorotToShekelString } from "./money.ts";

const LOW_PROFILE_CREATE_URL = "https://secure.cardcom.solutions/Interface/LowProfile.aspx";

/** host מאושר יחיד ל-checkout_url שחוזר מ-Cardcom - לא בונים את הכתובת בעצמנו (לפי ההוראה),
 *  רק מוודאים שמה שהספק החזיר הוא באמת שלו, לא URL שרירותי (תגובה מזוייפת/proxy נגוע וכו') */
const ALLOWED_CHECKOUT_HOSTS = new Set(["secure.cardcom.solutions"]);

export interface CardcomCredentials {
  terminalNumber: string;
  /** UserName בתיעוד הרשמי - **אין סיסמה נפרדת** ב-API Level 10 של יצירת LowProfile (ר' §4 בדוח) */
  userName: string;
}

export interface CreateLowProfileRequest {
  /** אגורות, integer - מומר למחרוזת שקלים דו-ספרתית (agorotToShekelString) לפני השליחה */
  amountAgorot: number;
  /** נחתך ל-50 תווים (מגבלת Cardcom) - מגיע מה-registry (payment-products.ts), לעולם לא מהלקוח */
  productName: string;
  /** ה-provider_order_reference שלנו - Cardcom מחזירה אותו כ-ReturnValue כדי שנוכל לקשר callback להזמנה */
  returnValue: string;
  successRedirectUrl: string;
  errorRedirectUrl: string;
  /** webhook - כתובת קבועה מ-config/secrets השרת, לעולם לא מהלקוח */
  indicatorUrl: string;
}

export interface CreateLowProfileResult {
  lowProfileCode: string;
  /** בדיוק מה ש-Cardcom החזירה תחת `url` - לא נבנה בעצמנו, רק מאומת (HTTPS + host מאושר) */
  checkoutUrl: string;
}

/** תוצאה שלילית - לא נזרקת כ-exception (הכשל הוא תרחיש צפוי, לא שגיאת קוד). failureCode תמיד
 *  קוד כללי - **לעולם לא** ה-Description החופשי שחוזר מ-Cardcom, ולא ה-body המלא של התגובה. */
export type CardcomCreateOutcome =
  | { ok: true; result: CreateLowProfileResult }
  | { ok: false; failureCode: string };

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isApprovedCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ALLOWED_CHECKOUT_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

const MAX_PRODUCT_NAME_LENGTH = 50;

export function createCardcomClient(credentials: CardcomCredentials) {
  return {
    /**
     * יוצרת "דף תשלום" (LowProfile session, API Level 10) אצל Cardcom. **הצלחה כאן פירושה אך
     * ורק "נוצר דף תשלום"** - לא "שולם"/"אושר". אין קריאה כלשהי כאן שמסמנת תשלום כמאושר - זה
     * תפקידה הבלעדי של cardcom-payment-indicator (Edge Function נפרדת, עתידית, לא נכתבת כאן -
     * ר' תיעוד הממשק המאומת שלה בתחתית הקובץ הזה) אחרי חזרת המשתמש/הגעת ה-IndicatorUrl.
     *
     * **בכוונה בלי `AutoRedirect=true`** - אנחנו צריכים את ה-url בתגובה כדי להחזיר אותו ללקוח
     * (checkoutUrl), לא redirect מתוך ה-fetch עצמו (אין למי להפנות בצד שרת).
     */
    async createLowProfile(request: CreateLowProfileRequest): Promise<CardcomCreateOutcome> {
      // כתובות ה-callback מגיעות מ-config/secrets השרת בלבד (לעולם לא מהלקוח) - עדיין נבדקות
      // HTTPS כאן, כהגנת-שפיות מול קונפיגורציה שגויה (למשל secret ריק/http בטעות), לא מול קלט לקוח.
      if (!isHttpsUrl(request.successRedirectUrl) || !isHttpsUrl(request.errorRedirectUrl) || !isHttpsUrl(request.indicatorUrl)) {
        return { ok: false, failureCode: "invalid_callback_url_config" };
      }

      let sumToBill: string;
      try {
        sumToBill = agorotToShekelString(request.amountAgorot);
      } catch {
        return { ok: false, failureCode: "invalid_amount" };
      }

      const productName = request.productName.slice(0, MAX_PRODUCT_NAME_LENGTH);

      // כל הערכים מקודדים אוטומטית על ידי URLSearchParams - אין צורך ב-encodeURIComponent ידני.
      const params = new URLSearchParams({
        Operation: "1",
        TerminalNumber: credentials.terminalNumber,
        UserName: credentials.userName,
        SumToBill: sumToBill,
        CoinId: "1",
        Language: "he",
        ProductName: productName,
        APILevel: "10",
        Codepage: "65001",
        SuccessRedirectUrl: request.successRedirectUrl,
        ErrorRedirectUrl: request.errorRedirectUrl,
        IndicatorUrl: request.indicatorUrl,
        ReturnValue: request.returnValue,
      });

      let responseText: string;
      try {
        const response = await fetch(LOW_PROFILE_CREATE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        });
        if (!response.ok) {
          return { ok: false, failureCode: `provider_http_${response.status}` };
        }
        responseText = await response.text();
      } catch {
        // תקלת רשת/חיבור - לא תקלת קוד.
        return { ok: false, failureCode: "provider_unreachable" };
      }

      // תגובת Name-To-Value: key=value&key2=value2..., לא JSON - נפרסת עם URLSearchParams.
      const parsed = new URLSearchParams(responseText);
      const responseCode = parsed.get("ResponseCode");
      const lowProfileCode = parsed.get("LowProfileCode");
      const checkoutUrl = parsed.get("url");

      // Description (הטקסט החופשי שמסביר כשל, אם קיים) **לא נקרא בכלל** - נשאר בגוף התגובה
      // ולא מגיע לשום מקום שאנחנו נוגעים בו, כדי שלא ידלוף ל-failure_code/ללוגים.
      if (responseCode !== "0") {
        return { ok: false, failureCode: "provider_rejected" };
      }
      if (!lowProfileCode || !checkoutUrl) {
        return { ok: false, failureCode: "provider_missing_fields" };
      }
      if (!isApprovedCheckoutUrl(checkoutUrl)) {
        return { ok: false, failureCode: "provider_untrusted_checkout_url" };
      }

      return { ok: true, result: { lowProfileCode, checkoutUrl } };
    },
  };
}

export type CardcomClient = ReturnType<typeof createCardcomClient>;

// ╔═══════════════════════════════════════════════════════════════════════════════════════════╗
// ║ תיעוד הכנה ל-Indicator העתידי (cardcom-payment-indicator) - לא ממומש כאן, לא נקרא משום מקום. ║
// ║ אומת מול אותו תיעוד רשמי (הקישור בראש הקובץ).                                               ║
// ║                                                                                               ║
// ║   GET/POST https://secure.cardcom.solutions/Interface/BillGoldGetLowProfileIndicator.aspx    ║
// ║   פרמטרים: TerminalNumber, UserName, LowProfileCode, codepage=65001                          ║
// ║                                                                                               ║
// ║ תשלום ייחשב תקין (ורק אז ייכתב entitlement) בעתיד רק אם **כל** התנאים הבאים מתקיימים:        ║
// ║   - OperationResponse = 0                                                                     ║
// ║   - DealResponse = 0                                                                          ║
// ║   - InternalDealNumber קיים (לא ריק)                                                          ║
// ║   - הסכום/המטבע/ה-ReturnValue שחוזרים תואמים בדיוק ל-payment_order שכבר קיים אצלנו            ║
// ║     (לא רק "יש תשובה חיובית" - השוואה מפורשת מול מה שאנחנו כבר יודעים על ההזמנה)             ║
// ║                                                                                               ║
// ║ **השדות האלה לא נקראים היום בשום קוד** - cardcom-payment-indicator עדיין לא נכתבת. תיעוד      ║
// ║ בלבד, לפי ההוראה המפורשת "אין להשתמש כרגע בשדות אלה כדי לסמן paid".                          ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════════╝
