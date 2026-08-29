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
//
// --- Commit 6a (baseReport secure backend) ---
//
// שני ענפים נפרדים לגמרי ב-createPaymentOrder, לפי productType, ר' CreatePaymentOrderRequest:
//   - baseReport: אין reportId מהלקוח בכלל - הדוח **עדיין לא קיים**. draft+order נוצרים יחד,
//     אטומית, בתוך dohefes_create_base_report_payment_order (RPC יחיד, ר'
//     migrations/20260829151144_dohefes_base_report_secure_backend.sql) - **לא** שתי קריאות
//     Supabase עוקבות מה-Edge Function (לא טרנזקציה אמיתית, ר' audit ה-blocker). כל מה
//     שקורה **אחרי** יצירת ה-draft+order (claim/lease, קריאת Cardcom, סיבוב token) משתמש
//     **באותו קוד בדיוק** כמו מוצרי המשך - createBaseReportOrder/createAddOnOrder שתיהן
//     מסתיימות באותה קריאה ל-rotateTokenAndEnsureCheckout, שלא משוכפלת בשום מקום.
//   - כל מוצר המשך (cashFlowAnalysis/trackingReports): reportId כבר קיים, נדרש entitlement
//     **פעיל** מסוג baseReport לאותו reportId - **לא** dohefes_reports.payment_status (הוסר
//     כליל מהקובץ הזה, ר' PaymentOrderDatabase - אין עוד getReportPaymentStatus). היעדר
//     entitlement מכסה גם "דוח לא קיים" וגם "קיים אך baseReport לא פעיל/בוטל" - אותה תגובה
//     גנרית (403 report_not_eligible) לשני המקרים, לא חושפים קיום דוח.

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
 *  `{ ok: false }` - לא נזרקת שגיאת unique גולמית. ה-caller (createAddOnOrder למטה) מטפל
 *  בזה על ידי איתור ההזמנה שניצחה, בדיוק כמו בנתיב "יש כבר הזמנה חוסמת" הרגיל. */
export type InsertOrderResult = { ok: true; order: OrderRecord } | { ok: false };

export interface OrderEntitlementLookup {
  entitlementStatus: "active" | "revoked" | "refunded";
}

/** קלט ל-createBaseReportDraftAndOrder - dealType כבר אומת (isDealType, ר'
 *  create-payment-order-request-parser.ts) **לפני** שהוא מגיע לכאן; amountAgorot/currencyCode
 *  מגיעים מה-registry (payment-products.ts) בלבד, לעולם לא מהלקוח - אותו עיקרון בדיוק כמו
 *  NewOrderInput הרגילה. */
export interface NewBaseReportDraftInput {
  dealType: string;
  idempotencyKey: string;
  amountAgorot: number;
  currencyCode: number;
  providerOrderReference: string;
  accessTokenHash: string;
}

/**
 * תוצאת createBaseReportDraftAndOrder - עוטפת קריאה ל-dohefes_create_base_report_payment_order
 * (RPC אטומית, ר' המיגרציה). שלושה outcome:
 *   - 'created': draft+order נוצרו יחד בהצלחה, order כולל reportId שנוצר עכשיו.
 *   - 'idempotency_race': שתי בקשות עם אותו idempotency-key ניסו ליצור draft+order בו-זמנית -
 *     ה-RPC כבר דאגה (exception block יחיד סביב שני ה-INSERTs) שהמפסידה לא משאירה draft יתום -
 *     ה-caller מאתר את המנצחת דרך findOrderByIdempotencyKey, בדיוק כמו race על insertOrder
 *     הרגילה (ר' createPaymentOrder למטה).
 *   - 'invalid_deal_type': לא אמור לקרות בזרימה תקינה (ה-Edge Function כבר מסננת) - הגנת-עומק.
 */
export type CreateBaseReportDraftOutcome =
  | { outcome: "created"; order: OrderRecord }
  | { outcome: "idempotency_race" }
  | { outcome: "invalid_deal_type" };

/** תוצאת claimCheckoutCreation - עוטפת את dohefes_claim_checkout_creation (RPC, UPDATE אטומי
 *  יחיד בתבנית CAS - לא select+update). claimed:false לא מבחינה בין "claim אחר פעיל" ל"ההזמנה
 *  כבר לא created" - שני המקרים מטופלים זהה (retryable, ר' advanceOrderToCheckout). */
export interface ClaimResult {
  claimed: boolean;
}

/** מופשט מעל Supabase - לא חושף client קונקרטי, כדי שאפשר יהיה להזריק fake ב-Vitest.
 *  **אין getReportPaymentStatus** (הוסרה, Commit 6a) - מוצרי המשך נבדקים דרך getEntitlement
 *  בלבד (entitlement פעיל של baseReport), לא דרך dohefes_reports.payment_status. */
export interface PaymentOrderDatabase {
  findOrderByIdempotencyKey(idempotencyKey: string): Promise<OrderRecord | null>;
  /** מחפשת הזמנה "חוסמת" קיימת (created/pending/paid בלבד - תואם בדיוק לפרדיקט של ה-partial
   *  unique index) לאותו report+product, **ללא תלות ב-idempotency_key** - זו ההגנה מול בקשה עם
   *  Idempotency-Key **שונה** שמנסה לפתוח הזמנה שנייה לאותו report+product. מוגדרת (על ידי
   *  ה-index) להחזיר לכל היותר שורה אחת - אין ריבוי-תוצאות אפשרי. */
  findBlockingOrderForProduct(reportId: string, productType: ProductType): Promise<OrderRecord | null>;
  insertOrder(input: NewOrderInput): Promise<InsertOrderResult>;
  /** יצירת draft+order אטומית עבור baseReport בלבד - ר' NewBaseReportDraftInput/
   *  CreateBaseReportDraftOutcome למעלה. תמיד קוראת ל-dohefes_create_base_report_payment_order
   *  (RPC יחיד), לעולם לא INSERT ישיר על dohefes_reports/dohefes_payment_orders משתי קריאות
   *  נפרדות - ר' audit ה-blocker ("שתי קריאות Supabase עוקבות אינן טרנזקציה"). */
  createBaseReportDraftAndOrder(input: NewBaseReportDraftInput): Promise<CreateBaseReportDraftOutcome>;
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

/**
 * union מבחין אמיתי (Commit 6a) - לא reportId+productType גנרי יותר: baseReport (הדוח עדיין
 * לא קיים) שולח dealType ו**לא** reportId; כל מוצר המשך שולח reportId ו**לא** dealType. אכיפת
 * הצורה בפועל מול קלט HTTP חיצוני (JSON גולמי) קורית ב-create-payment-order-request-parser.ts,
 * לא כאן - הטיפוס הזה הוא כבר התוצאה **המאומתת**.
 */
export type CreatePaymentOrderRequest =
  | { productType: "baseReport"; dealType: string; idempotencyKey: string }
  | { productType: Exclude<ProductType, "baseReport">; reportId: string; idempotencyKey: string };

export type CreatePaymentOrderResult =
  | {
      status: 200;
      body: { reportId: string; orderId: string; checkoutUrl: string; accessToken: string; paymentContextId: string; status: "pending" };
    }
  | { status: 200; body: { reportId: string; status: "paid" | "failed" | "cancelled" | "refunded" } }
  | { status: 400; body: { error: "invalid_deal_type" } }
  | { status: 403; body: { error: "report_not_eligible" } }
  | { status: 409; body: { error: "idempotency_key_conflict" } }
  | { status: 500; body: { error: "internal_error" } }
  | { status: 502; body: { error: "payment_provider_error" } }
  | { status: 503; body: { error: "checkout_creation_in_progress" } };

const NOT_ELIGIBLE = { status: 403 as const, body: { error: "report_not_eligible" as const } };
const INVALID_DEAL_TYPE = { status: 400 as const, body: { error: "invalid_deal_type" as const } };
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
 * נקודת הכניסה היחידה - מפצלת לפי productType לשני ענפים עצמאיים (ר' הערת הכותרת למעלה).
 * שני הענפים חולקים את אותה תשתית downstream (respondToBlockingOrder/rotateTokenAndEnsureCheckout/
 * advanceOrderToCheckout) - לא משוכפלת, רק נקודת הכניסה ליצירת ההזמנה עצמה שונה.
 */
export async function createPaymentOrder(
  deps: PaymentOrderServiceDeps,
  request: CreatePaymentOrderRequest
): Promise<CreatePaymentOrderResult> {
  if (request.productType === "baseReport") {
    return await createBaseReportOrder(deps, request);
  }
  return await createAddOnOrder(deps, request);
}

/**
 * baseReport בלבד - **אין reportId מהלקוח**, הדוח עדיין לא קיים. הרצף:
 * 1. idempotency-key מדויק: אם כבר קיימת הזמנה עם המפתח הזה **בדיוק** (retry רגיל, לא race -
 *    ה-draft+order כבר נוצרו בקריאה קודמת) - פועלים לפי מצבה, **לא** קוראים ל-RPC האטומית שוב.
 * 2. אחרת: קריאה יחידה ל-createBaseReportDraftAndOrder (RPC אטומית - draft+order יחד, ר'
 *    NewBaseReportDraftInput). 'invalid_deal_type' -> 400. 'idempotency_race' -> מאתרים את
 *    המנצחת (findOrderByIdempotencyKey) ופועלים לפי מצבה - אותו עיקרון בדיוק כמו race על
 *    insertOrder הרגילה, רק שכאן ה-RPC עצמה (לא ה-partial unique index) מגלה את המרוץ.
 * 3. יצירת/המשך checkout: rotateTokenAndEnsureCheckout, **אותה פונקציה בדיוק** שמוצרי המשך
 *    משתמשים בה - לא כתובה פעמיים.
 */
async function createBaseReportOrder(
  deps: PaymentOrderServiceDeps,
  request: { productType: "baseReport"; dealType: string; idempotencyKey: string }
): Promise<CreatePaymentOrderResult> {
  const { database } = deps;
  const { dealType, idempotencyKey } = request;

  const existingOrder = await database.findOrderByIdempotencyKey(idempotencyKey);
  if (existingOrder) {
    if (existingOrder.productType !== "baseReport") {
      // אותו idempotency-key חייב להיות עקבי - לא "מוחלף" בשקט אם הבקשה השנייה שונה במוצר.
      return { status: 409, body: { error: "idempotency_key_conflict" } };
    }
    return await respondToBlockingOrder(deps, existingOrder);
  }

  const product = getProduct("baseReport");
  const providerOrderReference = deps.tokenGenerator.generateProviderOrderReference();

  const draftResult = await database.createBaseReportDraftAndOrder({
    dealType,
    idempotencyKey,
    amountAgorot: product.amountAgorot,
    currencyCode: product.currencyCode,
    providerOrderReference,
    // access_token_hash הראשוני - אותו עיקרון בדיוק כמו insertOrder הרגילה: מוחלף מיד על ידי
    // rotateTokenAndEnsureCheckout לפני שנמסר ללקוח, אף אחד לא מקבל את הערך הזמני הזה.
    accessTokenHash: await deps.tokenGenerator.hashAccessToken(deps.tokenGenerator.generateAccessToken()),
  });

  if (draftResult.outcome === "invalid_deal_type") {
    return INVALID_DEAL_TYPE;
  }

  if (draftResult.outcome === "idempotency_race") {
    // מרוץ אמיתי (לא retry רגיל) - שתי בקשות עם אותו idempotency-key ניסו ליצור draft+order
    // בו-זמנית. ה-RPC האטומית כבר דאגה שהמפסידה לא משאירה draft יתום (ר' המיגרציה). המנצחת
    // כבר commit-ה בהכרח בשלב הזה (Postgres חוסם את המפסידה על נעילת השורה עד commit המנצחת) -
    // findOrderByIdempotencyKey ימצא אותה.
    const winner = await database.findOrderByIdempotencyKey(idempotencyKey);
    if (!winner) return PROVIDER_ERROR;
    return await respondToBlockingOrder(deps, winner);
  }

  return await rotateTokenAndEnsureCheckout(deps, draftResult.order);
}

/**
 * מוצר המשך בלבד (cashFlowAnalysis/trackingReports) - reportId כבר קיים מהלקוח. הרצף:
 * 1. entitlement **פעיל** של baseReport לאותו reportId - **לא** payment_status (הוסר כליל,
 *    Commit 6a). היעדר entitlement מכסה גם "דוח לא קיים" וגם "קיים אך baseReport לא פעיל" -
 *    אותה תגובה גנרית לשניהם, לא חושפים קיום דוח מעבר לנדרש.
 * 2-6. זהה למנגנון המקורי (idempotency-key מדויק -> הזמנה חוסמת -> insert -> race -> checkout).
 */
async function createAddOnOrder(
  deps: PaymentOrderServiceDeps,
  request: { productType: Exclude<ProductType, "baseReport">; reportId: string; idempotencyKey: string }
): Promise<CreatePaymentOrderResult> {
  const { database } = deps;
  const { reportId, productType, idempotencyKey } = request;

  const baseEntitlement = await database.getEntitlement(reportId, "baseReport");
  if (!baseEntitlement || baseEntitlement.entitlementStatus !== "active") {
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
 *  report+product, או כמנצחת race (על insertOrder או על createBaseReportDraftAndOrder). */
async function respondToBlockingOrder(deps: PaymentOrderServiceDeps, order: OrderRecord): Promise<CreatePaymentOrderResult> {
  if (order.status === "paid") {
    return await respondToPaidOrder(deps, order);
  }

  if (order.status === "created" || order.status === "pending") {
    return await rotateTokenAndEnsureCheckout(deps, order);
  }

  // failed/cancelled/refunded - מצב סופי, לא retryable אוטומטית תחת אותו idempotency-key/חיפוש.
  return { status: 200, body: { reportId: order.reportId, status: order.status } };
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
    return { status: 200, body: { reportId: order.reportId, status: "paid" } };
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
      // reportId - Commit 6a: baseReport לא שלח reportId מלכתחילה, זו הפעם הראשונה שהלקוח
      // מקבל אותו. נכלל תמיד (גם עבור מוצרי המשך, שכבר ידעו אותו) - חוזה אחיד אחד, לא שני
      // חוזים שונים לפי productType.
      reportId: order.reportId,
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
