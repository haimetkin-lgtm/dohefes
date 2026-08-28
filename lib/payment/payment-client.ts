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
import { addPending, type StorageLike } from "./payment-storage";

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

function isTrustedCheckoutUrl(url: string): boolean {
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
    if (status === null) return { kind: "retryable" }; // כשל רשת/relay - אין תשובה מהשרת בכלל
    if (status === 503) return { kind: "retryable" };
    if (status === 500) return { kind: "retryable" };
    return { kind: "error", reason: errorReasonFromBody(body, `http_${status}`) };
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
    if (status === null) return { kind: "retryable" };
    if (status === 500) return { kind: "retryable" };
    return { kind: "error", reason: errorReasonFromBody(body, `http_${status}`) };
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
    { reportId: input.reportId, productType: input.productType, accessToken: orderResult.accessToken },
    now
  );
  if (!stored.ok) return { kind: "storage_failed" };

  return { kind: "redirect", checkoutUrl: orderResult.checkoutUrl };
}
