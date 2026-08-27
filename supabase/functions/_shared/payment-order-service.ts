// שכבת orchestration טהורה ל-create-payment-order - כל תלות חיצונית (מסד נתונים, Cardcom, יצירת
// token, שעון, לוג אנומליות) מוזרקת דרך PaymentOrderServiceDeps, לא נקראת ישירות (לא Deno.serve,
// לא import של Supabase client קונקרטי). מאפשר בדיקת ה-orchestration המלאה דרך Vitest עם fakes,
// בלי Deno runtime בכלל - ר' payment-order-service.test.ts. index.ts הוא ה-adapter הדק היחיד
// שמזריק את המימושים האמיתיים (Supabase, Cardcom, Web Crypto, new Date, console.warn).
//
// **מניעת הזמנות בלתי-מוגבלות (ממצא ביקורת "חובה לפני ניסיון אמיתי")**: הגנת ה-DB האמיתית היא
// ה-partial unique index על (report_id, product_type) ב-payment-schema.sql (commit שישי) - לא
// הבדיקות כאן. הבדיקות בקובץ הזה הן fast-path (נמנעות מ-round-trip מיותר ל-DB/Cardcom במקרה
// הרגיל) + טיפול ב-race שבו ה-index עצמו כן תפס משהו (ר' insertResult.ok===false למטה) - בלי
// זה, race אמיתי (שתי בקשות עם Idempotency-Key שונים כמעט בו-זמנית) היה מחזיר שגיאת unique
// גולמית ללקוח במקום למצוא את ההזמנה שניצחה ולפעול לפי מצבה.

import { getProduct, type ProductType } from "./payment-products.ts";

export type OrderStatus = "created" | "pending" | "paid" | "failed" | "cancelled" | "refunded";

export interface OrderRecord {
  id: string;
  status: OrderStatus;
  reportId: string;
  productType: ProductType;
  providerOrderReference: string;
  checkoutUrl: string | null;
}

export interface NewOrderInput {
  reportId: string;
  productType: ProductType;
  amountAgorot: number;
  currencyCode: number;
  idempotencyKey: string;
  providerOrderReference: string;
  accessTokenHash: string;
}

/** תוצאת insertOrder - **לא** תמיד "הצליח" יותר: אם ה-partial unique index (payment-schema.sql)
 *  תפס race (מישהו אחר יצר הזמנה חוסמת בין הבדיקה המוקדמת לבין ה-INSERT עצמו), מוחזר
 *  `{ ok: false }` - לא נזרקת שגיאת unique גולמית. ה-caller (createPaymentOrder למטה) מטפל
 *  בזה על ידי איתור ההזמנה שניצחה, בדיוק כמו בנתיב "יש כבר הזמנה חוסמת" הרגיל. */
export type InsertOrderResult = { ok: true; order: OrderRecord } | { ok: false };

export interface ReportLookupResult {
  found: boolean;
  /** dohefes_reports.payment_status הישן - ר' הערת "תאימות זמנית" למטה */
  paymentStatus: string | null;
}

export interface OrderEntitlementLookup {
  entitlementStatus: "active" | "revoked" | "refunded";
}

/** מופשט מעל Supabase - לא חושף client קונקרטי, כדי שאפשר יהיה להזריק fake ב-Vitest */
export interface PaymentOrderDatabase {
  getReportPaymentStatus(reportId: string): Promise<ReportLookupResult>;
  findOrderByIdempotencyKey(idempotencyKey: string): Promise<OrderRecord | null>;
  /** מחפשת הזמנה "חוסמת" קיימת (created/pending/paid בלבד - תואם בדיוק לפרדיקט של ה-partial
   *  unique index) לאותו report+product, **ללא תלות ב-idempotency_key** - זו ההגנה מול בקשה עם
   *  Idempotency-Key **שונה** שמנסה לפתוח הזמנה שנייה לאותו report+product. מוגדרת (על ידי
   *  ה-index) להחזיר לכל היותר שורה אחת - אין ריבוי-תוצאות אפשרי. */
  findBlockingOrderForProduct(reportId: string, productType: ProductType): Promise<OrderRecord | null>;
  insertOrder(input: NewOrderInput): Promise<InsertOrderResult>;
  updateAccessTokenHash(orderId: string, accessTokenHash: string): Promise<void>;
  markOrderPending(orderId: string, details: { cardcomLowProfileCode: string; checkoutUrl: string }): Promise<void>;
  markOrderFailed(orderId: string, failureCode: string): Promise<void>;
  getEntitlement(reportId: string, productType: ProductType): Promise<OrderEntitlementLookup | null>;
}

export interface CardcomClientLike {
  createLowProfile(request: {
    amountAgorot: number;
    productName: string;
    returnValue: string;
    successRedirectUrl: string;
    errorRedirectUrl: string;
    indicatorUrl: string;
  }): Promise<{ ok: true; result: { lowProfileCode: string; checkoutUrl: string } } | { ok: false; failureCode: string }>;
}

export interface TokenGenerator {
  generateAccessToken(): string;
  hashAccessToken(rawToken: string): Promise<string>;
  generateProviderOrderReference(): string;
}

/** מוזרק בכוונה (גם אם לא נצרך בלוגיקה כרגע) - כל timestamp שדורש "עכשיו" עתידי (למשל אם
 *  ה-service יתרחב לתעד ניסיון-אחרון-ב) יעבור דרך זה, לא new Date() ישיר, כדי להישאר דטרמיניסטי בבדיקות */
export type Clock = () => Date;

/** אירוע "חריג" (לא כשל תמים) - הזמנה paid בלי entitlement פעילה תואמת. **תמיד ללא PII/token/
 *  פרטי Cardcom** - רק reportId/productType (מזהים טכניים, לא מידע אישי) + reason כללי. */
export interface PaymentOrderAnomalyLogger {
  logAnomaly(event: { reason: string; reportId: string; productType: ProductType }): void;
}

export interface PaymentOrderServiceDeps {
  database: PaymentOrderDatabase;
  cardcomClient: CardcomClientLike;
  tokenGenerator: TokenGenerator;
  clock: Clock;
  anomalyLogger: PaymentOrderAnomalyLogger;
  successRedirectUrl: string;
  errorRedirectUrl: string;
  indicatorUrl: string;
}

export interface CreatePaymentOrderRequest {
  reportId: string;
  productType: ProductType;
  idempotencyKey: string;
}

export type CreatePaymentOrderResult =
  | { status: 200; body: { orderId: string; checkoutUrl: string; accessToken: string; status: "pending" } }
  | { status: 200; body: { status: "paid" | "failed" | "cancelled" | "refunded" } }
  | { status: 403; body: { error: "report_not_eligible" } }
  | { status: 409; body: { error: "idempotency_key_conflict" } }
  | { status: 500; body: { error: "internal_error" } }
  | { status: 502; body: { error: "payment_provider_error" } };

const NOT_ELIGIBLE = { status: 403 as const, body: { error: "report_not_eligible" as const } };
const PROVIDER_ERROR = { status: 502 as const, body: { error: "payment_provider_error" as const } };
const INTERNAL_ERROR = { status: 500 as const, body: { error: "internal_error" as const } };

/**
 * הרצף המלא:
 * 1. קיום דוח + (cashFlowAnalysis בלבד) בדיקת baseReport משולם - **תאימות זמנית** מול
 *    dohefes_reports.payment_status הישן, עד ש-baseReport עצמו יעבור ל-product_entitlements
 *    (GEN2_PAYMENT_ENTITLEMENT_DESIGN.md §6.2 שלב 4). הודעת השגיאה זהה בין "דוח לא קיים" ל-"קיים
 *    אך לא זכאי" - לא חושפים קיום דוח מעבר לנדרש.
 * 2. idempotency-key מדויק: אם כבר קיימת הזמנה עם המפתח הזה **בדיוק** - פועלים לפי מצבה (ר'
 *    respondToBlockingOrder למטה), לא יוצרים הזמנה נוספת.
 * 3. אם אין התאמה לפי idempotency-key: בודקים אם קיימת הזמנה **חוסמת** לאותו report+product
 *    תחת Idempotency-Key **אחר** (findBlockingOrderForProduct) - זו ההגנה מול "כל בקשה עם מפתח
 *    חדש = הזמנה חדשה + session חדש ב-Cardcom, בלי הגבלה".
 * 4. רק אם שום דבר לא חוסם - ניסיון insert אמיתי. אם ה-insert עצמו נכשל בגלל race (מישהו ניצח
 *    בין הבדיקה בשלב 3 לבין ה-insert) - מאתרים את המנצח ופועלים לפי מצבו, בדיוק כמו שלב 3,
 *    **לא** מחזירים שגיאת unique גולמית.
 * 5. פונה ל-Cardcom רק כשבאמת נדרש (הזמנה חדשה, או pending/created בלי checkoutUrl שמור עדיין).
 * 6. מחזירה רק orderId/checkoutUrl/accessToken/status - לא entitlement, לא פרטי Cardcom גולמיים.
 */
export async function createPaymentOrder(
  deps: PaymentOrderServiceDeps,
  request: CreatePaymentOrderRequest
): Promise<CreatePaymentOrderResult> {
  const { database } = deps;
  const { reportId, productType, idempotencyKey } = request;

  const report = await database.getReportPaymentStatus(reportId);
  if (!report.found) return NOT_ELIGIBLE;

  if (productType === "cashFlowAnalysis" && report.paymentStatus !== "paid") {
    return NOT_ELIGIBLE;
  }

  const existingOrder = await database.findOrderByIdempotencyKey(idempotencyKey);

  if (existingOrder) {
    if (existingOrder.reportId !== reportId || existingOrder.productType !== productType) {
      // אותו idempotency-key חייב להיות עקבי - לא "מוחלף" בשקט אם הבקשה השנייה שונה.
      return { status: 409, body: { error: "idempotency_key_conflict" } };
    }
    return await respondToBlockingOrder(deps, existingOrder);
  }

  const blockingOrder = await database.findBlockingOrderForProduct(reportId, productType);
  if (blockingOrder) {
    return await respondToBlockingOrder(deps, blockingOrder);
  }

  const product = getProduct(productType);
  const providerOrderReference = deps.tokenGenerator.generateProviderOrderReference();
  const rawToken = deps.tokenGenerator.generateAccessToken();
  const accessTokenHash = await deps.tokenGenerator.hashAccessToken(rawToken);

  const insertResult = await database.insertOrder({
    reportId,
    productType,
    amountAgorot: product.amountAgorot,
    currencyCode: product.currencyCode,
    idempotencyKey,
    providerOrderReference,
    accessTokenHash,
  });

  if (!insertResult.ok) {
    // race אמיתי בין הבדיקה למעלה לבין ה-insert - הרשת הבטוחה האמיתית היא ה-partial unique
    // index ב-DB (payment-schema.sql), לא הבדיקה הזו. מאתרים את ההזמנה שניצחה ופועלים לפי
    // מצבה - **לא** מחזירים שגיאת unique גולמית ללקוח.
    const winner = await database.findBlockingOrderForProduct(reportId, productType);
    if (!winner) {
      // תרחיש בלתי-צפוי: ה-insert נכשל אך אין הזמנה חוסמת בנמצא (למשל התנגשות חלפה כבר -
      // ההזמנה המנצחת עברה ל-failed/refunded בין הרגעים). לא מנחשים - כשל ספק כללי.
      return PROVIDER_ERROR;
    }
    return await respondToBlockingOrder(deps, winner);
  }

  const insertedOrder = insertResult.order;
  const cardcomOutcome = await callCardcomAndAdvance(deps, insertedOrder);
  if (!cardcomOutcome.ok) {
    return PROVIDER_ERROR;
  }

  return {
    status: 200,
    body: { orderId: insertedOrder.id, checkoutUrl: cardcomOutcome.checkoutUrl, accessToken: rawToken, status: "pending" },
  };
}

/** נתיב משותף להזמנה קיימת "חוסמת" - בין אם נמצאה לפי idempotency-key מדויק, לפי חיפוש
 *  report+product, או כמנצחת race על ה-insert. תמיד אחת משלוש: paid (ר' respondToPaidOrder),
 *  created/pending (מסובבת token, ר' rotateTokenAndEnsureCheckout), או מצב סופי לא-חוסם
 *  (failed/cancelled/refunded - לא אמור להגיע לכאן דרך findBlockingOrderForProduct, רק דרך
 *  idempotency-key מדויק על הזמנה ישנה - מוחזר כפי שהוא, בלי ניסיון retry אוטומטי). */
async function respondToBlockingOrder(deps: PaymentOrderServiceDeps, order: OrderRecord): Promise<CreatePaymentOrderResult> {
  if (order.status === "paid") {
    return await respondToPaidOrder(deps, order);
  }

  if (order.status === "created" || order.status === "pending") {
    return await rotateTokenAndEnsureCheckout(deps, order);
  }

  // failed/cancelled/refunded - מצב סופי, לא retryable אוטומטית תחת אותו idempotency-key/חיפוש.
  return { status: 200, body: { status: order.status } };
}

/** "אם קיימת הזמנה paid והרשאה פעילה, החזר status:paid בלי token ובלי session חדש. אם קיימת
 *  paid אך entitlement חסר או לא פעילה, אל תיצור תשלום נוסף ואל 'לתקן' בשקט; החזר מצב פנימי
 *  כללי ותעד אזהרה ללא מזהים רגישים." - entitlement.status !== 'active' עדיין נחשב "יש
 *  entitlement" לצורך זה (revoked/refunded הם מצבים לגיטימיים - למשל אחרי refund עתידי, שאותו
 *  refund **חייב** גם לעדכן payment_orders.status בעצמו, ר' payment-schema.sql commit שישי -
 *  ברגע שזה קורה, ההזמנה כבר לא תימצא כאן בכלל). רק **היעדר מוחלט** של entitlement מול הזמנה
 *  paid הוא האנומליה - מפר את הערבות של dohefes_finalize_verified_payment (מעדכן paid+entitlement
 *  יחד, אטומית) - חשוד מספיק כדי לא להמשיך בשקט. */
async function respondToPaidOrder(deps: PaymentOrderServiceDeps, order: OrderRecord): Promise<CreatePaymentOrderResult> {
  const entitlement = await deps.database.getEntitlement(order.reportId, order.productType);
  if (entitlement) {
    return { status: 200, body: { status: "paid" } };
  }
  deps.anomalyLogger.logAnomaly({
    reason: "paid_order_without_entitlement",
    reportId: order.reportId,
    productType: order.productType,
  });
  return INTERNAL_ERROR;
}

/** retry על הזמנה created/pending: מסובבת token תמיד, ומוודאת ש-Cardcom כבר נוצר - checkoutUrl
 *  כבר קיים = לא קוראים ל-Cardcom שוב, רק מחזירים את מה שכבר יש (אין session שני לאותה הזמנה).
 *  אם ההזמנה created ואין לה עדיין checkout תקין - ממשיכה את יצירת ה-session ל**אותה** הזמנה
 *  (callCardcomAndAdvance מעדכנת UPDATE, לא INSERT) - בלי הזמנה נוספת. */
async function rotateTokenAndEnsureCheckout(
  deps: PaymentOrderServiceDeps,
  order: OrderRecord
): Promise<CreatePaymentOrderResult> {
  const rawToken = deps.tokenGenerator.generateAccessToken();
  const accessTokenHash = await deps.tokenGenerator.hashAccessToken(rawToken);
  await deps.database.updateAccessTokenHash(order.id, accessTokenHash);

  if (order.status === "pending" && order.checkoutUrl) {
    return { status: 200, body: { orderId: order.id, checkoutUrl: order.checkoutUrl, accessToken: rawToken, status: "pending" } };
  }

  const cardcomOutcome = await callCardcomAndAdvance(deps, order);
  if (!cardcomOutcome.ok) {
    return PROVIDER_ERROR;
  }
  return { status: 200, body: { orderId: order.id, checkoutUrl: cardcomOutcome.checkoutUrl, accessToken: rawToken, status: "pending" } };
}

/** קוראת ל-Cardcom ליצירת LowProfile, ומעדכנת את ההזמנה בהתאם - pending+checkoutUrl בהצלחה,
 *  failed+failure_code כללי בכישלון (כולל timeout - ר' cardcom-client.ts, נופל לאותו כשל כללי).
 *  **אף פעם לא מסמנת paid כאן** - זו רק "נוצר דף תשלום". */
async function callCardcomAndAdvance(
  deps: PaymentOrderServiceDeps,
  order: OrderRecord
): Promise<{ ok: true; checkoutUrl: string } | { ok: false }> {
  const product = getProduct(order.productType);

  const outcome = await deps.cardcomClient.createLowProfile({
    amountAgorot: product.amountAgorot,
    productName: product.productName,
    returnValue: order.providerOrderReference,
    successRedirectUrl: deps.successRedirectUrl,
    errorRedirectUrl: deps.errorRedirectUrl,
    indicatorUrl: deps.indicatorUrl,
  });

  if (!outcome.ok) {
    await deps.database.markOrderFailed(order.id, outcome.failureCode);
    return { ok: false };
  }

  await deps.database.markOrderPending(order.id, {
    cardcomLowProfileCode: outcome.result.lowProfileCode,
    checkoutUrl: outcome.result.checkoutUrl,
  });
  return { ok: true, checkoutUrl: outcome.result.checkoutUrl };
}
