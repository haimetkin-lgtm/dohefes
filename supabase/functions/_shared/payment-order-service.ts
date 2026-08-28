// שכבת orchestration טהורה ל-dohefes-create-payment-order - כל תלות חיצונית (מסד נתונים, Cardcom, יצירת
// token, שעון, לוג אנומליות) מוזרקת דרך PaymentOrderServiceDeps, לא נקראת ישירות (לא Deno.serve,
// לא import של Supabase client קונקרטי). מאפשר בדיקת ה-orchestration המלאה דרך Vitest עם fakes,
// בלי Deno runtime בכלל - ר' payment-order-service.test.ts. index.ts הוא ה-adapter הדק היחיד
// שמזריק את המימושים האמיתיים (Supabase, Cardcom, Web Crypto, new Date, console.warn).
//
// **מניעת הזמנות בלתי-מוגבלות (ממצא ביקורת "חובה לפני ניסיון אמיתי")**: הגנת ה-DB האמיתית היא
// ה-partial unique index על (report_id, product_type) ב-migrations/20260828062934_dohefes_payment_infrastructure.sql (commit שישי) - לא
// הבדיקות כאן. הבדיקות בקובץ הזה הן fast-path (נמנעות מ-round-trip מיותר ל-DB/Cardcom במקרה
// הרגיל) + טיפול ב-race שבו ה-index עצמו כן תפס משהו (ר' insertResult.ok===false למטה) - בלי
// זה, race אמיתי (שתי בקשות עם Idempotency-Key שונים כמעט בו-זמנית) היה מחזיר שגיאת unique
// גולמית ללקוח במקום למצוא את ההזמנה שניצחה ולפעול לפי מצבה.
//
// **claim אטומי ליצירת LowProfile session (ממצא ביקורת נוסף, commit שביעי)**: ה-index למעלה
// מונע שתי **שורות** להזמנה אחת - הוא **לא** מונע שתי בקשות (Idempotency-Key שונים) שמאתרות
// את **אותה** שורה יחידה ב-status='created' ומנסות שתיהן לקרוא ל-Cardcom במקביל. advanceOrderToCheckout
// למטה עוטפת כל קריאה ל-Cardcom ב-claim (dohefes_claim_checkout_creation, ר' migrations/20260828062934_dohefes_payment_infrastructure.sql) -
// רק בעל ה-claim קורא ל-Cardcom בפועל; המפסיד מקבל תגובה כללית retryable, בלי token מטעה.

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

/** תוצאת insertOrder - **לא** תמיד "הצליח" יותר: אם ה-partial unique index (migrations/20260828062934_dohefes_payment_infrastructure.sql)
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

/** תוצאת claimCheckoutCreation - עוטפת את dohefes_claim_checkout_creation (RPC, UPDATE אטומי
 *  יחיד בתבנית CAS - לא select+update). claimed:false לא מבחינה בין "claim אחר פעיל" ל"ההזמנה
 *  כבר לא created" - שני המקרים מטופלים זהה (retryable, ר' advanceOrderToCheckout). */
export interface ClaimResult {
  claimed: boolean;
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
  /** claim אטומי - UPDATE יחיד, לא select+update (ר' dohefes_claim_checkout_creation). לא קוראת
   *  ל-Cardcom, לא מחזיקה שום דבר פתוח מעבר לזמן ה-UPDATE עצמו - הקריאה ל-Cardcom קורית **אחרי**
   *  שהפונקציה הזו כבר חזרה, ללא טרנזקציה/נעילה פתוחה מצידנו. */
  claimCheckoutCreation(orderId: string, claimToken: string, leaseSeconds: number): Promise<ClaimResult>;
  /** משחררת claim בהצלחה - שומרת LowProfileCode+checkout_url, עוברת pending, מוחקת את ה-claim.
   *  **מותנית** בכך ש-claimToken עדיין תואם (לא נלקח על ידי claim חדש בינתיים, למשל אם חרגנו
   *  מה-lease) - מחזירה false אם ההתאמה נכשלה, כדי שהקוד הקורא לא ימסור checkoutUrl שאולי כבר
   *  לא קנוני. */
  releaseClaimAsPending(orderId: string, claimToken: string, details: { cardcomLowProfileCode: string; checkoutUrl: string }): Promise<boolean>;
  /** משחררת claim בכשל **ודאי** (לא timeout/תוצאה לא ודאית - ר' isAmbiguousCardcomFailure) -
   *  מסמנת failed, לפי מדיניות הכשל הקיימת. גם היא מותנית ב-claimToken תואם - **גם כאן** מחזירה
   *  boolean (ממצא ביקורת סופית: לא מספיק שה-UPDATE עצמו מותנה נכון - הקוד הקורא חייב לבדוק את
   *  זה בפועל, אחרת כשל "השתלטות claim" כאן היה נבלע בשקט, בלי לדעת שה-failed בכלל לא נכתב). */
  releaseClaimAsFailed(orderId: string, claimToken: string, failureCode: string): Promise<boolean>;
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
  /** claim token פנימי - **לעולם לא** מוחזר ללקוח, שונה במפורש מ-generateAccessToken. */
  generateClaimToken(): string;
}

/** מוזרק בכוונה (גם אם לא נצרך בלוגיקה כרגע) - כל timestamp שדורש "עכשיו" עתידי (למשל אם
 *  ה-service יתרחב לתעד ניסיון-אחרון-ב) יעבור דרך זה, לא new Date() ישיר, כדי להישאר דטרמיניסטי בבדיקות */
export type Clock = () => Date;

/** אירוע "חריג" (לא כשל תמים) - הזמנה paid בלי entitlement פעילה תואמת. **תמיד ללא PII/token/
 *  פרטי Cardcom, ובכוונה גם בלי reportId** - reportId משמש בפועל כמזהה גישה לדוח (קישור פרטי,
 *  ר' "Supabase ללא Auth") - לא נכתב ללוג גם אם הוא "רק" UUID טכני. רק reason+productType. */
export interface PaymentOrderAnomalyLogger {
  logAnomaly(event: { reason: string; productType: ProductType }): void;
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
  | { status: 200; body: { orderId: string; checkoutUrl: string; accessToken: string; paymentContextId: string; status: "pending" } }
  | { status: 200; body: { status: "paid" | "failed" | "cancelled" | "refunded" } }
  | { status: 403; body: { error: "report_not_eligible" } }
  | { status: 409; body: { error: "idempotency_key_conflict" } }
  | { status: 500; body: { error: "internal_error" } }
  | { status: 502; body: { error: "payment_provider_error" } }
  | { status: 503; body: { error: "checkout_creation_in_progress" } };

const NOT_ELIGIBLE = { status: 403 as const, body: { error: "report_not_eligible" as const } };
const PROVIDER_ERROR = { status: 502 as const, body: { error: "payment_provider_error" as const } };
const INTERNAL_ERROR = { status: 500 as const, body: { error: "internal_error" as const } };
const CHECKOUT_IN_PROGRESS = { status: 503 as const, body: { error: "checkout_creation_in_progress" as const } };

/** lease ה-claim - חייב להיות ארוך יותר מ-CARDCOM_FETCH_TIMEOUT_MS (15_000ms, ר' cardcom-client.ts)
 *  כדי שקריאת Cardcom לגיטימית תמיד תספיק להסתיים בתוכו. 30 שניות: פי 2 מ-timeout ה-fetch עצמו -
 *  שוליים ל-round-trip-ים הנוספים של ה-DB (claim + release) סביב קריאת הרשת. */
const CHECKOUT_CLAIM_LEASE_SECONDS = 30;

/** provider_unreachable/provider_http_* - כשל **לא ודאי**: ייתכן ש-Cardcom כן עיבדה את הבקשה
 *  (יצרה session) והתשובה פשוט לא הגיעה/אבדה (timeout/רשת) - אין ראיה רשמית לכך שניתן לשחזר/
 *  לאתר session קיים אצל Cardcom לפי provider_order_reference (רק לפי LowProfileCode, שאין לנו
 *  אם התשובה עצמה אבדה) - לכן **לא** מסמנים failed (שהיה משחרר את ה-partial unique index
 *  ומאפשר ניסיון חדש מיידי, כפול-session אפשרי) - ה-claim פשוט פוקע לפי ה-lease. שאר הקודים
 *  (provider_rejected/provider_missing_fields/provider_untrusted_checkout_url/invalid_amount/
 *  invalid_callback_url_config) הם תגובה **מלאה ומובנת** מ-Cardcom (או כשל ולידציה מקומי לפני
 *  שיצאה בקשה בכלל) - ודאיים, בטוחים לסמן failed מיד. */
function isAmbiguousCardcomFailure(failureCode: string): boolean {
  return failureCode === "provider_unreachable" || failureCode.startsWith("provider_http_");
}

/**
 * הרצף המלא:
 * 1. קיום דוח + (cashFlowAnalysis בלבד) בדיקת baseReport משולם - **תאימות זמנית** מול
 *    dohefes_reports.payment_status הישן, עד ש-baseReport עצמו יעבור ל-product_entitlements
 *    (GEN2_PAYMENT_ENTITLEMENT_DESIGN.md §6.2 שלב 4). הודעת השגיאה זהה בין "דוח לא קיים" ל-"קיים
 *    אך לא זכאי" - לא חושפים קיום דוח מעבר לנדרש.
 * 2. idempotency-key מדויק: אם כבר קיימת הזמנה עם המפתח הזה **בדיוק** - פועלים לפי מצבה (ר'
 *    respondToBlockingOrder למטה), לא יוצרים הזמנה נוספת.
 * 3. אם אין התאמה לפי idempotency-key: בודקים אם קיימת הזמנה **חוסמת** לאותו report+product
 *    תחת Idempotency-Key **אחר** (findBlockingOrderForProduct).
 * 4. רק אם שום דבר לא חוסם - ניסיון insert אמיתי. אם ה-insert עצמו נכשל בגלל race - מאתרים
 *    את המנצח ופועלים לפי מצבו, **לא** מחזירים שגיאת unique גולמית.
 * 5. יצירת/המשך checkout: תמיד דרך advanceOrderToCheckout, שעוטפת claim אטומי - רק בעל ה-claim
 *    קורא בפועל ל-Cardcom. מפסיד ה-claim מקבל checkout_creation_in_progress (503), בלי token.
 * 6. מחזירה רק orderId/checkoutUrl/accessToken/paymentContextId/status - לא entitlement, לא פרטי
 *    Cardcom גולמיים. paymentContextId (=providerOrderReference הפנימי) הוא מזהה הקשר בלבד -
 *    ר' ההערה ליד ה-return בפועל ב-rotateTokenAndEnsureCheckout - אינו secret, אינו access token,
 *    אינו הוכחת תשלום, ואינו נשלח בחזרה לשום endpoint.
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

  const insertResult = await database.insertOrder({
    reportId,
    productType,
    amountAgorot: product.amountAgorot,
    currencyCode: product.currencyCode,
    idempotencyKey,
    providerOrderReference,
    // access_token_hash הראשוני: נכתב רק כדי לספק ערך not-null בשורה - מוחלף מיד בכל מקרה על ידי
    // rotateTokenAndEnsureCheckout (למטה) לפני שנמסר ללקוח, גם בנתיב היצירה הטרייה - אף אחד
    // אף פעם לא מקבל את הערך הזמני הזה.
    accessTokenHash: await deps.tokenGenerator.hashAccessToken(deps.tokenGenerator.generateAccessToken()),
  });

  if (!insertResult.ok) {
    // race אמיתי בין הבדיקה למעלה לבין ה-insert - הרשת הבטוחה האמיתית היא ה-partial unique
    // index ב-DB (migrations/20260828062934_dohefes_payment_infrastructure.sql), לא הבדיקה הזו. מאתרים את ההזמנה שניצחה ופועלים לפי
    // מצבה - **לא** מחזירים שגיאת unique גולמית ללקוח.
    const winner = await database.findBlockingOrderForProduct(reportId, productType);
    if (!winner) {
      return PROVIDER_ERROR;
    }
    return await respondToBlockingOrder(deps, winner);
  }

  return await rotateTokenAndEnsureCheckout(deps, insertResult.order);
}

/** נתיב משותף להזמנה קיימת "חוסמת" - בין אם נמצאה לפי idempotency-key מדויק, לפי חיפוש
 *  report+product, או כמנצחת race על ה-insert. */
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
 *  paid אך entitlement חסר, אל תיצור תשלום נוסף ואל 'לתקן' בשקט; החזר מצב פנימי כללי ותעד
 *  אזהרה ללא מזהים רגישים." - entitlement.status !== 'active' עדיין נחשב "יש entitlement"
 *  לצורך זה (revoked/refunded לגיטימיים, למשל אחרי refund עתידי - שחייב גם לעדכן
 *  payment_orders.status, ר' migrations/20260828062934_dohefes_payment_infrastructure.sql commit שישי). רק **היעדר מוחלט** של entitlement
 *  מול הזמנה paid הוא האנומליה - מפר את הערבות של dohefes_finalize_verified_payment. */
async function respondToPaidOrder(deps: PaymentOrderServiceDeps, order: OrderRecord): Promise<CreatePaymentOrderResult> {
  const entitlement = await deps.database.getEntitlement(order.reportId, order.productType);
  if (entitlement) {
    return { status: 200, body: { status: "paid" } };
  }
  // reportId **לא** נכלל בכוונה - הוא מזהה גישה לדוח בפועל (קישור פרטי, ר' "Supabase ללא Auth"),
  // לא רק "מזהה טכני" - לא נכתב ללוג גם כ-UUID.
  deps.anomalyLogger.logAnomaly({ reason: "paid_order_without_entitlement", productType: order.productType });
  return INTERNAL_ERROR;
}

/** מסובבת token **רק אחרי** שכבר יש checkout מוכן בפועל (קיים מראש, או הרגע נוצר בהצלחה) -
 *  לעולם לא לפני, כדי לא "לשרוף" רוטציה על תגובה שממילא לא מוסרת את הטוקן החדש ללקוח (retryable). */
async function rotateTokenAndEnsureCheckout(
  deps: PaymentOrderServiceDeps,
  order: OrderRecord
): Promise<CreatePaymentOrderResult> {
  const advance = await advanceOrderToCheckout(deps, order);
  if (!advance.ok) {
    return advance.retryable ? CHECKOUT_IN_PROGRESS : PROVIDER_ERROR;
  }

  const rawToken = deps.tokenGenerator.generateAccessToken();
  const accessTokenHash = await deps.tokenGenerator.hashAccessToken(rawToken);
  await deps.database.updateAccessTokenHash(order.id, accessTokenHash);

  return {
    status: 200,
    body: {
      orderId: order.id,
      checkoutUrl: advance.checkoutUrl,
      accessToken: rawToken,
      // ה-ReturnValue המדויק שכבר נשלח ל-Cardcom ביצירת ה-LowProfile session (ר' advanceOrderToCheckout
      // -> cardcomClient.createLowProfile -> returnValue: order.providerOrderReference). שם ציבורי
      // מכוון - "paymentContextId" לא "providerOrderReference"/"cardcomReturnValue" - כדי לא לחשוף
      // ב-response שם ספק פנימי. ידיעת הערך הזה **לא** מקנה גישה לשום דבר - הוא לעולם לא נשלח
      // בחזרה לשום Edge Function, משמש רק כמפתח local-only למפת ה-pendingPurchase בצד הלקוח (ר'
      // GEN2_CASHFLOW_UI_DESIGN.md §0.1.5) כדי לדעת לאיזו רשומה מקומית להתאים את חזרת הדפדפן
      // מ-Cardcom - ההרשאה בפועל תמיד עוברת רק דרך dohefes-get-product-access + access token.
      paymentContextId: order.providerOrderReference,
      status: "pending",
    },
  };
}

/**
 * מוודאת שלהזמנה יש checkout מוכן, תוך claim אטומי כדי שרק **בעל אחד** בכל רגע נתון קורא בפועל
 * ל-Cardcom (ר' הערת commit שביעי בראש הקובץ + ב-migrations/20260828062934_dohefes_payment_infrastructure.sql לנימוק המלא):
 * - כבר pending+checkoutUrl -> fast-path, אין claim בכלל, אין קריאה ל-Cardcom.
 * - claim נכשל (claim אחר פעיל, או שההזמנה כבר לא created) -> retryable, בלי לגעת ב-Cardcom.
 * - claim הצליח -> קריאה **יחידה** ל-Cardcom, בלי טרנזקציה/נעילה פתוחה מצידנו בזמן ההמתנה לרשת.
 *   הצלחה -> משחררת claim + pending. כשל ודאי -> משחררת claim + failed (מדיניות קיימת). כשל לא
 *   ודאי (timeout/5xx) -> **לא** משחררת - ה-claim פוקע לפי ה-lease, retryable בינתיים.
 */
async function advanceOrderToCheckout(
  deps: PaymentOrderServiceDeps,
  order: OrderRecord
): Promise<{ ok: true; checkoutUrl: string } | { ok: false; retryable: boolean }> {
  if (order.status === "pending" && order.checkoutUrl) {
    return { ok: true, checkoutUrl: order.checkoutUrl };
  }

  const claimToken = deps.tokenGenerator.generateClaimToken();
  const claim = await deps.database.claimCheckoutCreation(order.id, claimToken, CHECKOUT_CLAIM_LEASE_SECONDS);
  if (!claim.claimed) {
    return { ok: false, retryable: true };
  }

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
    if (isAmbiguousCardcomFailure(outcome.failureCode)) {
      return { ok: false, retryable: true };
    }
    const released = await deps.database.releaseClaimAsFailed(order.id, claimToken, outcome.failureCode);
    if (!released) {
      // איבדנו את ה-claim בין הכשל הודאי לבין הניסיון לרשום אותו (חריגה נדירה מה-lease) - ה-
      // failed **לא** נכתב בפועל (מישהו אחר כבר בעל השורה עכשיו). לא מוסתר: מתועדת אזהרה, וה
      // תגובה ללקוח היא retryable (לא failed) - כי גורלה של ההזמנה כרגע ביד הבעלים החדש, לא ודאי-כשל מבחינתנו.
      deps.anomalyLogger.logAnomaly({ reason: "claim_release_as_failed_lost_ownership", productType: order.productType });
      return { ok: false, retryable: true };
    }
    return { ok: false, retryable: false };
  }

  const released = await deps.database.releaseClaimAsPending(order.id, claimToken, {
    cardcomLowProfileCode: outcome.result.lowProfileCode,
    checkoutUrl: outcome.result.checkoutUrl,
  });
  if (!released) {
    // איבדנו את ה-claim בין סיום קריאת Cardcom לבין השחרור (חריגה נדירה מה-lease) - לא מוסרים
    // checkoutUrl שאולי כבר לא קנוני; הקורא יחזור ויקבל את המצב הנוכחי בפועל.
    return { ok: false, retryable: true };
  }

  return { ok: true, checkoutUrl: outcome.result.checkoutUrl };
}
