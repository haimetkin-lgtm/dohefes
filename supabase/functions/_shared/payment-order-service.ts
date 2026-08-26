// שכבת orchestration טהורה ל-create-payment-order - כל תלות חיצונית (מסד נתונים, Cardcom, יצירת
// token, שעון) מוזרקת דרך PaymentOrderServiceDeps, לא נקראת ישירות (לא Deno.serve, לא import של
// Supabase client קונקרטי). מאפשר בדיקת ה-orchestration המלאה דרך Vitest עם fakes, בלי Deno
// runtime בכלל - ר' payment-order-service.test.ts. index.ts הוא ה-adapter הדק היחיד שמזריק את
// המימושים האמיתיים (Supabase, Cardcom, Web Crypto, new Date).

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

export interface ReportLookupResult {
  found: boolean;
  /** dohefes_reports.payment_status הישן - ר' הערת "תאימות זמנית" למטה */
  paymentStatus: string | null;
}

/** מופשט מעל Supabase - לא חושף client קונקרטי, כדי שאפשר יהיה להזריק fake ב-Vitest */
export interface PaymentOrderDatabase {
  getReportPaymentStatus(reportId: string): Promise<ReportLookupResult>;
  findOrderByIdempotencyKey(idempotencyKey: string): Promise<OrderRecord | null>;
  insertOrder(input: NewOrderInput): Promise<OrderRecord>;
  updateAccessTokenHash(orderId: string, accessTokenHash: string): Promise<void>;
  markOrderPending(orderId: string, details: { cardcomLowProfileCode: string; checkoutUrl: string }): Promise<void>;
  markOrderFailed(orderId: string, failureCode: string): Promise<void>;
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

export interface PaymentOrderServiceDeps {
  database: PaymentOrderDatabase;
  cardcomClient: CardcomClientLike;
  tokenGenerator: TokenGenerator;
  clock: Clock;
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
  | { status: 502; body: { error: "payment_provider_error" } };

const NOT_ELIGIBLE = { status: 403 as const, body: { error: "report_not_eligible" as const } };

/**
 * הרצף המלא, לפי הסדר שהתבקש:
 * 1. קיום דוח + (cashFlowAnalysis בלבד) בדיקת baseReport משולם - **תאימות זמנית** מול
 *    dohefes_reports.payment_status הישן, עד ש-baseReport עצמו יעבור ל-product_entitlements
 *    (GEN2_PAYMENT_ENTITLEMENT_DESIGN.md §6.2 שלב 4). הודעת השגיאה זהה בין "דוח לא קיים" ל-"קיים
 *    אך לא זכאי" - לא חושפים קיום דוח מעבר לנדרש.
 * 2-3. idempotency-key: מחפשים הזמנה קיימת **לפני** יצירת חדשה - לעולם לא order נוסף ל-retry.
 * 4. פונה ל-Cardcom (cardcomClient.createLowProfile) רק כשצריך (הזמנה חדשה, או pending/created
 *    בלי checkoutUrl שמור עדיין).
 * 5-7. שומרת checkoutUrl (ה-DB layer שומר גם cardcom_low_profile_code, לא חשוף כאן כי הלוגיקה
 *    הזו לא צריכה אותו), עוברת ל-pending.
 * 8. מחזירה רק orderId/checkoutUrl/accessToken/status - לא entitlement, לא פרטי Cardcom גולמיים.
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

    if (existingOrder.status === "paid") {
      // "אין לסובב token ואין להחזיר token חדש בלי הוכחת גישה עתידית. החזר סטטוס כללי בלבד."
      return { status: 200, body: { status: "paid" } };
    }

    if (existingOrder.status === "created" || existingOrder.status === "pending") {
      return await rotateTokenAndEnsureCheckout(deps, existingOrder);
    }

    // failed/cancelled/refunded - מצב סופי, לא retryable אוטומטית תחת אותו idempotency-key.
    return { status: 200, body: { status: existingOrder.status } };
  }

  const product = getProduct(productType);
  const providerOrderReference = deps.tokenGenerator.generateProviderOrderReference();
  const rawToken = deps.tokenGenerator.generateAccessToken();
  const accessTokenHash = await deps.tokenGenerator.hashAccessToken(rawToken);

  const insertedOrder = await database.insertOrder({
    reportId,
    productType,
    amountAgorot: product.amountAgorot,
    currencyCode: product.currencyCode,
    idempotencyKey,
    providerOrderReference,
    accessTokenHash,
  });

  const cardcomOutcome = await callCardcomAndAdvance(deps, insertedOrder);
  if (!cardcomOutcome.ok) {
    return { status: 502, body: { error: "payment_provider_error" } };
  }

  return {
    status: 200,
    body: { orderId: insertedOrder.id, checkoutUrl: cardcomOutcome.checkoutUrl, accessToken: rawToken, status: "pending" },
  };
}

/** retry על הזמנה created/pending: מסובבת token תמיד, ומוודאת ש-Cardcom כבר נוצר - checkoutUrl
 *  כבר קיים = לא קוראים ל-Cardcom שוב, רק מחזירים את מה שכבר יש (אין session שני לאותה הזמנה). */
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
    return { status: 502, body: { error: "payment_provider_error" } };
  }
  return { status: 200, body: { orderId: order.id, checkoutUrl: cardcomOutcome.checkoutUrl, accessToken: rawToken, status: "pending" } };
}

/** קוראת ל-Cardcom ליצירת LowProfile, ומעדכנת את ההזמנה בהתאם - pending+checkoutUrl בהצלחה,
 *  failed+failure_code כללי בכישלון. **אף פעם לא מסמנת paid כאן** - זו רק "נוצר דף תשלום". */
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
