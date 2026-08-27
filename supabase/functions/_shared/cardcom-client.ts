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
import { getField, parseNameToValue } from "./name-to-value.ts";

const LOW_PROFILE_CREATE_URL = "https://secure.cardcom.solutions/Interface/LowProfile.aspx";
const LOW_PROFILE_INDICATOR_URL = "https://secure.cardcom.solutions/Interface/BillGoldGetLowProfileIndicator.aspx";

/** timeout מרוכז יחיד לשתי הקריאות ל-Cardcom (יצירת LowProfile + GetLowProfileIndicator) - לא
 *  מספר מפוזר בקוד. `AbortSignal.timeout(ms)` הוא Web API סטנדרטי, נתמך זהה ב-Deno (הריצה
 *  האמיתית של Edge Functions) וב-Node 18+/Vitest (הבדיקות) - בלי import נוסף, אותו דפוס בדיוק
 *  כמו fetch/URL/URLSearchParams הגלובליים שכבר בשימוש בקובץ הזה. 15 שניות: מספיק זמן לניתור
 *  API רגיל, קצר מספיק שלא להשאיר את המשתמש (ביצירת הזמנה) או את ה-Edge Function (ב-Indicator)
 *  תקועים על קריאה שלא תחזור. */
const CARDCOM_FETCH_TIMEOUT_MS = 15_000;

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

export interface GetLowProfileIndicatorRequest {
  lowProfileCode: string;
}

/** רק העובדות שאומתו מול Cardcom עצמה (Operation/OperationResponse/DealResponse/TerminalNumber/
 *  LowProfileCode כבר נבדקו כאן, בשכבת cardcom-client) - **לא** מול payment_order שלנו. ההשוואה
 *  מול ההזמנה עצמה (ReturnValue==provider_order_reference, CoinId==currency_code, amountAgorot==
 *  expected_amount_agorot) היא תפקיד ה-service layer (_shared/payment-indicator-service.ts) -
 *  cardcom-client מבודד רק ידע ספציפי ל-Cardcom, לא מכיר את מבנה ה-DB שלנו. */
export interface VerifiedIndicatorFields {
  internalDealNumber: string;
  returnValue: string;
  coinId: number;
  amountAgorot: number;
}

/** failureCode אפשריים:
 *  - provider_unreachable / provider_http_<status>: תקלת רשת/HTTP - retryable.
 *  - not_completed: השדות המכריעים (Operation/OperationResponse/DealResponse) חסרים לגמרי
 *    בתגובה - Cardcom עוד לא רשמה תוצאה סופית לעסקה הזו (webhook מוקדם מדי) - retryable, **לא**
 *    כשל סופי.
 *  - operation_failed: Cardcom החזירה תשובה סופית שאינה הצלחה מלאה (Operation!=1, או
 *    OperationResponse/DealResponse!=0, או InternalDealNumber חסר, או TerminalNumber/LowProfileCode
 *    שחזרו לא תואמים למה שביקשנו) - לא retryable, אך גם לא "כשל" שדורש mutation כלשהי מצידנו
 *    (אין RPC ל"סימון failed" - ר' payment-schema.sql - ההזמנה פשוט נשארת כפי שהייתה).
 *  - malformed_response: המידע הגולמי הנוסף (ReturnValue/CoinId/Sum36) שנדרש להשוואה מול ההזמנה
 *    חסר/לא ניתן לפענוח, למרות שה-Operation עצמו הצליח - תרחיש לא-צפוי, מטופל כמו operation_failed. */
export type CardcomIndicatorOutcome =
  | { ok: true; fields: VerifiedIndicatorFields }
  | { ok: false; failureCode: string };

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
          signal: AbortSignal.timeout(CARDCOM_FETCH_TIMEOUT_MS),
        });
        if (!response.ok) {
          return { ok: false, failureCode: `provider_http_${response.status}` };
        }
        responseText = await response.text();
      } catch {
        // תקלת רשת/חיבור **וגם timeout** (fetch עם signal שפג נדחית באותה צורה, ר' הערת
        // CARDCOM_FETCH_TIMEOUT_MS) - שתיהן תקלת ספק זמנית, לא תקלת קוד. לא נתפסת ההודעה הגולמית
        // (catch בלי פרמטר) - לא נרשמת/מוחזרת בשום מקום. ההזמנה עצמה לא נשארת במצב מטעה - נופלת
        // לאותה התנהגות כשל כללית וקיימת כמו כל תקלת רשת אחרת (markOrderFailed, ר' payment-order-service.ts).
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

    /**
     * מאמתת תשלום אצל Cardcom (server-to-server) - הדרך **היחידה** לדעת אם LowProfileCode
     * מסוים אכן שולם בפועל. נקראת רק מ-cardcom-payment-indicator, לעולם לא על סמך תוכן ה-webhook
     * הנכנס עצמו (ר' payment-indicator-service.ts - הפרמטר היחיד שנקרא מה-webhook הוא lowProfileCode,
     * לא שום "עובדה" אחרת שעשויה להגיע בו).
     *
     * GET, לפי התיעוד הרשמי המאומת (הקישור בראש הקובץ) - פרמטרים ב-query string, לא בגוף בקשה.
     */
    async getLowProfileIndicator(request: GetLowProfileIndicatorRequest): Promise<CardcomIndicatorOutcome> {
      const params = new URLSearchParams({
        TerminalNumber: credentials.terminalNumber,
        UserName: credentials.userName,
        LowProfileCode: request.lowProfileCode,
        codepage: "65001",
      });

      let responseText: string;
      try {
        const response = await fetch(`${LOW_PROFILE_INDICATOR_URL}?${params.toString()}`, {
          method: "GET",
          signal: AbortSignal.timeout(CARDCOM_FETCH_TIMEOUT_MS),
        });
        if (!response.ok) {
          return { ok: false, failureCode: `provider_http_${response.status}` };
        }
        responseText = await response.text();
      } catch {
        // תקלת רשת/חיבור **וגם timeout** - ר' אותה הערה למעלה. "provider_unreachable" כבר
        // מוגדר כ-retryable (RETRYABLE_FAILURE_CODES, payment-indicator-service.ts) -> 503,
        // בלי לגעת בהזמנה. לא נתפסת/נרשמת/מוחזרת ההודעה הגולמית של החריגה.
        return { ok: false, failureCode: "provider_unreachable" };
      }

      // case-insensitive במפורש (בניגוד לפענוח תגובת ה-Create למעלה) - לפי ההוראה המפורשת לגבי
      // ממשק ה-Indicator, ר' name-to-value.ts.
      const parsed = parseNameToValue(responseText);
      const operation = getField(parsed, "Operation");
      const operationResponse = getField(parsed, "OperationResponse");
      const dealResponse = getField(parsed, "DealResponse");
      const internalDealNumber = getField(parsed, "InternalDealNumber");
      const responseTerminalNumber = getField(parsed, "TerminalNumber");
      const responseLowProfileCode = getField(parsed, "LowProfileCode");
      const returnValue = getField(parsed, "ReturnValue");
      const coinId = getField(parsed, "CoinId");
      const sum36 = getField(parsed, "ExtShvaParams.Sum36");

      if (operation === undefined || operationResponse === undefined || dealResponse === undefined) {
        return { ok: false, failureCode: "not_completed" };
      }

      if (
        operation !== "1" ||
        operationResponse !== "0" ||
        dealResponse !== "0" ||
        !internalDealNumber ||
        responseTerminalNumber !== credentials.terminalNumber ||
        responseLowProfileCode !== request.lowProfileCode
      ) {
        return { ok: false, failureCode: "operation_failed" };
      }

      if (!returnValue || !coinId || !sum36) {
        return { ok: false, failureCode: "malformed_response" };
      }

      const coinIdNumber = Number(coinId);
      // Sum36 כבר באגורות (integer) - **לא** מחרוזת שקלים דו-ספרתית כמו SumToBill בבקשת ה-Create -
      // אין המרה כאן, השוואה ישירה מול expected_amount_agorot (ר' payment-indicator-service.ts).
      const amountAgorot = Number(sum36);
      if (!Number.isFinite(coinIdNumber) || !Number.isInteger(amountAgorot)) {
        return { ok: false, failureCode: "malformed_response" };
      }

      return { ok: true, fields: { internalDealNumber, returnValue, coinId: coinIdNumber, amountAgorot } };
    },
  };
}

export type CardcomClient = ReturnType<typeof createCardcomClient>;
