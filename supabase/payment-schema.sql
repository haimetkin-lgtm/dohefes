-- תשתית תשלום והרשאות (baseReport + cashFlowAnalysis) — סכמה תוספתית בלבד
-- ר' GEN2_PAYMENT_ENTITLEMENT_DESIGN.md לתכנון המלא (audit, ארכיטקטורה, rollout מדורג).
-- קובץ נפרד מ-schema.sql (לא נוגע בו כלל) — אותו דפוס בדיוק כמו hetel-hasbaha/supabase/stage2-schema.sql
-- (סכמה נפרדת לפיצ'ר/שלב נוסף באותו פרויקט Supabase, במקום להוסיף לקובץ הראשי).
--
-- שלב זה (branch secure-payment-foundation): schema + constraints + RLS בלבד. אין חיבור מה-UI.
-- הריצה בפועל (SQL Editor, כמו כל migration קודם בפרויקט) מתוזמנת רק כשה-rollout המדורג
-- (GEN2_PAYMENT_ENTITLEMENT_DESIGN.md §6.2) מגיע לשלב 1 - לא הורצה כאן, לא כחלק מהעבודה הזו.
--
-- commit שלישי (schema tweak): הוספת checkout_url ל-dohefes_payment_orders - התגלה חסר תוך כדי
-- כתיבת create-payment-order (Edge Function ראשונה, ר' supabase/functions/create-payment-order) -
-- retry עם אותו Idempotency-Key על הזמנה pending חייב להחזיר את אותו קישור תשלום, לא ליצור
-- session שני ב-Cardcom. ר' הערה מלאה ליד השדה עצמו.
--
-- commit שני (hardening): מוסיף עוד שכבת הגנה **ברמת מסד הנתונים עצמו**, לא רק ברמת קוד ה-Edge
-- Function העתידי - כדי שאפילו קוד שרת תקין-אבל-עם-באג לא יוכל ליצור entitlement לא-חוקי. שתי
-- הגנות משלימות, לא חופפות לגמרי - ר' פירוט מלא ליד ה-trigger עצמו לגבי סדר ההפעלה בפועל:
-- (1) trigger (BEFORE INSERT/UPDATE) שדוחה entitlement שההזמנה המקושרת שלו לא paid ומאומתת
-- במלואה, או שלא תואמת report_id/product_type - זו שכבת ההגנה הראשונה שנבדקת בפועל בכל insert.
-- (2) FK מורכב (payment_order_id, report_id, product_type) - אותה הגנה על אי-התאמת דוח/מוצר,
-- אך ברמת מבנה הטבלה עצמה - עדיין פעילה גם אם ה-trigger אי-פעם יבוטל/יימחק בטעות (למשל בזמן
-- טעינת נתונים עם triggers מושבתים) - לא ניתן "לפתוח" מוצר בדוח B בעזרת הזמנה שנוצרה לדוח A,
-- או לפתוח cashFlowAnalysis בעזרת הזמנת baseReport, בשום נסיבות.
-- (3) check constraint שאוכף עקביות status='paid' מול השדות שאמורים להתמלא יחד איתו.
--
-- שינויים ל-dohefes_reports: אין. RLS על dohefes_reports: אין שינוי בשלב הזה (ר' §6.2 שלב 5 -
-- סגירת ה-policies הפתוחות שם מתוכננת רק בסוף ה-rollout, לא כאן).
--
-- מה שאסור בהחלט להיכתב לשתי הטבלאות האלה (בכל commit עתידי, לא רק כאן): מספר כרטיס אשראי,
-- תוקף כרטיס, תעודת זהות, או payload גולמי מלא מ-Cardcom אם הוא מכיל מידע אישי/פרטי כרטיס.
-- נשמרים כאן אך ורק מזהים ונתוני סכום/סטטוס הנחוצים לאימות ולביקורת - לא נתוני התשלום עצמם.

create extension if not exists "pgcrypto";

-- --- פונקציית עזר ל-updated_at ---
--
-- לא נמצא helper קיים ל-updated_at בריפו הזה או בשלושת המיזמים הדומים שנבדקו (dohefes/rami/
-- hetel-hasbaha - אף אחד מהם לא משתמש בעמודת updated_at עם trigger אוטומטי היום). נכתב כאן
-- מאפס, בשם ייחודי (קידומת dohefes_payment_) כדי לא להתנגש עם פונקציה בשם דומה שאולי כבר קיימת
-- בפרויקט ה-Supabase המשותף (insure-vda/rami/hetel-hasbaha/dohefes) - לא ניתן לאמת מהריפו הזה
-- בלבד שהשם פנוי, ר' GEN2_PAYMENT_ENTITLEMENT_DESIGN.md §3.
--
-- security invoker (ברירת המחדל, לא מוגדר security definer במפורש): לא נוגעת בשום טבלה מלבד
-- השורה שמופעלת עליה (new.updated_at בלבד) - אין לה צורך בהרשאות מוגברות, ולכן גם לא ב-search_path
-- קבוע. EXECUTE מוסר מ-PUBLIC בכל זאת (למטה) - אין סיבה שאף תפקיד יקרא לה ישירות מחוץ להקשר trigger.
create or replace function dohefes_payment_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

revoke execute on function dohefes_payment_touch_updated_at() from public;

-- --- payment_orders: "ניסיון תשלום" - נוצר לפני שהעסקה בהכרח הצליחה ---
--
-- expected_amount_agorot: אגורות כמספר שלם (למשל 98000 = 980.00 ₪), לא numeric/float - נמנע
-- מעיגול נקודה-צפה בכסף. שם השדה כולל "expected" במפורש: זה הסכום שהוזמן/צפוי, לא אישור
-- שהתקבל בפועל (זה מה ש-verified_at/paid_at למטה מייצגים). **בלי default** - נקבע אך ורק על
-- ידי Edge Function עתידית (create-payment-order) לפי product_type, בקוד השרת, לא כברירת מחדל
-- שניתנת לשינוי/דריסה - ר' GEN2_PAYMENT_ENTITLEMENT_DESIGN.md §4.1/§4.2.
--
-- currency_code: 1 = ש"ח (שקל), לפי ממשק Cardcom המתוכנן (LowProfileCode) - ערך קבוע יחיד
-- כרגע (אין תמיכה מתוכננת במטבע אחר), נאכף ב-check מפורש כדי שערך אחר יידחה מיד, לא יתקבל בשקט.
--
-- ארבעה מזהים נפרדים, לא "payment_reference" מאוחד אחד - כל אחד ממלא תפקיד אחר בזרימה מול
-- Cardcom (ר' GEN2_PAYMENT_ENTITLEMENT_DESIGN.md §4.2):
--   idempotency_key            - מזהה פנימי שלנו, מונע כפילות אם create-payment-order נקראת פעמיים
--                                 (למשל retry אחרי timeout ברשת) - נקבע ברגע יצירת ההזמנה, לפני כל
--                                 פנייה ל-Cardcom.
--   provider_order_reference   - הערך שאנחנו שולחים ל-Cardcom כדי לזהות את ההזמנה שלנו מולו
--                                 (correlation), גם הוא נקבע לפנינו קוראים ל-Cardcom.
--   cardcom_low_profile_code   - LowProfileCode שחוזר מ-Cardcom - לא ידוע עד שנוצר session תשלום
--                                 בפועל, לכן nullable.
--   cardcom_internal_deal_number - מספר העסקה הפנימי של Cardcom עצמו (TranzactionId) - מתקבל רק
--                                 אחרי GetLowProfileIndicator מוצלח, לכן nullable.
-- כל השדות עם unique נפרד (לא unique משותף) - מזהה כפול בכל אחד מהם, בנפרד, נדחה על ידי
-- Postgres ולא יוצר entitlement כפול (ר' §4.1 "idempotency ל-callback/webhook").
--
-- checkout_url: **נוסף במהלך יישום create-payment-order** (לא היה בסכמה המקורית שאושרה) - שדה
-- הכרחי שהתגלה חסר, לא עוקף: כש-idempotency-key חוזר על הזמנה שכבר ב-status='pending' (המשתמש
-- לא הגיע ל-Cardcom בזמן, למשל טאב נסגר), הפונקציה חייבת להחזיר לו את אותו קישור תשלום מקורי -
-- **לא** ליצור session תשלום שני ב-Cardcom (שהיה מייצר שני LowProfileCode לאותה הזמנה, נגד כל
-- עקרון ה-idempotency). ללא השדה הזה אין שום דרך לשחזר את הקישור בלי לקרוא ל-Cardcom שוב. nullable
-- (ריק עד ש-Cardcom מחזירה אותו בהצלחה, בדיוק כמו cardcom_low_profile_code).
--
-- access_token_hash: **חובה גם כש-RLS לא מעניקה שום גישה ל-anon** - ה-Edge Function עצמה
-- (cardcom-payment-indicator/get-product-access) פועלת עם service_role וכך עוקפת RLS לגמרי;
-- בלי login במערכת, זו חייבת לאמת בעצמה שמי שפונה אליה מחזיק את הסוד המתאים לאותה הזמנה/דוח,
-- לפני שהיא משתמשת בהרשאת ה-service_role שלה. כלל מחייב לכל מימוש עתידי של Edge Function:
--   - השרת מייצר token אקראי-קריפטוגרפית (לא נחוש/רציף).
--   - מחזיר אותו ללקוח פעם אחת בלבד (בתגובת create-payment-order) - לא נשמר בשום מקום אחר בענן.
--   - נשמר במסד **רק** כ-hash (SHA-256) - העמודה כאן היא access_token_hash, לעולם לא הטוקן הגולמי.
--   - הטוקן הגולמי **לעולם לא** נכתב ללוגים (לא server logs, לא Supabase logs, לא הודעות שגיאה).
--   - get-product-access מאמתת את הטוקן שמגיע מהלקוח מול ה-hash השמור **לפני** שהיא נוגעת
--     בטבלאות עם ה-service_role שלה.
-- אין יצירת token בפועל ב-commit הזה - רק העמודה + הכלל המתועד. ר' GEN2_PAYMENT_ENTITLEMENT_DESIGN.md §5.2.
--
-- unique(id, report_id, product_type) (בנוסף ל-primary key(id)): לא לצורך ייחודיות נוספת -
-- id כבר ייחודי לבדו - אלא כי Postgres דורש שהעמודות שמפנה אליהן foreign key מורכב יהיו
-- מכוסות ב-unique constraint על **בדיוק** אותו שילוב עמודות. זה מה שמאפשר ל-entitlements
-- (למטה) להפנות (payment_order_id, report_id, product_type) לשלישייה הזו - לא ניתן להשתמש
-- ב-id של הזמנה בלי שגם report_id וגם product_type יתאימו בדיוק לאותה הזמנה.
--
-- check constraint על עקביות status='paid': כשההזמנה מסומנת "שולמה", ארבעת השדות שמעידים
-- על כך בפועל (מתי אומתה, מתי שולמה, ושני מזהי Cardcom) חייבים כולם להיות מלאים - לא ניתן
-- לסמן paid "יבש" בלי העדות שמאחוריו. סטטוסים אחרים (created/pending/failed/cancelled/refunded)
-- לא כפופים לדרישה הזו - יכולים להיות עם/בלי השדות האלה לפי הצורך.
create table if not exists dohefes_payment_orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  report_id uuid not null references dohefes_reports(id) on delete restrict,
  product_type text not null check (product_type in ('baseReport', 'cashFlowAnalysis')),
  expected_amount_agorot integer not null check (expected_amount_agorot > 0),
  currency_code integer not null check (currency_code = 1),
  status text not null default 'created'
    check (status in ('created', 'pending', 'paid', 'failed', 'cancelled', 'refunded')),
  idempotency_key text not null unique,
  provider_order_reference text not null unique,
  cardcom_low_profile_code text unique,
  cardcom_internal_deal_number text unique,
  checkout_url text,
  access_token_hash text not null unique,
  verified_at timestamptz,
  paid_at timestamptz,
  failure_code text,
  unique (id, report_id, product_type),
  constraint dohefes_payment_orders_paid_requires_evidence check (
    status <> 'paid'
    or (
      verified_at is not null
      and paid_at is not null
      and cardcom_low_profile_code is not null
      and cardcom_internal_deal_number is not null
    )
  ),
  constraint dohefes_payment_orders_paid_at_after_created check (paid_at is null or paid_at >= created_at),
  constraint dohefes_payment_orders_verified_at_after_created check (verified_at is null or verified_at >= created_at)
);

create trigger dohefes_payment_orders_touch_updated_at
  before update on dohefes_payment_orders
  for each row execute function dohefes_payment_touch_updated_at();

create index if not exists idx_dohefes_payment_orders_report_id on dohefes_payment_orders(report_id);
create index if not exists idx_dohefes_payment_orders_product_type on dohefes_payment_orders(product_type);
create index if not exists idx_dohefes_payment_orders_status on dohefes_payment_orders(status);
-- הערה: idempotency_key/provider_order_reference/cardcom_low_profile_code/cardcom_internal_deal_number/
-- access_token_hash כבר מקבלים אינדקס אוטומטית מה-UNIQUE constraints שלהם למעלה - אין צורך
-- באינדקסים נפרדים/כפולים עליהם.

-- --- product_entitlements: ההרשאה בפועל למוצר - נפרדת מהתשלום עצמו ---
--
-- entitlement_status (לא payment_status): ההרשאה מתארת **גישה למוצר**, לא מצב תשלום - מצב
-- התשלום עצמו חי אך ורק ב-payment_orders.status. שלושה ערכים: active (יש גישה כרגע), revoked
-- (גישה בוטלה, לא בהכרח בגלל refund - למשל טעות אדמין), refunded (בוטלה ספציפית עקב זיכוי כספי).
-- אין ערך "pending" כאן במפורש: שורת entitlement נוצרת רק **אחרי** ש-cardcom-payment-indicator
-- כבר אימתה תשלום מוצלח (ר' §4.2) - אם התשלום עוד לא אומת, ה-trigger למטה חוסם את היצירה לגמרי,
-- לא רק "לא ממליץ עליה". granted_at not null default now(): entitlement לא קיים כטיוטה - הוא
-- נוצר רק ברגע שכבר עבר את ה-trigger, כלומר רק אחרי תשלום מאומת - אין מצב "ממתין למענק".
--
-- payment_order_id: not null - כל entitlement מקושרת בדיוק להזמנה אחת. הקשר עצמו **לא** FK
-- פשוט ל-id בלבד יותר - ר' foreign key מורכב למטה.
--
-- unique(report_id, product_type) נשאר (לא partial index): שורת הרשאה אחת בלבד לכל זוג
-- (דוח, מוצר) לכל החיים - entitlement_status עצמו עובר מצבים (active -> revoked/refunded, ואולי
-- active מחדש ברכישה חוזרת אחרי refund) בתוך אותה שורה, לא על ידי הוספת שורה נוספת.
--
-- foreign key מורכב (payment_order_id, report_id, product_type) -> dohefes_payment_orders
-- (id, report_id, product_type): מפני "פתיחת מוצר בדוח B בעזרת הזמנה שנוצרה בפועל לדוח A", או
-- "פתיחת cashFlowAnalysis בעזרת הזמנת baseReport" - ברמת **מבנה הטבלה עצמו**, לא רק כהנחה על
-- קוד ה-Edge Function העתידי. **הערה על סדר בדיקה בפועל**: ה-trigger למטה (BEFORE INSERT/UPDATE)
-- רץ *לפני* שה-foreign key נבדק בכלל (כך עובד סדר האכיפה הרגיל ב-Postgres - BEFORE triggers
-- קודמים לבדיקת constraints) - כלומר בזרימה הרגילה, אי-ההתאמה נתפסת קודם בהודעת ה-trigger, לא
-- בהודעת "violates foreign key constraint". ה-foreign key הוא בכל זאת קו הגנה נפרד וחשוב: הוא
-- ממשיך לחסום את אותה אי-התאמה גם בתרחיש שבו ה-trigger הזה אי-פעם מבוטל/מושבת/נמחק בטעות
-- (למשל טעינת נתונים עם `session_replication_role=replica`, שמשביתה triggers רגילים) - הוא לא
-- תלוי בכך שה-trigger קיים ותקין כדי לספק את ההגנה הזו.
create table if not exists dohefes_product_entitlements (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  report_id uuid not null references dohefes_reports(id) on delete restrict,
  product_type text not null check (product_type in ('baseReport', 'cashFlowAnalysis')),
  entitlement_status text not null default 'active'
    check (entitlement_status in ('active', 'revoked', 'refunded')),
  granted_at timestamptz not null default now(),
  payment_order_id uuid not null,
  unique (payment_order_id),
  unique (report_id, product_type),
  foreign key (payment_order_id, report_id, product_type)
    references dohefes_payment_orders (id, report_id, product_type)
    on delete restrict
);

create trigger dohefes_product_entitlements_touch_updated_at
  before update on dohefes_product_entitlements
  for each row execute function dohefes_payment_touch_updated_at();

-- --- trigger הגנתי: entitlement לא נוצר/מתעדכן בלי הזמנה משולמת ומאומתת במלואה ---
--
-- לא מסתמך על כך ש-Edge Function עתידית "תזכור" לבדוק את זה - זו אכיפה ברמת מסד הנתונים,
-- חוסמת כל insert/update על השורה, גם אם קוד השרת שכתב אותה תקין-במבנהו אך יש בו טעות לוגית.
--
-- בודקת גם, במפורש, התאמת report_id/product_type בין ה-entitlement להזמנה המקושרת - זו בפועל
-- שכבת הבדיקה **הראשונה** שנתקלים בה (BEFORE trigger רץ לפני שה-foreign key המורכב על הטבלה
-- נבדק בכלל, ר' הערה ליד הגדרת ה-foreign key למעלה) - לא כפילות מיותרת: ה-foreign key נשאר קו
-- הגנה נפרד ועצמאי בתרחיש שבו ה-trigger הזה אי-פעם מבוטל/מושבת/נמחק בטעות, לא מסתמך על כך
-- ששניהם תמיד קיימים יחד.
--
-- security definer + search_path קבוע ובטוח (pg_catalog, public בלבד - לא כולל שום סכימה
-- שמשתמש יכול ליצור/לשנות): מבטיח שהבדיקה מול dohefes_payment_orders עובדת בעקביות בלי תלות
-- בהרשאות הקריאה של התפקיד שמבצע את ה-insert/update בפועל, ומונע search_path hijacking
-- (טכניקת התקפה סטנדרטית מול פונקציות security definer עם search_path לא-קבוע).
-- EXECUTE על הפונקציה מוסר במפורש מ-PUBLIC (כולל anon) - היא מיועדת להיקרא רק על ידי מנגנון
-- ה-trigger עצמו, לא כקריאת פונקציה ישירה מאף תפקיד.
--
-- אינה מקבלת שום ערך מהלקוח (טריגר, לא קוראת פרמטרים חיצוניים), אינה משתמשת ב-dynamic SQL
-- (שאילתה סטטית קבועה בלבד), ואינה כוללת מזהים (UUID של ההזמנה וכו') בהודעת השגיאה - רק תיאור
-- כללי של מה שנכשל, כדי לא לחשוף פרטי הזמנה מעבר לנדרש.
create or replace function dohefes_payment_entitlement_requires_verified_order()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  matched_order dohefes_payment_orders%rowtype;
begin
  select *
  into matched_order
  from dohefes_payment_orders o
  where o.id = new.payment_order_id
  for share;

  if not found then
    raise exception 'dohefes_product_entitlements: linked payment order not found';
  end if;

  -- כפילות מכוונת מול ה-foreign key המורכב על הטבלה - ר' הערה למעלה
  if matched_order.report_id is distinct from new.report_id
     or matched_order.product_type is distinct from new.product_type then
    raise exception 'dohefes_product_entitlements: linked payment order does not match report/product';
  end if;

  if matched_order.status <> 'paid'
     or matched_order.verified_at is null
     or matched_order.paid_at is null then
    raise exception 'dohefes_product_entitlements: linked payment order is not a fully verified paid order';
  end if;

  return new;
end;
$$;

revoke execute on function dohefes_payment_entitlement_requires_verified_order() from public;

create trigger dohefes_product_entitlements_require_verified_order
  before insert or update on dohefes_product_entitlements
  for each row execute function dohefes_payment_entitlement_requires_verified_order();

create index if not exists idx_dohefes_product_entitlements_report_id on dohefes_product_entitlements(report_id);
create index if not exists idx_dohefes_product_entitlements_product_type on dohefes_product_entitlements(product_type);
create index if not exists idx_dohefes_product_entitlements_entitlement_status on dohefes_product_entitlements(entitlement_status);
-- הערה: payment_order_id כבר מקבל אינדקס אוטומטית מה-UNIQUE constraint שלו למעלה.

-- --- מחיקות: RESTRICT מפורש, לא CASCADE, לא ברירת המחדל המרומזת ---
--
-- שתי הפניות ל-dohefes_reports(id) (בשתי הטבלאות) ואחת ל-dohefes_payment_orders(id) (מ-entitlements)
-- כולן on delete restrict במפורש: מחיקת דוח/הזמנה שיש להם רשומות תשלום/הרשאה תלויות **נחסמת**
-- לגמרי, לא גוררת מחיקה שקטה של היסטוריית תשלום (cascade) ולא נשארת מרומזת בברירת המחדל של
-- Postgres (NO ACTION, שמתנהגת דומה אך לא זהה - RESTRICT נבדק מיידית, לא נדחה לסוף הטרנזקציה).
-- זה מתועד כדרישה מפורשת: תיעוד כספי לא נמחק בשקט אף פעם, כולל לא כתוצאה עקיפה ממחיקת דוח.

-- --- RLS: מופעלת, ובכוונה בלי אף policy לאנונימי ---
--
-- שונה במפורש מ-dohefes_reports הקיים (using(true)/with check(true), ר' GEN2_PAYMENT_ENTITLEMENT_DESIGN.md
-- §2.1/§2.2) ומכל ארבעת המיזמים שנסקרו שם (§0) - כאן אין אף policy בכלל לתפקיד anon, על אף
-- פעולה (select/insert/update/delete). RLS מופעלת בלי policies אומרת ש**כל** בקשה עם ה-anon key
-- נדחית עבור **כל** פעולה על שתי הטבלאות האלה, בלי יוצא מן הכלל, כולל יצירת הזמנה. הדרך היחידה
-- לגעת בטבלאות האלה - קריאה או כתיבה - היא Edge Function עתידית עם service_role key (עוקף RLS
-- מטבעו, ר' §4.2: create-payment-order/cardcom-payment-indicator/get-product-access), שמאמתת
-- בעצמה access_token_hash לפני כל שימוש ב-service_role שלה. עדיין לא קיימת, לא נכתבת ב-commit הזה.
alter table dohefes_payment_orders enable row level security;
alter table dohefes_product_entitlements enable row level security;

-- --- Rollback (מתועד בלבד, לא מבוצע) ---
--
-- drop trigger if exists dohefes_product_entitlements_require_verified_order on dohefes_product_entitlements;
-- drop trigger if exists dohefes_product_entitlements_touch_updated_at on dohefes_product_entitlements;
-- drop trigger if exists dohefes_payment_orders_touch_updated_at on dohefes_payment_orders;
-- drop table if exists dohefes_product_entitlements;
-- drop table if exists dohefes_payment_orders;
-- drop function if exists dohefes_payment_entitlement_requires_verified_order();
-- drop function if exists dohefes_payment_touch_updated_at();
--
-- בטוח לביצוע בכל שלב: אין foreign key בכיוון ההפוך (dohefes_reports לא מפנה לשתי הטבלאות
-- האלה), ואין קוד קיים (React/Edge Function) שתלוי בהן - הן לא נצרכות על ידי שום דבר עד commit
-- עתידי. הסדר למעלה (triggers -> entitlements -> orders -> functions) חשוב: entitlements תלויה
-- ב-orders דרך foreign key, וכל פונקציה נמחקת רק אחרי שה-trigger/ים שמשתמשים בה כבר לא קיימים.

-- --- תרחישי בדיקה ידניים (מתועדים בלבד - לא מבוצעים אוטומטית, לא כחלק מה-commit הזה) ---
--
-- להרצה ידנית ב-SQL Editor **אחרי** שה-migration הזו כבר רצה בפועל (לא כאן, לא כעת - ר' §6.2),
-- בתוך טרנזקציה עם rollback כדי לא להשאיר נתוני בדיקה: `begin; ... בדיקות ... ; rollback;`.
-- כל השאילתות למטה הן דוגמאות מלאות - יש להחליף placeholders (<...>) בערכים אמיתיים מתוך דוח
-- קיים לפני הרצה. אף אחת מהן לא נועדה לרוץ כפי שהיא מ-CI/סקריפט אוטומטי.
--
-- הכנה (בהנחה ש-<report-A>/<report-B> הם uuid קיימים ב-dohefes_reports):
--
--   insert into dohefes_payment_orders
--     (report_id, product_type, expected_amount_agorot, currency_code, idempotency_key,
--      provider_order_reference, access_token_hash)
--   values ('<report-A>', 'cashFlowAnalysis', 98000, 1, 'idem-test-1', 'order-ref-test-1', 'hash-test-1')
--   returning id;  -- שמור כ-<pending-order-id>
--
-- 1. entitlement להזמנה pending -> נכשל (ה-trigger בודק status='paid'):
--   insert into dohefes_product_entitlements (report_id, product_type, payment_order_id)
--   values ('<report-A>', 'cashFlowAnalysis', '<pending-order-id>');
--   -- צפוי: EXCEPTION "...is not a fully verified paid order"
--
-- 2. entitlement לדוח אחר מזה שבהזמנה -> נכשל. ה-trigger (BEFORE) רץ ראשון ותופס את זה -
--    ה-foreign key המורכב לא מגיע להיבדק בזרימה הרגילה (ר' הערה ליד ה-trigger), אך ממשיך
--    לחסום את אותו תרחיש בדיוק גם אם ה-trigger אי-פעם מבוטל:
--   insert into dohefes_product_entitlements (report_id, product_type, payment_order_id)
--   values ('<report-B>', 'cashFlowAnalysis', '<pending-order-id>');
--   -- צפוי: EXCEPTION "...does not match report/product" (מה-trigger)
--
-- 3. entitlement למוצר אחר מזה שבהזמנה -> נכשל, אותה סיבה כמו #2:
--   insert into dohefes_product_entitlements (report_id, product_type, payment_order_id)
--   values ('<report-A>', 'baseReport', '<pending-order-id>');
--   -- צפוי: EXCEPTION "...does not match report/product" (מה-trigger)
--
-- 4. סימון ההזמנה כ-paid באופן תקין ומלא, ואז entitlement תואם -> מצליח:
--   update dohefes_payment_orders
--   set status = 'paid', verified_at = now(), paid_at = now(),
--       cardcom_low_profile_code = 'lpc-test-1', cardcom_internal_deal_number = 'deal-test-1'
--   where id = '<pending-order-id>';
--
--   insert into dohefes_product_entitlements (report_id, product_type, payment_order_id)
--   values ('<report-A>', 'cashFlowAnalysis', '<pending-order-id>');
--   -- צפוי: מצליח, שורה אחת נוצרת עם entitlement_status='active'
--
-- 5. אותה הזמנה פעם שנייה (entitlement נוסף לאותו payment_order_id) -> נכשל (unique(payment_order_id)):
--   insert into dohefes_product_entitlements (report_id, product_type, payment_order_id)
--   values ('<report-A>', 'cashFlowAnalysis', '<pending-order-id>');
--   -- צפוי: EXCEPTION duplicate key value violates unique constraint ".../payment_order_id"
--
-- 6. אותו (report_id, product_type) פעם שנייה, דרך הזמנה שנייה ונפרדת שגם היא paid כחוק -> נכשל
--    (unique(report_id, product_type), למרות שההזמנה עצמה תקינה ושונה):
--   -- (יוצרים הזמנה שנייה תקינה ומאומתת לאותו report_id/product_type בדיוק, ואז:)
--   insert into dohefes_product_entitlements (report_id, product_type, payment_order_id)
--   values ('<report-A>', 'cashFlowAnalysis', '<second-paid-order-id>');
--   -- צפוי: EXCEPTION duplicate key value violates unique constraint ".../report_id_product_type"
--
-- 7. הזמנה מסומנת paid בלי timestamps/מזהי Cardcom -> נכשל כבר ב-UPDATE של ההזמנה עצמה, לפני
--    שמגיעים בכלל לשלב entitlement (check constraint על payment_orders):
--   update dohefes_payment_orders set status = 'paid' where id = '<some-other-created-order-id>';
--   -- צפוי: EXCEPTION violates check constraint "dohefes_payment_orders_paid_requires_evidence"
