// שכבת client טהורה ככל האפשר מול dohefes-create-payment-order/dohefes-get-product-access -
// דרך supabase.functions.invoke (לא fetch גולמי - מקבל אימות/headers/CORS מטופלים על ידי
// supabase-js), עם ולידציה מבנית על כל תשובה ("נכשל סגור" - אותו עיקרון כמו payment-storage.ts).
//
// **"client מוזרק" לצורך בדיקות** - לא תלוי ב-SupabaseClient המלא, רק בתת-הממשק ש-functions.invoke
// באמת דורש (FunctionsInvoker למטה) - קריאה אמיתית מזריקה את ה-supabase singleton הקיים
// (`lib/supabase.ts`, `supabase.functions`), בדיקות מזריקות fake.
//
// **אין קריאה ישירה לטבלאות תשלום, ואין כתיבה ל-dohefes_reports.payment_status** - הקובץ הזה
// לא מייבא Supabase table client כלל (`.from(...)`), רק functions.invoke - מבנית, אין דרך
// לעקוף את זה מכאן.
//
// **אין console.log/warn/error בקובץ הזה בכלל, בכוונה** - הדרך הבטוחה ביותר להבטיח שאין
// accessToken בלוגים היא לא לרשום שום דבר - כל תוצאה (הצלחה/כשל) מוחזרת כערך מוקלד, לא
// נרשמת. הקורא (React, commit נפרד) אחראי אם/איך להציג שגיאה למשתמש.

import type { ProductType } from "./payment-storage";
import { addPending, resolvePendingByContext, promoteToActive, type StorageLike } from "./payment-storage";

/** תת-הממשק היחיד שנדרש בפועל מ-SupabaseClient - supabase.functions מיישם אותו ישירות
 *  (`@supabase/functions-js`), כך שקריאה אמיתית מזריקה את ה-client הקיים ללא עטיפה נוספת. */
export interface FunctionsInvoker {
  invoke<T = unknown>(
    functionName: string,
    options?: { headers?: Record<string, string>; body?: unknown }
  ): Promise<{ data: T | null; error: { context?: unknown } | null }>;
}

/** 4 בתים אקראיים UUID - זהה בפורמט למה שהשרת דורש (`isUuid`, `dohefes-create-payment-order`
 *  header Idempotency-Key). נוצר **פעם אחת לכל ניסיון רכישה** על ידי הקורא (ר' purchaseProduct) -
 *  לא מיוצר מחדש בכל קריאה בודדת ל-functions.invoke, כדי שניסיון חוזר על אותו ניסיון רכישה
 *  (למשל אחרי תגובה retryable) ישתמש **באותו** מפתח, לא ייצור הזמנה כפולה. ניסיון רכישה **חדש**
 *  (למשל אחרי error מוחלט, או מוצר אחר) מקבל מפתח חדש - זו החלטת הקורא, לא של הפונקציה הזו. */
export function generateIdempotencyKey(): string {
  return crypto.randomUUID();
}

/** הגנת-עומק: checkoutUrl שחוזר מהשרת חייב להיות HTTPS ובאחד ה-hosts המורשים של Cardcom -
 *  לא נסמכים על כך שהשרת "בטוח שלח כתובת נכונה" בלבד (אותה פילוסופיה כמו שאר הפרויקט - CHECK
 *  constraint ב-DB בנוסף לוולידציה באפליקציה וכו'). כתובת שלא עוברת את זה נחשבת תשובה לא-תקינה
 *  לגמרי - **לא** מפנים אליה בשום מקרה. */
const ALLOWED_CHECKOUT_HOSTS = ["secure.cardcom.solutions"];

/** מיוצא (לא רק פנימי) - נבדק שוב לפני resume ב-resumePendingCheckout, לא רק בזמן היצירה -
 *  הגנת-עומק כפולה נגד checkoutUrl שנשמר ב-localStorage ונחשוד (תיאורטית) בשיבוש/עריכה ידנית. */
export function isTrustedCheckoutUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && ALLOWED_CHECKOUT_HOSTS.includes(parsed.hostname);
  } catch {
    return false;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// ---------- dohefes-create-payment-order ----------

export type CreatePaymentOrderClientResult =
  | { kind: "pending"; orderId: string; checkoutUrl: string; accessToken: string; paymentContextId: string }
  | { kind: "paid" }
  /** תגובה תקנית, לא שגיאה - claim פעיל אצל בקשה אחרת לאותה הזמנה (503) - סביר לנסות שוב בעוד רגע. */
  | { kind: "retryable" }
  /** דוח לא זכאי/קונפליקט idempotency-key/כשל ודאי מ-Cardcom/הזמנה שכבר failed/cancelled/refunded -
   *  כולם "לא בר-ניסיון-חוזר עם אותם פרטים בדיוק" - ניסיון רכישה חדש (מפתח idempotency חדש) הוא
   *  מה שבאמת עשוי לעזור, לא חזרה על אותה בקשה. */
  | { kind: "error"; reason: string };

async function readHttpErrorBody(error: { context?: unknown }): Promise<{ status: number | null; body: unknown }> {
  const context = error.context as { status?: unknown; json?: () => Promise<unknown> } | undefined;
  const status = typeof context?.status === "number" ? context.status : null;
  if (!context || typeof context.json !== "function") return { status, body: null };
  try {
    return { status, body: await context.json() };
  } catch {
    return { status, body: null };
  }
}

function errorReasonFromBody(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string") {
    return (body as { error: string }).error;
  }
  return fallback;
}

/**
 * `null` (כשל רשת/relay - אין תשובת HTTP בכלל, ר' readHttpErrorBody) - תמיד retryable.
 * `500`/`503` - תקלת שרת חולפת/claim פעיל (503 מ-dohefes-create-payment-order במפורש) - retryable.
 * `404` - ה-Function טרם נפרסה/שם שגוי - **retryable**, לא error סופי: ברגע שהיא תיפרס, אותה
 *  בקשה בדיוק תצליח - זה בדיוק המצב בפרויקט הזה כרגע (Functions בקוד, טרם פרוסות).
 * `429` - rate limit - retryable מטבעו (backoff וניסיון חוזר, לא שגיאה קבועה).
 * כל שאר הקודים (400/401/403/409/502 וכו') - **לא** retryable: 401/403 הם בעיית הרשאה/מקור
 *  שלא תיפתר בניסיון זהה חוזר; 409 (idempotency_key_conflict) ו-502 (payment_provider_error)
 *  הם החלטות ודאיות מהשרת, לא תקלות חולפות (ר' payment-order-service.ts).
 */
function isRetryableHttpStatus(status: number | null): boolean {
  return status === null || status === 404 || status === 429 || status === 500 || status === 503;
}

export async function createPaymentOrder(
  invoker: FunctionsInvoker,
  input: { reportId: string; productType: ProductType; idempotencyKey: string }
): Promise<CreatePaymentOrderClientResult> {
  const { data, error } = await invoker.invoke<{
    status?: string;
    orderId?: unknown;
    checkoutUrl?: unknown;
    accessToken?: unknown;
    paymentContextId?: unknown;
  }>("dohefes-create-payment-order", {
    headers: { "Idempotency-Key": input.idempotencyKey },
    body: { reportId: input.reportId, productType: input.productType },
  });

  if (error) {
    const { status, body } = await readHttpErrorBody(error);
    if (isRetryableHttpStatus(status)) return { kind: "retryable" };
    return { kind: "error", reason: errorReasonFromBody(body, status === null ? "network_error" : `http_${status}`) };
  }

  if (!data || typeof data.status !== "string") return { kind: "error", reason: "invalid_response_shape" };

  if (data.status === "pending") {
    const { orderId, checkoutUrl, accessToken, paymentContextId } = data;
    if (
      !isNonEmptyString(orderId) ||
      !isNonEmptyString(checkoutUrl) ||
      !isNonEmptyString(accessToken) ||
      !isNonEmptyString(paymentContextId) ||
      !isTrustedCheckoutUrl(checkoutUrl)
    ) {
      return { kind: "error", reason: "invalid_response_shape" };
    }
    return { kind: "pending", orderId, checkoutUrl, accessToken, paymentContextId };
  }

  if (data.status === "paid") return { kind: "paid" };
  if (data.status === "failed" || data.status === "cancelled" || data.status === "refunded") {
    return { kind: "error", reason: data.status };
  }
  return { kind: "error", reason: "invalid_response_shape" };
}

// ---------- dohefes-get-product-access ----------

export type GetProductAccessClientResult =
  | { kind: "active" }
  | { kind: "pending" }
  | { kind: "unavailable" }
  | { kind: "retryable" }
  | { kind: "error"; reason: string };

export async function getProductAccess(
  invoker: FunctionsInvoker,
  input: { reportId: string; productType: ProductType; accessToken: string }
): Promise<GetProductAccessClientResult> {
  const { data, error } = await invoker.invoke<{ status?: string }>("dohefes-get-product-access", {
    headers: { "X-Access-Token": input.accessToken },
    body: { reportId: input.reportId, productType: input.productType },
  });

  if (error) {
    const { status, body } = await readHttpErrorBody(error);
    if (isRetryableHttpStatus(status)) return { kind: "retryable" };
    return { kind: "error", reason: errorReasonFromBody(body, status === null ? "network_error" : `http_${status}`) };
  }

  if (!data || typeof data.status !== "string") return { kind: "error", reason: "invalid_response_shape" };
  if (data.status === "active" || data.status === "pending" || data.status === "unavailable") {
    return { kind: data.status };
  }
  return { kind: "error", reason: "invalid_response_shape" };
}

// ---------- אורכסטרציה: רכישה מלאה, כולל שמירת pending לפני redirect ----------

export type PurchaseProductResult =
  | { kind: "redirect"; checkoutUrl: string }
  | { kind: "already_paid" }
  /** ה-order נוצר בהצלחה אצל השרת, אבל שמירת ה-pending המקומית נכשלה (למשל quota) - **בכוונה
   *  אין `checkoutUrl` בתוצאה הזו** - אין שום דרך מבנית עבור הקורא לפנות ל-Cardcom כשמגיע ה-kind
   *  הזה, גם לא בטעות. */
  | { kind: "storage_failed" }
  | { kind: "retryable" }
  | { kind: "error"; reason: string };

export async function purchaseProduct(
  invoker: FunctionsInvoker,
  storage: StorageLike,
  input: { reportId: string; productType: ProductType; idempotencyKey: string },
  now: Date
): Promise<PurchaseProductResult> {
  const orderResult = await createPaymentOrder(invoker, input);

  if (orderResult.kind === "paid") return { kind: "already_paid" };
  if (orderResult.kind === "retryable") return { kind: "retryable" };
  if (orderResult.kind === "error") return orderResult;

  const stored = addPending(
    storage,
    orderResult.paymentContextId,
    {
      reportId: input.reportId,
      productType: input.productType,
      accessToken: orderResult.accessToken,
      checkoutUrl: orderResult.checkoutUrl,
      idempotencyKey: input.idempotencyKey,
    },
    now
  );
  if (!stored.ok) return { kind: "storage_failed" };

  return { kind: "redirect", checkoutUrl: orderResult.checkoutUrl };
}

// ---------- אורכסטרציה: חידוש pending קיים (חזרה ל-checkout, לא הזמנה חדשה) ----------

export type ResumeCheckoutResult =
  /** dohefes-get-product-access כבר מחזירה active - קודמה ל-productAccess, **אין** צורך/היתר
   *  לפתוח את Cardcom בכלל. */
  | { kind: "already_active" }
  /** בטוח להפנות - ה-checkoutUrl המוחזר כאן **תמיד** אומת מחדש (isTrustedCheckoutUrl), גם אם
   *  הוא זהה לישן שכבר היה שמור. */
  | { kind: "redirect"; checkoutUrl: string }
  /** ה-pending לא נמצא בכלל (לא קיים/פג TTL) - **אין** ניסיון ליצור הזמנה חדשה אוטומטית כאן -
   *  זו תמיד פעולה נפרדת ומודעת של הקורא (purchaseProduct, עם idempotencyKey חדש). */
  | { kind: "not_found" }
  /** כתיבת העדכון המקומי (token/checkoutUrl שסובבו בחידוש) נכשלה - **בכוונה בלי checkoutUrl
   *  בתוצאה**, אין דרך מבנית להפנות בטעות. הרשומה המקומית הישנה (הלא-מעודכנת) עדיין נשארת -
   *  לא נמחקת בשום מקרה כשל. */
  | { kind: "storage_failed" }
  | { kind: "retryable" }
  | { kind: "error"; reason: string };

/**
 * נקראת לפני "המשך לתשלום" על pending קיים - **לעולם לא** יוצרת idempotencyKey חדש (משתמשת
 * תמיד באותו אחד שכבר שמור ברשומה). רצף:
 * 1. dohefes-get-product-access עם ה-accessToken השמור - `active` => promoteToActive, לא פותחים
 *    Cardcom בכלל.
 * 2. `pending` => ה-checkoutUrl השמור עדיין קאנוני לפי השרת - מוחזר כמו שהוא (אחרי ולידציה חוזרת
 *    ל-host, הגנת-עומק).
 * 3. `unavailable`/error מבני (ספק אמיתי לגבי תקפות הקישור) => קריאה חוזרת ל-dohefes-create-payment-order
 *    עם **אותו** idempotencyKey - מקבלת את מצב ההזמנה הנוכחי דטרמיניסטית מהשרת, לא מנחשת.
 *    אם עדיין `pending` - טוקן/checkoutUrl **מסתובבים בשרת בכל קריאה כזו** (ר' rotateTokenAndEnsureCheckout
 *    ב-Edge Function) - הרשומה המקומית מתעדכנת אטומית **לפני** ההפניה, לא אחריה.
 *    אם התברר `paid` (שולם במקביל, למשל Indicator שרק עכשיו הגיע) - נבדק שוב מול ה-accessToken
 *    שכבר יש (לא משתנה על ידי "paid" - הוא נשאר מהיצירה המקורית).
 * 4. `retryable` בכל שלב => מוחזר כמו שהוא, **בלי** לנסות renewal - תקלה חולפת, לא ספק אמיתי.
 */
export async function resumePendingCheckout(invoker: FunctionsInvoker, storage: StorageLike, paymentContextId: string, now: Date): Promise<ResumeCheckoutResult> {
  const pending = resolvePendingByContext(storage, paymentContextId, now);
  if (!pending) return { kind: "not_found" };

  const access = await getProductAccess(invoker, { reportId: pending.reportId, productType: pending.productType, accessToken: pending.accessToken });

  if (access.kind === "active") {
    const promoted = promoteToActive(storage, paymentContextId, now);
    return promoted.ok ? { kind: "already_active" } : { kind: "storage_failed" };
  }

  if (access.kind === "pending") {
    if (!isTrustedCheckoutUrl(pending.checkoutUrl)) {
      // הגנת-עומק בלבד - לא אמור לקרות (כבר אומת בזמן היצירה) - אם בכל זאת, מתייחסים כמו לספק
      // אמיתי ומחדשים, לא פותחים כתובת לא-מאומתת.
      return renewPendingCheckout(invoker, storage, paymentContextId, pending, now);
    }
    return { kind: "redirect", checkoutUrl: pending.checkoutUrl };
  }

  if (access.kind === "retryable") return { kind: "retryable" };

  // unavailable / error מבני - ספק אמיתי לגבי תקפות ההזמנה/הקישור
  return renewPendingCheckout(invoker, storage, paymentContextId, pending, now);
}

async function renewPendingCheckout(
  invoker: FunctionsInvoker,
  storage: StorageLike,
  paymentContextId: string,
  pending: { reportId: string; productType: ProductType; accessToken: string; idempotencyKey: string },
  now: Date
): Promise<ResumeCheckoutResult> {
  const renewed = await createPaymentOrder(invoker, { reportId: pending.reportId, productType: pending.productType, idempotencyKey: pending.idempotencyKey });

  if (renewed.kind === "retryable") return { kind: "retryable" };
  if (renewed.kind === "error") return renewed;

  if (renewed.kind === "paid") {
    // ה-accessToken לא מתחלף על ידי "paid" (לא הוחזר token חדש כאן בכלל - נשאר מהיצירה
    // המקורית) - בודקים שוב מולו כדי לקבל אישור entitlement עדכני.
    const recheck = await getProductAccess(invoker, { reportId: pending.reportId, productType: pending.productType, accessToken: pending.accessToken });
    if (recheck.kind === "active") {
      const promoted = promoteToActive(storage, paymentContextId, now);
      return promoted.ok ? { kind: "already_active" } : { kind: "storage_failed" };
    }
    return { kind: "retryable" }; // paid אך עוד לא השתקף כ-active - סביר לנסות שוב בעוד רגע
  }

  // renewed.kind === "pending" - token/checkoutUrl סובבו בשרת (rotateTokenAndEnsureCheckout
  // רץ בכל קריאה כזו) - מעדכנים אטומית **לפני** ההפניה, אותו paymentContextId/idempotencyKey.
  const updated = addPending(
    storage,
    paymentContextId,
    { reportId: pending.reportId, productType: pending.productType, accessToken: renewed.accessToken, checkoutUrl: renewed.checkoutUrl, idempotencyKey: pending.idempotencyKey },
    now
  );
  if (!updated.ok) return { kind: "storage_failed" };
  return { kind: "redirect", checkoutUrl: renewed.checkoutUrl };
}
