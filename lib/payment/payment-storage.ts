// מודול טהור לניהול שני מאגרי localStorage בזרימת רכישת מוצר (baseReport/cashFlowAnalysis/
// trackingReports) - ללא תלות ב-React/window, כדי שיהיה ניתן לבדוק אותו ישירות ב-Vitest (ר'
// payment-storage.test.ts).
// ה-storage עצמו מוזרק דרך StorageLike (התאמה מדויקת ל-Web Storage API - שימוש אמיתי מזריק
// window.localStorage, בדיקות מזריקות מימוש בזיכרון) - הקובץ הזה לעולם לא ניגש ל-window ישירות.
//
// **שני מאגרים נפרדים בכוונה, לא אחד** (ר' GEN2_CASHFLOW_UI_DESIGN.md §0.1.5ג/§0.1.5ז):
// - pendingPurchases: זמני, TTL קצר, נמחק ברגע שההזמנה אושרה - משמש רק למעבר אל Cardcom וחזרה.
// - productAccess: קבוע (אין TTL אוטומטי), ה-credential היחיד לגישה חוזרת למוצר שכבר נרכש -
//   בלעדיו, מחיקת ה-pending ברגע ה-active הייתה משאירה את המשתמש בלי שום דרך לחזור למוצר
//   (רענון/יום אחר/אותו מכשיר) - זה בדיוק הפער שתוקן בסבב הזה.
//
// **"נכשל סגור" (fail closed) הוא העיקרון המנחה בכל מקום כאן**: JSON פגום, schemaVersion לא
// מוכר, שתי התאמות סותרות ב-resolvePendingByReportAndProduct, כשל כתיבה (quota) - כולם מטופלים
// כ"לא נמצא/לא בטוח", **לעולם לא** כחריגה שמפילה את הדף, ולעולם לא כניחוש. ה-server (
// dohefes-get-product-access) הוא תמיד מקור האמת הסופי - המאגרים כאן הם רק זירוז/נוחות, לא
// תחליף לבדיקה מול השרת.

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// ProductType מיובא מ-payment-products.ts (מקור האמת היחיד לרשימת המוצרים בפועל, ר' לב
// ההערה ב-lib/catalog.ts) - לא מוגדר כאן שוב כעותק נפרד. ר' PRODUCT_CATALOG_AUDIT.md, "audit
// מקומות שבהם ProductType סגור" (product-catalog-implementation, Commit 2) - זה היה עותק
// שלישי, לא רק שני (payment-products.ts + lib/catalog.ts), עד לתיקון הזה. isProductType מיובא
// גם הוא (לא רק הטיפוס) - נדרש ל-isValidPendingRecord למטה, ר' reconciliation מול
// gen2-cashflow-ui-implementation (Commit 5b): הגרסה שם אימתה productType דרך רשימה קשיחה
// ("baseReport" || "cashFlowAnalysis") שנכתבה לפני שהתמיכה ב-trackingReports נוספה (Commit 2) -
// הוחלפה כאן ב-isProductType, כדי לא "לשכוח" trackingReports בשקט בבדיקת התקינות.
export type { ProductType } from "../../supabase/functions/_shared/payment-products";
import { isProductType } from "../../supabase/functions/_shared/payment-products";
import type { ProductType } from "../../supabase/functions/_shared/payment-products";

export interface PendingPurchaseRecord {
  reportId: string;
  productType: ProductType;
  /** נדרש רק ל-baseReport כדי לחדש את אותה הזמנה עם חוזה ה-union של Commit 6a. */
  dealType?: string;
  accessToken: string;
  /** נדרש כדי לחדש הזמנה קיימת בבטחה (ר' resumePendingCheckout ב-payment-client.ts) - **תמיד**
   *  אותו מפתח שכבר שימש ליצירת ההזמנה; לעולם לא מוחלף כדי "לחדש" pending קיים - מחייב על ידי
   *  התבנית, לא רק מוסכמה: אין שום פונקציה בקובץ הזה שמייצרת idempotencyKey חדש. */
  idempotencyKey: string;
  /** ה-checkoutUrl המאומת (host+HTTPS, ר' isTrustedCheckoutUrl ב-payment-client.ts) שכבר הוחזר
   *  מהשרת - מאפשר לחזור לתשלום בלי לפתוח הזמנה חדשה. **לא** נשמר orderId (לא נדרש בפועל -
   *  אין endpoint שמקבל אותו כקלט מהלקוח) ולא LowProfileCode (לא נחשף ללקוח כלל). */
  checkoutUrl: string;
  createdAt: string; // ISO
}

export interface ActiveAccessRecord {
  accessToken: string;
  activatedAt: string; // ISO
  lastVerifiedAt: string; // ISO
}

/** 24 שעות - **מדיניות שלנו בלבד**, לא ערך מתועד של Cardcom. נבדק בפועל מול תיעוד Cardcom
 *  הרשמי (cardcomapinametovalue.zendesk.com, שני המאמרים העיקריים על LowProfile) - אין בהם
 *  שום ציון זמן תפוגה רשמי ל-LowProfile session עצמו. שמרני בכוונה - מספיק זמן לחזור לתשלום
 *  שהתחיל אתמול בטעות נסגר, קצר מספיק שלא יצטבר "זבל" לצמיתות. */
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

const PENDING_KEY = "dohefes.pendingPurchases";
const ACTIVE_KEY = "dohefes.productAccess";
/** גרסאות נפרדות בכוונה - שינוי מבנה ה-pending (הוספת checkoutUrl/idempotencyKey, Commit 5b) לא
 *  אמור לפסול productAccess קיים ותקף (ה-credential הקבוע שכבר תוקן פעם אחת שלא יאבד) - אילו
 *  שתי המאגרים חלקו גרסה אחת, כל שינוי סכמה ל-pending היה מוחק בטעות גם productAccess תקין. */
const PENDING_SCHEMA_VERSION = 2;
const ACTIVE_SCHEMA_VERSION = 1;

interface PendingStoreShape {
  schemaVersion: number;
  entries: Record<string, PendingPurchaseRecord>;
}

interface ActiveStoreShape {
  schemaVersion: number;
  entries: Record<string, ActiveAccessRecord>;
}

function activeKey(reportId: string, productType: ProductType): string {
  return `${reportId}:${productType}`;
}

function isNonEmptyStr(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** ולידציה per-entry, לא רק ברמת ה-store כולו - שומרת מרשומות עם שדות חסרים/מסוג שגוי (JSON
 *  תקין אך "מזוהם" - למשל אחרי שינוי ידני ב-DevTools, או קורוצפיה חלקית) - שורדת "נכשל סגור"
 *  ברמת רשומה בודדת, לא מפילה את כל המאגר בגלל רשומה אחת פגומה. productType נבדק דרך
 *  isProductType (מקור אמת יחיד, ר' ההערה למעלה) - לא רשימה קשיחה שעלולה "לשכוח" מוצר חדש. */
function isValidPendingRecord(value: unknown): value is PendingPurchaseRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    isNonEmptyStr(r.reportId) &&
    isProductType(r.productType) &&
    (r.dealType === undefined || isNonEmptyStr(r.dealType)) &&
    isNonEmptyStr(r.accessToken) &&
    isNonEmptyStr(r.idempotencyKey) &&
    isNonEmptyStr(r.checkoutUrl) &&
    isNonEmptyStr(r.createdAt)
  );
}

/** קריאה + פענוח "נכשל סגור" - JSON פגום/schemaVersion לא תואם (**כולל migration משמעותי**:
 *  רשומות מ-schemaVersion 1 הישן, בלי checkoutUrl/idempotencyKey, נופלות כאן ומוחזרות כמאגר ריק -
 *  לא מנסים "להשלים" שדות חסרים בניחוש) /צורה לא צפויה => מאגר ריק, לעולם לא חריגה. לא ממש
 *  קורא ל-JSON.parse ישירות בשום מקום אחר בקובץ - כל קריאה עוברת כאן. */
function readPendingStore(storage: StorageLike): PendingStoreShape {
  const empty: PendingStoreShape = { schemaVersion: PENDING_SCHEMA_VERSION, entries: {} };
  const raw = storage.getItem(PENDING_KEY);
  if (!raw) return empty;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { schemaVersion?: unknown }).schemaVersion !== PENDING_SCHEMA_VERSION ||
      typeof (parsed as { entries?: unknown }).entries !== "object" ||
      (parsed as { entries?: unknown }).entries === null
    ) {
      return empty;
    }
    const rawEntries = (parsed as PendingStoreShape).entries;
    const validEntries: Record<string, PendingPurchaseRecord> = {};
    for (const [key, entryValue] of Object.entries(rawEntries)) {
      if (isValidPendingRecord(entryValue)) validEntries[key] = entryValue;
    }
    return { schemaVersion: PENDING_SCHEMA_VERSION, entries: validEntries };
  } catch {
    return empty;
  }
}

function readActiveStore(storage: StorageLike): ActiveStoreShape {
  const empty: ActiveStoreShape = { schemaVersion: ACTIVE_SCHEMA_VERSION, entries: {} };
  const raw = storage.getItem(ACTIVE_KEY);
  if (!raw) return empty;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { schemaVersion?: unknown }).schemaVersion !== ACTIVE_SCHEMA_VERSION ||
      typeof (parsed as { entries?: unknown }).entries !== "object" ||
      (parsed as { entries?: unknown }).entries === null
    ) {
      return empty;
    }
    return parsed as ActiveStoreShape;
  } catch {
    return empty;
  }
}

/** כתיבה "נכשל סגור" - quota/כל שגיאת storage אחרת מוחזרת כ-ok:false, לא זורקת. הקוד הקורא
 *  (promoteToActive במיוחד) תלוי בזה כדי לא למחוק pending כשה-write ל-active נכשל בפועל. */
function writeStore(storage: StorageLike, key: string, value: unknown): { ok: boolean } {
  try {
    storage.setItem(key, JSON.stringify(value));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** מוחקת מ-pendingPurchases כל רשומה שעברה את PENDING_TTL_MS ביחס ל-now. **לא נוגעת ב-active
 *  בשום צורה** - אין לו TTL אוטומטי (ר' הערת הקובץ). לא נכשלת אם הכתיבה-בחזרה נכשלת (quota) -
 *  במקרה כזה הניקוי פשוט לא נשמר, ינוסה שוב בקריאה הבאה, בלי לזרוק. */
export function cleanupPending(storage: StorageLike, now: Date): void {
  const store = readPendingStore(storage);
  const nowMs = now.getTime();
  const kept: Record<string, PendingPurchaseRecord> = {};
  let removedAny = false;
  for (const [contextId, record] of Object.entries(store.entries)) {
    const createdAtMs = Date.parse(record.createdAt);
    const expired = Number.isNaN(createdAtMs) || nowMs - createdAtMs > PENDING_TTL_MS;
    if (expired) {
      removedAny = true;
    } else {
      kept[contextId] = record;
    }
  }
  if (removedAny) {
    writeStore(storage, PENDING_KEY, { schemaVersion: PENDING_SCHEMA_VERSION, entries: kept });
  }
}

/**
 * נקראת מיד אחרי תגובת 200 מוצלחת מ-dohefes-create-payment-order, לפני הניווט ל-checkoutUrl -
 * **וגם** מ-resumePendingCheckout (payment-client.ts) כשמעדכנים רשומה קיימת אחרי חידוש מוצלח
 * (token/checkoutUrl סובבו, אותו paymentContextId/idempotencyKey - קריאה שנייה על אותו מפתח
 * **מחליפה** את הרשומה, לא מוסיפה שנייה). paymentContextId הוא תמיד ערך שנוצר בשרת - הפונקציה
 * הזו לא מייצרת/ממציאה מפתחות. אינה מוחקת רשומות קיימות אחרות (ר' בדיקת "שתי לשוניות").
 * checkoutUrl **אינו** מאומת כאן שוב (כבר מאומת לפני הקריאה, ב-isTrustedCheckoutUrl
 * ב-payment-client.ts) - המודול הזה לא יודע כלום על Cardcom/hosts.
 */
export function addPending(
  storage: StorageLike,
  paymentContextId: string,
  input: { reportId: string; productType: ProductType; dealType?: string; accessToken: string; checkoutUrl: string; idempotencyKey: string },
  now: Date
): { ok: boolean } {
  const store = readPendingStore(storage);
  const nextEntries = {
    ...store.entries,
    [paymentContextId]: {
      reportId: input.reportId,
      productType: input.productType,
      ...(input.dealType ? { dealType: input.dealType } : {}),
      accessToken: input.accessToken,
      checkoutUrl: input.checkoutUrl,
      idempotencyKey: input.idempotencyKey,
      createdAt: now.toISOString(),
    },
  };
  return writeStore(storage, PENDING_KEY, { schemaVersion: PENDING_SCHEMA_VERSION, entries: nextEntries });
}

/** משמשת את /payment-return - מריצה ניקוי TTL קודם, ואז מחפשת התאמה מדויקת. `null` אם חסר/פג -
 *  **לא** מנחשת "ההזמנה האחרונה" בשום מקרה, גם אם יש רשומה בודדת. */
export function resolvePendingByContext(storage: StorageLike, paymentContextId: string, now: Date): PendingPurchaseRecord | null {
  cleanupPending(storage, now);
  const store = readPendingStore(storage);
  return store.entries[paymentContextId] ?? null;
}

/** fallback להקלדה ידנית של /cashflow/?id= בלי ReturnValue זמין (ר' GEN2_CASHFLOW_UI_DESIGN.md,
 *  "fallback כאשר ReturnValue חסר") - מחפשת לפי reportId+productType, **לא** לפי "האחרון שנוצר".
 *  אם יש יותר מהתאמה אחת (לא אמור לקרות בזרימה תקינה - claim/lease מונע שתי הזמנות פעילות
 *  לאותו report+product, אך לא מוטב לסמוך על כך כאן, ר' עקרון "נכשל סגור") - מוחזר "ambiguous",
 *  לא נבחרת אחת מהן בשרירותיות. */
export function resolvePendingByReportAndProduct(
  storage: StorageLike,
  reportId: string,
  productType: ProductType,
  now: Date
): { ok: true; paymentContextId: string; record: PendingPurchaseRecord } | { ok: false; reason: "not_found" | "ambiguous" } {
  cleanupPending(storage, now);
  const store = readPendingStore(storage);
  const matches = Object.entries(store.entries).filter(([, record]) => record.reportId === reportId && record.productType === productType);
  if (matches.length === 0) return { ok: false, reason: "not_found" };
  if (matches.length > 1) return { ok: false, reason: "ambiguous" };
  const [paymentContextId, record] = matches[0];
  return { ok: true, paymentContextId, record };
}

/**
 * מבטיחה סדר-פעולות ספציפי, לא רק "תעביר את זה": (1) לוקחת את ה-accessToken מהרשומה הממתינה,
 * (2) כותבת אותו ל-productAccess, (3) **רק אם** הכתיבה הצליחה בפועל - מוחקת את רשומת ה-pending.
 * אם הכתיבה ל-active נכשלת (quota וכו') - מוחזר ok:false, ורשומת ה-pending **נשארת שלמה** -
 * כדי שניסיון חוזר (למשל בטעינה הבאה) עדיין ימצא אותה, במקום לאבד את ה-token לגמרי.
 */
export function promoteToActive(storage: StorageLike, paymentContextId: string, now: Date): { ok: boolean } {
  const pendingStore = readPendingStore(storage);
  const pendingRecord = pendingStore.entries[paymentContextId];
  if (!pendingRecord) return { ok: false };

  const activeStore = readActiveStore(storage);
  const key = activeKey(pendingRecord.reportId, pendingRecord.productType);
  const nowIso = now.toISOString();
  const nextActiveEntries = {
    ...activeStore.entries,
    [key]: { accessToken: pendingRecord.accessToken, activatedAt: nowIso, lastVerifiedAt: nowIso },
  };
  const writeResult = writeStore(storage, ACTIVE_KEY, { schemaVersion: ACTIVE_SCHEMA_VERSION, entries: nextActiveEntries });
  if (!writeResult.ok) return { ok: false };

  const remainingPending = { ...pendingStore.entries };
  delete remainingPending[paymentContextId];
  writeStore(storage, PENDING_KEY, { schemaVersion: PENDING_SCHEMA_VERSION, entries: remainingPending });
  return { ok: true };
}

/** קריאה טהורה - **בלי TTL** (ר' הערת הקובץ, productAccess אינו פג אוטומטית). `null` אם חסר/פגום -
 *  אף פעם לא נחשב כשלעצמו "הוכחת הרשאה" (ר' כלל 5) - הקורא **חייב** עדיין לאמת מול dohefes-get-product-access
 *  לפני הצגת תוכן המוצר, זה משמש רק כמקור ל-accessToken שיישלח לאותה בדיקה. */
export function resolveActiveAccess(storage: StorageLike, reportId: string, productType: ProductType): ActiveAccessRecord | null {
  const store = readActiveStore(storage);
  return store.entries[activeKey(reportId, productType)] ?? null;
}

/** מעדכנת lastVerifiedAt בלבד (bookkeeping, לא משפיע על שום החלטת הרשאה) - נקראת אחרי בדיקה
 *  חוזרת מוצלחת (status:"active") מול dohefes-get-product-access. */
export function touchActiveAccess(storage: StorageLike, reportId: string, productType: ProductType, now: Date): void {
  const store = readActiveStore(storage);
  const key = activeKey(reportId, productType);
  const existing = store.entries[key];
  if (!existing) return;
  const nextEntries = { ...store.entries, [key]: { ...existing, lastVerifiedAt: now.toISOString() } };
  writeStore(storage, ACTIVE_KEY, { schemaVersion: ACTIVE_SCHEMA_VERSION, entries: nextEntries });
}

/** revoked/refunded/unavailable - מסירה **רק** את הרשומה של report/product הספציפיים, לא נוגעת
 *  בשום רשומה אחרת (מוצר אחר על אותו דוח, אותו מוצר על דוח אחר). */
export function revokeActiveAccess(storage: StorageLike, reportId: string, productType: ProductType): void {
  const store = readActiveStore(storage);
  const key = activeKey(reportId, productType);
  if (!(key in store.entries)) return;
  const nextEntries = { ...store.entries };
  delete nextEntries[key];
  writeStore(storage, ACTIVE_KEY, { schemaVersion: ACTIVE_SCHEMA_VERSION, entries: nextEntries });
}
