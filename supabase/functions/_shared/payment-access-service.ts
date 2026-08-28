// שכבת orchestration טהורה ל-dohefes-get-product-access - כל תלות חיצונית (מסד נתונים, חישוב hash)
// מוזרקת דרך PaymentAccessServiceDeps, לא נקראת ישירות. מאפשר בדיקת ה-orchestration המלאה דרך
// Vitest עם fakes, בלי Deno runtime בכלל - ר' payment-access-service.test.ts. index.ts הוא
// ה-adapter הדק היחיד שמזריק את המימושים האמיתיים (Supabase, Web Crypto).
//
// **קריאה בלבד** - PaymentAccessDatabase (למטה) לא חושפת שום מתודת כתיבה בכלל; אין דרך למוטט
// דרך הקובץ הזה גם אם מישהו ינסה, כי הפעולה פשוט לא קיימת בממשק.
//
// **הקלט מהלקוח**: reportId, productType, וטוקן גולמי - שום דבר אחר. הלקוח **לעולם לא** שולח
// (ולא צריך לשלוח) סטטוס תשלום/מחיר/entitlement - כל אלה נגזרים כאן, בצד שרת, מהטוקן בלבד.
export type ProductAccessStatus = "active" | "pending" | "unavailable";

export interface CheckProductAccessRequest {
  reportId: string;
  productType: string;
  rawAccessToken: string;
}

export interface ProductAccessResult {
  status: ProductAccessStatus;
}

export type OrderStatusForAccess = "created" | "pending" | "paid" | "failed" | "cancelled" | "refunded";

/** רק מה שדרוש כדי להחליט - לא כל עמודות ההזמנה (לא checkout_url, לא cardcom_low_profile_code
 *  וכו') - אין סיבה שהשכבה הזו תדע עליהם בכלל. */
export interface AccessOrderLookup {
  reportId: string;
  productType: string;
  status: OrderStatusForAccess;
  verifiedAt: string | null;
  paidAt: string | null;
}

export type EntitlementStatusForAccess = "active" | "revoked" | "refunded";

export interface AccessEntitlementLookup {
  entitlementStatus: EntitlementStatusForAccess;
}

export interface PaymentAccessDatabase {
  /** מוצאת את ההזמנה **לפי hash הטוקן עצמו** (access_token_hash ייחודי בכל הטבלה - ר'
   *  migrations/20260828062934_dohefes_payment_infrastructure.sql) - זו בדיקת הבעלות: מי שמחזיק את הטוקן הגולמי הנכון "מצביע" בדיוק על
   *  הזמנה אחת ספציפית, לא לפי reportId/productType (שהם רק נבדקים **אחרי** מול מה שנמצא). */
  getOrderByAccessTokenHash(accessTokenHash: string): Promise<AccessOrderLookup | null>;
  getEntitlement(reportId: string, productType: string): Promise<AccessEntitlementLookup | null>;
}

export interface TokenHasher {
  hashAccessToken(rawToken: string): Promise<string>;
}

export interface PaymentAccessServiceDeps {
  database: PaymentAccessDatabase;
  tokenHasher: TokenHasher;
}

const UNAVAILABLE: ProductAccessResult = { status: "unavailable" };
const PENDING: ProductAccessResult = { status: "pending" };
const ACTIVE: ProductAccessResult = { status: "active" };

/**
 * זרימת ההחלטה, בסדר הזה בדיוק:
 * 1. טוקן ריק/חסר -> unavailable מיד, בלי לגעת ב-DB בכלל.
 * 2. hash את הטוקן, אתר הזמנה לפי access_token_hash. לא נמצאה -> unavailable (טוקן שגוי, ולא
 *    ניתן להבחין מכאן בין "טוקן שגוי" ל"לא קיימת הזמנה כזו בכלל" - התגובה זהה).
 * 3. ההזמנה שנמצאה **חייבת** להתאים בדיוק ל-reportId/productType שהתבקשו - אחרת unavailable
 *    (התאמה מלאה בין ההזמנה, הדוח והמוצר - לא מספיק שהטוקן "תקין" באופן כללי).
 * 4. בדיקה כפולה, מפורשת, לפני שמחזירים active: **גם** ההזמנה עצמה paid+verified_at+paid_at,
 *    **וגם** קיימת entitlement נפרדת ל-(reportId,productType) במצב active. שתי הבדיקות יחד -
 *    לא מספיק רק אחת מהן (ר' תרחישי "paid בלי entitlement" ו-entitlement revoked/refunded
 *    בבדיקות) - זו אותה הגנת-עומק כמו שאר הפרויקט, לא כפילות מיותרת.
 * 5. אם לא active: הזמנה שעדיין created/pending -> pending (תשלום בתהליך). כל מצב אחר
 *    (failed/cancelled/refunded, או paid-בלי-entitlement-תקינה - מצב חריג שלא אמור לקרות בהינתן
 *    ה-RPC האטומי, אך מטופל בזהירות) -> unavailable.
 */
export async function checkProductAccess(
  deps: PaymentAccessServiceDeps,
  request: CheckProductAccessRequest
): Promise<ProductAccessResult> {
  if (!request.rawAccessToken) {
    return UNAVAILABLE;
  }

  const accessTokenHash = await deps.tokenHasher.hashAccessToken(request.rawAccessToken);
  const order = await deps.database.getOrderByAccessTokenHash(accessTokenHash);

  if (!order) {
    return UNAVAILABLE;
  }

  if (order.reportId !== request.reportId || order.productType !== request.productType) {
    return UNAVAILABLE;
  }

  const orderFullyPaid = order.status === "paid" && order.verifiedAt !== null && order.paidAt !== null;

  if (orderFullyPaid) {
    const entitlement = await deps.database.getEntitlement(request.reportId, request.productType);
    if (entitlement && entitlement.entitlementStatus === "active") {
      return ACTIVE;
    }
    // paid אך בלי entitlement פעילה תואמת - מצב חריג (לא אמור לקרות בהינתן ה-RPC האטומי, ר'
    // migrations/20260828062934_dohefes_payment_infrastructure.sql), אך fail-closed: לא מוענקת גישה בלי entitlement מפורשת ופעילה.
    return UNAVAILABLE;
  }

  if (order.status === "created" || order.status === "pending") {
    return PENDING;
  }

  return UNAVAILABLE;
}
