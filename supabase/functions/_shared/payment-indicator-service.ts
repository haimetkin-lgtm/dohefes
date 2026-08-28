// שכבת orchestration טהורה ל-dohefes-cardcom-payment-indicator - כל תלות חיצונית (מסד נתונים, Cardcom)
// מוזרקת דרך PaymentIndicatorServiceDeps, לא נקראת ישירות. מאפשר בדיקת ה-orchestration המלאה
// דרך Vitest עם fakes, בלי Deno runtime בכלל - ר' payment-indicator-service.test.ts. index.ts
// הוא ה-adapter הדק היחיד שמזריק את המימושים האמיתיים (Supabase, Cardcom).
//
// **עיקרון האבטחה המרכזי**: הפרמטר היחיד שמגיע מגוף/query הבקשה הנכנסת (ה-webhook) ונקרא בכלל
// הוא lowProfileCode. שום שדה אחר שעשוי להגיע באותה בקשה (amount/status/deal number וכו', גם
// אם מישהו זייף אותם בכוונה) לא נקרא בשום שלב על ידי הקוד הזה. כל עובדה נוספת (הצלחה/כישלון
// בפועל, סכום, מטבע, ReturnValue, מספר עסקה) מגיעה אך ורק מקריאת server-to-server אמיתית
// ל-Cardcom (cardcomClient.getLowProfileIndicator) - תוכן ה-webhook עצמו הוא רק "טריגר לבדוק",
// לא מקור מידע.
//
// **כתיבה יחידה מותרת**: database.finalizeVerifiedPayment (עוטפת את ה-RPC dohefes_finalize_verified_payment,
// ר' migrations/20260828062934_dohefes_payment_infrastructure.sql). אין כאן, ולא יהיה כאן, שום UPDATE/INSERT ישיר על payment_orders/
// product_entitlements - אם משהו דורש mutation שה-RPC לא תומך בו (למשל "סימון failed"), הפתרון
// הוא להרחיב את ה-RPC בהמשך, לא לעקוף אותו מכאן.

export interface OrderForVerification {
  id: string;
  reportId: string;
  productType: string;
  providerOrderReference: string;
  expectedAmountAgorot: number;
  currencyCode: number;
}

export type FinalizeOutcomeCode =
  | "finalized"
  | "already_finalized"
  | "deal_mismatch"
  | "terminal_state"
  | "deal_number_conflict"
  | "verification_mismatch"
  | "not_found"
  | "invalid_input";

export interface FinalizeOutcome {
  outcome: FinalizeOutcomeCode;
  orderId: string | null;
  reportId: string | null;
  productType: string | null;
  entitlementId: string | null;
}

/** אירועים "חשודים" (לא כשלים תמימים) שראוי לתעד - תמיד ללא PII, ובכוונה **גם בלי lowProfileCode**
 *  (ממצא ביקורת סופית: LowProfileCode הוא בפועל מזהה-גישה לדף התשלום של Cardcom עצמו - לא רק
 *  "מזהה טכני סתמי", דומה בעיקרון ל-reportId שהוחלט לא לרשום מאותה סיבה, ר' payment-order-service.ts).
 *  רק reason כללי + productType (אם ידוע) - ר' index.ts למימוש הרישום עצמו (כרגע console.error,
 *  אין טבלת audit ייעודית בשלב הזה). זהה במפורש לתת-הקבוצה של FinalizeOutcomeCode שנחשבת חשודה
 *  (SECURITY_EVENT_OUTCOMES למטה) + "verification_mismatch" (נתפס כבר בשכבה הזו, לפני ה-RPC). */
export type SecurityEventReason = "verification_mismatch" | "deal_mismatch" | "deal_number_conflict" | "not_found";

export interface PaymentIndicatorDatabase {
  /** קריאה בלבד - לא mutation. נדרשת כדי להשוות את מה ש-Cardcom אישרה מול מה שאנחנו כבר יודעים
   *  על ההזמנה (ReturnValue/CoinId/Sum36 מול provider_order_reference/currency_code/expected_amount_agorot) -
   *  זו בדיקה **ראשונה, מוקדמת** (fast-path: נמנעת מקריאת RPC מיותרת ורושמת אירוע אבטחה כאן
   *  ישירות) - ה-RPC עצמו (ר' migrations/20260828062934_dohefes_payment_infrastructure.sql, commit חמישי) **גם הוא** מבצע את אותה השוואה
   *  באופן עצמאי מול השורה שהוא נועל, כהגנת-עומק - שתי הבדיקות מכוונות, לא כפילות מיותרת: זו
   *  כאן ממשיכה לעבוד גם אם ה-RPC אי-פעם ישונה/יוסר את הבדיקה הפנימית שלו, וההפך. */
  getOrderByLowProfileCode(lowProfileCode: string): Promise<OrderForVerification | null>;
  finalizeVerifiedPayment(
    lowProfileCode: string,
    cardcomInternalDealNumber: string,
    verifiedProviderOrderReference: string,
    verifiedAmountAgorot: number,
    verifiedCurrencyCode: number
  ): Promise<FinalizeOutcome>;
  /** **בלי lowProfileCode** (ר' הערת SecurityEventReason למעלה) - רק reason + productType, כשידוע. */
  recordSecurityEvent(event: { reason: SecurityEventReason; productType: string | null }): Promise<void>;
}

export interface CardcomIndicatorClientLike {
  getLowProfileIndicator(
    request: { lowProfileCode: string }
  ): Promise<
    | { ok: true; fields: { internalDealNumber: string; returnValue: string; coinId: number; amountAgorot: number } }
    | { ok: false; failureCode: string }
  >;
}

export interface PaymentIndicatorServiceDeps {
  database: PaymentIndicatorDatabase;
  cardcomClient: CardcomIndicatorClientLike;
}

/** רק שני קודי סטטוס בפועל: 200 (טופל - הצלחה, כשל סופי, או "אין מה לעשות"; Cardcom לא צריכה
 *  לנסות שוב), או 503 (כשל תקשורת זמני / העסקה עוד לא נרשמה סופית אצל Cardcom - retryable).
 *  בכוונה **לא** חושף קוד/פירוט מעבר לזה כלפי חוץ - הגוף הכללי הזה (לא מבחין בין "הזמנה לא
 *  קיימת" ל"אי-התאמת סכום" ל"כבר טופל") הוא מה שמונע דליפת מידע למי שפונה לנקודת הקצה הזו. */
export interface IndicatorResult {
  httpStatus: 200 | 503;
}

const RETRYABLE_FAILURE_CODES = new Set(["provider_unreachable", "not_completed"]);
const RETRYABLE_HTTP_PREFIX = "provider_http_";

const SECURITY_EVENT_OUTCOMES = new Set<FinalizeOutcomeCode>([
  "deal_mismatch",
  "deal_number_conflict",
  "verification_mismatch",
  "not_found",
]);

export async function handleIndicatorCallback(
  deps: PaymentIndicatorServiceDeps,
  lowProfileCode: string | null
): Promise<IndicatorResult> {
  if (!lowProfileCode) {
    // אין מה לאמת - לא retryable (אין LowProfileCode שיופיע בניסיון חוזר), אין תגובה מטעה.
    return { httpStatus: 200 };
  }

  const indicatorOutcome = await deps.cardcomClient.getLowProfileIndicator({ lowProfileCode });

  if (!indicatorOutcome.ok) {
    const isRetryable =
      RETRYABLE_FAILURE_CODES.has(indicatorOutcome.failureCode) || indicatorOutcome.failureCode.startsWith(RETRYABLE_HTTP_PREFIX);
    return { httpStatus: isRetryable ? 503 : 200 };
  }

  const order = await deps.database.getOrderByLowProfileCode(lowProfileCode);
  if (!order) {
    // הזמנה לא ידועה - תגובה כללית זהה לכל מקרה "טופל" אחר, בלי לחשוף (אי-)קיום.
    return { httpStatus: 200 };
  }

  const { fields } = indicatorOutcome;
  const matches =
    fields.returnValue === order.providerOrderReference &&
    fields.coinId === order.currencyCode &&
    fields.amountAgorot === order.expectedAmountAgorot;

  if (!matches) {
    await deps.database.recordSecurityEvent({ reason: "verification_mismatch", productType: order.productType });
    return { httpStatus: 200 };
  }

  const finalizeResult = await deps.database.finalizeVerifiedPayment(
    lowProfileCode,
    fields.internalDealNumber,
    fields.returnValue,
    fields.amountAgorot,
    fields.coinId
  );

  if (SECURITY_EVENT_OUTCOMES.has(finalizeResult.outcome)) {
    await deps.database.recordSecurityEvent({ reason: finalizeResult.outcome as SecurityEventReason, productType: finalizeResult.productType });
  }

  return { httpStatus: 200 };
}
