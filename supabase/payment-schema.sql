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

-- --- commit רביעי (RPC אטומי): dohefes_finalize_verified_payment ---
--
-- זו נקודת הכתיבה **היחידה** שמותר ל-Edge Function עתידית (cardcom-payment-indicator) לקרוא לה
-- אחרי שהיא כבר אימתה תשלום מול Cardcom בעצמה (server-to-server, GetLowProfileIndicator) - אסור
-- לה לבצע UPDATE על payment_orders ו-INSERT על product_entitlements כשתי פעולות נפרדות משלה.
-- הסיבה: בלי RPC אטומי יחיד, כשל בין שתי הפעולות (קריסת תהליך, timeout רשת בין הקריאות) עלול
-- להשאיר הזמנה עם status='paid' בלי entitlement תואמת - בדיוק המצב שאסור שיקרה. כאן, שתי
-- הפעולות (עדכון ההזמנה + upsert ה-entitlement) קורות בתוך גוף פונקציה אחד, שרץ כטרנזקציה אחת
-- מובנית (Postgres עוטף כל קריאת פונקציה ברמה העליונה בטרנזקציה מרומזת אם אין אחת כבר פתוחה) -
-- אם משהו נכשל באמצע, הכל חוזר לאחור, כולל עדכון ההזמנה.
--
-- **report_id/product_type/סכום/מטבע אינם פרמטרים של הפונקציה בכלל** - נקראים אך ורק מתוך
-- השורה שננעלה (`v_order`, למטה). אין דרך לקרוא לפונקציה הזו ולהעביר לה ידנית לאיזה דוח/מוצר
-- לשייך את ה-entitlement - היא תמיד משייכת אותה בדיוק לדוח/מוצר שכתובים בפועל בהזמנה שזוהתה
-- לפי cardcom_low_profile_code. שני הפרמטרים היחידים: p_low_profile_code (מזהה איזו הזמנה
-- לנעול - הערך שה-Edge Function כבר קיבלה מהעיבוד של ה-webhook), ו-p_cardcom_internal_deal_number
-- (העובדה החדשה היחידה שה-Edge Function הביאה מהאימות מול Cardcom).
--
-- נעילה: `for update` (בלעדית, לא `for share` כמו ב-trigger למעלה) - הפונקציה הזו **כותבת**
-- להזמנה, לכן צריכה נעילה בלעדית; שתי קריאות מקבילות עם אותו p_low_profile_code (למשל webhook
-- שנשלח פעמיים כמעט בו-זמנית) מסתדרות בתור - הקריאה השנייה ממתינה, ואז רואה את התוצאה המעודכנת
-- של הראשונה ומגיבה בהתאם (idempotent אם אותה אסמכתה, deal_mismatch אם שונה).
--
-- security definer + search_path קבוע (pg_catalog, public) + revoke/grant: אותו דפוס הקשחה
-- בדיוק כמו dohefes_payment_entitlement_requires_verified_order למעלה, מאותה סיבה - עקביות
-- ומניעת search_path hijacking. EXECUTE מוסר במפורש גם מ-anon/authenticated (לא רק מ-PUBLIC,
-- למרות ששניהם ממילא לא יורשים דרך PUBLIC אחרי ה-revoke - הכתיבה המפורשת כאן היא כדי שהכוונה
-- תהיה חד-משמעית לקורא עתידי, לא תלויה בהיסק על סמנטיקת PUBLIC). EXECUTE מוענק **רק** ל-service_role -
-- אף תפקיד אחר לא יכול לקרוא לפונקציה הזו בכלל, גם לא בעקיפין.
--
-- בלי SQL דינמי בשום מקום (אין EXECUTE של מחרוזת) - כל שאילתה סטטית וקבועה מראש.
--
-- ה-outcome המוחזר הוא תמיד שורה אחת עם קוד טקסטואלי כללי (לא PII, לא Description של Cardcom,
-- לא שום שדה גולמי) - הקוד עצמו (ר' ההסתעפויות למטה) מיועד לשימוש פנימי של ה-Edge Function
-- כדי להחליט מה להשיב ללקוח/ל-Cardcom (200/5xx וכו') - לא מוחזר כמות שהוא כלפי חוץ.
--
-- --- פונקציית עזר: יצירה או הפעלה מחדש של entitlement, idempotent ---
--
-- מופרדת מהפונקציה הראשית כי נקראת משני מקומות בתוכה (הנתיב ה"טרי" והנתיב ה-idempotent) - לא
-- שכפול קוד. `on conflict (report_id, product_type)`: זה המפתח הטבעי היחיד שיכול להתנגש כאן -
-- ה-foreign key המורכב על הטבלה (ר' הגדרתה למעלה) מבטיח מבנית ש-payment_order_id שמועבר לכאן
-- כבר קשור בהכרח לאותם report_id/product_type בדיוק (שניהם נלקחים מאותה שורת הזמנה נעולה),
-- ולכן `unique(payment_order_id)` לא יכול להתנגש כאן בפועל - אין תרחיש שבו אותה הזמנה מקושרת
-- לזוג (report_id, product_type) שונה מזה שכתוב בה. ריענון granted_at=now() בכל הפעלה/יצירה
-- (גם כשכבר active) - "reactivation" בכוונה מתעד את הרגע הנוכחי, לא רק את הראשון-אי-פעם.
create or replace function dohefes_upsert_active_entitlement(
  p_payment_order_id uuid,
  p_report_id uuid,
  p_product_type text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_entitlement_id uuid;
begin
  insert into dohefes_product_entitlements (report_id, product_type, entitlement_status, granted_at, payment_order_id)
  values (p_report_id, p_product_type, 'active', now(), p_payment_order_id)
  on conflict (report_id, product_type) do update
    set entitlement_status = 'active',
        granted_at = now(),
        payment_order_id = excluded.payment_order_id
  returning id into v_entitlement_id;

  return v_entitlement_id;
end;
$$;

revoke execute on function dohefes_upsert_active_entitlement(uuid, uuid, text) from public, anon, authenticated;
grant execute on function dohefes_upsert_active_entitlement(uuid, uuid, text) to service_role;

-- --- commit חמישי (ביקורת אבטחה): הגנת-עומק על סכום/מטבע/ReturnValue בתוך ה-RPC עצמו ---
--
-- **ממצא ביקורת**: הגרסה המקורית של הפונקציה הזו (commit d55f02b) קיבלה רק p_low_profile_code
-- ו-p_cardcom_internal_deal_number, ו**סמכה במלואה** על כך שהקוד הקורא לה (cardcom-payment-indicator)
-- כבר אימת את הסכום/המטבע/ה-ReturnValue מול Cardcom לפני הקריאה. זה עמד בסתירה לעיקרון שמונחה
-- את שאר הקובץ הזה מתחילתו (ר' ה-trigger dohefes_payment_entitlement_requires_verified_order
-- למעלה, שקיים בדיוק כדי **לא** לסמוך על כך שקוד השרת נכון-בהכרח): כל בעל service_role
-- (כולל Edge Function עתידית עם באג, או session ידני ב-SQL Editor) יכול היה לקרוא לפונקציה עם
-- p_cardcom_internal_deal_number מומצא לחלוטין ולסמן הזמנה כלשהי כ-paid, בלי שום אימות עצמאי
-- ברמת מסד הנתונים שהסכום/המטבע/ה-ReturnValue שנטען אכן תואמים למה ש-Cardcom דיווחה בפועל.
--
-- **התיקון**: שלושה פרמטרים נוספים - p_verified_provider_order_reference/p_verified_amount_agorot/
-- p_verified_currency_code - הערכים שה-Edge Function קיבלה בפועל מקריאת server-to-server אמיתית
-- ל-Cardcom (GetLowProfileIndicator), **לא** מה-webhook הנכנס עצמו. הפונקציה משווה אותם כאן,
-- באופן עצמאי, מול העמודות המתאימות בשורה שננעלה (v_order.provider_order_reference/
-- expected_amount_agorot/currency_code) - **לא** כותבת אותם לשום מקום (ההזמנה/ה-entitlement
-- ממשיכים להיגזר אך ורק מ-v_order, בדיוק כמו קודם) - זו בדיקת שקילות בלבד, הגנת-עומק עצמאית
-- שממשיכה לחסום גם אם שכבת ה-service תיפרץ/תבאג בעתיד, בדיוק כמו שה-trigger למעלה עושה עבור
-- report_id/product_type. **אין כאן סתירה** לדרישה המקורית "אין להעביר report_id/product_type/
-- סכום/מטבע כפרמטרים חיצוניים לצורך יצירת ה-entitlement" - הערכים האלה עדיין לא נכתבים לשום
-- מקום, הם רק נבדקים מול מה שכבר קיים בשורה הנעולה, לפני שמתבצעת מוטציה כלשהי.
--
-- --- הפונקציה הראשית ---
--
-- outcome אפשריים (כולם מוחזרים כשורה תקינה, לא כ-exception - כשל צפוי אינו שגיאת קוד):
--   'finalized'             - ההזמנה עברה מ-created/pending ל-paid בהצלחה, entitlement נוצרה/מופעלת.
--   'already_finalized'     - כבר הייתה paid עם **אותה** אסמכתה בדיוק - idempotent, אין שינוי נוסף
--                             מעבר לוידוא ש-entitlement קיימת (retry בטוח לחלוטין, אין תופעות לוואי כפולות).
--   'deal_mismatch'         - כבר הייתה paid, אך עם אסמכתה **שונה** - נתפס כנכשל, ההזמנה לא משתנה
--                             (חשד לתרחיש לא-תקין: איך יש שתי אסמכתאות Cardcom שונות לאותה הזמנה).
--   'terminal_state'        - ההזמנה כבר ב-failed/cancelled/refunded - לא נפתחת מחדש בשקט, אין
--                             מדיניות מוגדרת עדיין ל"תחיית" הזמנה שכבר הגיעה למצב סופי לא-משולם.
--   'deal_number_conflict'  - ה-InternalDealNumber שהתקבל כבר שייך **להזמנה אחרת** (unique constraint
--                             הקיים כבר על cardcom_internal_deal_number - ר' הגדרת הטבלה למעלה) -
--                             נתפס ב-EXCEPTION block, לא מוחזר כשגיאת Postgres גולמית ללקוח.
--   'verification_mismatch' - הסכום/המטבע/ה-ReturnValue המאומתים שהתקבלו **לא תואמים** למה
--                             שכתוב בפועל בהזמנה שננעלה - נבדק **לפני** כל הסתעפות אחרת (גם לפני
--                             בדיקת "כבר paid"), כי זו אי-התאמה יסודית יותר מכל סטטוס - חשודה
--                             ומדווחת כאירוע אבטחה בשכבת ה-service (ר' payment-indicator-service.ts).
--   'not_found'             - אין הזמנה עם p_low_profile_code הזה - לא חושפים יותר מזה.
--   'invalid_input'         - פרמטר חסר (null) - שגיאת קריאה, לא תרחיש Cardcom אמיתי.
create or replace function dohefes_finalize_verified_payment(
  p_low_profile_code text,
  p_cardcom_internal_deal_number text,
  p_verified_provider_order_reference text,
  p_verified_amount_agorot integer,
  p_verified_currency_code integer
)
returns table (
  outcome text,
  order_id uuid,
  report_id uuid,
  product_type text,
  entitlement_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order dohefes_payment_orders%rowtype;
  v_entitlement_id uuid;
begin
  if p_low_profile_code is null
     or p_cardcom_internal_deal_number is null
     or p_verified_provider_order_reference is null
     or p_verified_amount_agorot is null
     or p_verified_currency_code is null then
    return query select 'invalid_input'::text, null::uuid, null::uuid, null::text, null::uuid;
    return;
  end if;

  -- שלב 1-2: נעילת ההזמנה המתאימה + אימות שהיא קיימת.
  select *
  into v_order
  from dohefes_payment_orders
  where cardcom_low_profile_code = p_low_profile_code
  for update;

  if not found then
    return query select 'not_found'::text, null::uuid, null::uuid, null::text, null::uuid;
    return;
  end if;

  -- הגנת-עומק: הערכים המאומתים מול Cardcom חייבים לתאום את ההזמנה הנעולה עצמה - **לפני** כל
  -- הסתעפות אחרת (ר' הערת "commit חמישי" למעלה לנימוק המלא). לא כותבת כלום - רק בדיקת שקילות.
  if v_order.provider_order_reference is distinct from p_verified_provider_order_reference
     or v_order.expected_amount_agorot is distinct from p_verified_amount_agorot
     or v_order.currency_code is distinct from p_verified_currency_code then
    return query select 'verification_mismatch'::text, v_order.id, v_order.report_id, v_order.product_type, null::uuid;
    return;
  end if;

  -- שלב 3-4: כבר paid - idempotent אם אותה אסמכתה, נכשל אם אסמכתה אחרת.
  if v_order.status = 'paid' then
    if v_order.cardcom_internal_deal_number = p_cardcom_internal_deal_number then
      v_entitlement_id := dohefes_upsert_active_entitlement(v_order.id, v_order.report_id, v_order.product_type);
      return query select 'already_finalized'::text, v_order.id, v_order.report_id, v_order.product_type, v_entitlement_id;
      return;
    else
      return query select 'deal_mismatch'::text, v_order.id, v_order.report_id, v_order.product_type, null::uuid;
      return;
    end if;
  end if;

  -- מצב סופי לא-משולם (failed/cancelled/refunded) - לא נפתח מחדש בלי מדיניות מפורשת.
  if v_order.status <> 'created' and v_order.status <> 'pending' then
    return query select 'terminal_state'::text, v_order.id, v_order.report_id, v_order.product_type, null::uuid;
    return;
  end if;

  -- שלב 5: עדכון ההזמנה עצמה ל-paid, עם כל העדות הנדרשת (ר' dohefes_payment_orders_paid_requires_evidence
  -- למעלה - חייבים למלא את כל ארבעת השדות יחד, אחרת ה-check constraint הזה כבר יכשיל את ה-UPDATE).
  -- **חייב לקרות לפני** upsert ה-entitlement (שלב 6) - ה-trigger dohefes_product_entitlements_require_verified_order
  -- דורש שההזמנה כבר תהיה paid+verified_at+paid_at כשה-entitlement נכתבת; מכיוון ששתי הפעולות
  -- קורות באותה קריאת פונקציה (=אותה טרנזקציה), ה-UPDATE כאן כבר "נראה" על ידי ה-trigger בשלב הבא.
  begin
    update dohefes_payment_orders
    set status = 'paid',
        verified_at = now(),
        paid_at = now(),
        cardcom_internal_deal_number = p_cardcom_internal_deal_number,
        failure_code = null
    where id = v_order.id;
  exception when unique_violation then
    -- ה-InternalDealNumber הזה כבר שייך להזמנה אחרת (unique constraint על העמודה) - נתפס כאן,
    -- לא מוחזר כשגיאת Postgres גולמית. ההזמנה הנוכחית נשארת בדיוק כפי שהייתה (rollback לשלב הזה).
    return query select 'deal_number_conflict'::text, v_order.id, v_order.report_id, v_order.product_type, null::uuid;
    return;
  end;

  -- שלב 6: יצירה/הפעלה מחדש של entitlement - report_id/product_type/payment_order_id כולם
  -- מגיעים מ-v_order (השורה שננעלה בתחילת הפונקציה), לא מפרמטר חיצוני כלשהו.
  v_entitlement_id := dohefes_upsert_active_entitlement(v_order.id, v_order.report_id, v_order.product_type);

  -- שלב 7: תוצאה כללית - מזהים בלבד, בלי שום פרט מ-Cardcom (לא Description, לא payload גולמי).
  return query select 'finalized'::text, v_order.id, v_order.report_id, v_order.product_type, v_entitlement_id;
end;
$$;

revoke execute on function dohefes_finalize_verified_payment(text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function dohefes_finalize_verified_payment(text, text, text, integer, integer) to service_role;

-- --- commit שישי (מניעת שימוש לרעה): לכל היותר הזמנה "פעילה" אחת לכל (report_id, product_type) ---
--
-- ממצא ביקורת "חובה לפני ניסיון אמיתי": בלי הגבלה כלשהי, כל בקשה עם Idempotency-Key חדש
-- (שאין עלותה - anon key פומבי מטבעו) יוצרת הזמנה חדשה + session חדש אצל Cardcom - אין מגבלה
-- על מספר ה-sessions שניתן ליצור לאותו (report, מוצר). ה-index הזה הוא ההגנה האמיתית מול race
-- (לא רק בדיקה ברמת השירות, שנשארת TOCTOU-חשופה לבדה - ר' create-payment-order/index.ts
-- ו-_shared/payment-order-service.ts ליישום המלא בצד השירות, כולל טיפול ב-race עצמו).
--
-- **partial unique index על (report_id, product_type) עבור status in ('created','pending','paid')** -
-- לא unique constraint רגיל על כל הטבלה (שהיה חוסם, בטעות, אפילו הזמנות ישנות/סופיות באותו
-- זוג דוח+מוצר). למה שלושת הסטטוסים האלה בדיוק, ולא רק created/pending:
--   - created/pending: תמיד חוסמים - אלה ניסיונות פעילים, אין סיבה לאפשר שני ניסיונות מקבילים.
--   - paid: חוסם **כל עוד ההזמנה עצמה נשארת paid** - ברגע שהזמנה paid "מתבטלת" (למשל refund
--     עתידי), status אמור לעבור ל-'refunded' (ערך קיים כבר ב-check constraint של הטבלה) - **לא**
--     להישאר 'paid' לנצח. זו **דרישה מפורשת מכל מימוש refund עתידי**: מעבר entitlement.status
--     ל-'refunded'/'revoked' בלבד, בלי לעדכן גם את payment_orders.status, ישאיר את ה-index הזה
--     חוסם רכישה חוזרת לנצח - אם וכאשר תיבנה תשתית refund, היא **חייבת** לעדכן את שני הצדדים יחד
--     (בדיוק כמו ש-dohefes_finalize_verified_payment מעדכנת order+entitlement יחד היום ל-paid).
-- failed/cancelled/refunded - **לא** בפרדיקט, ולכן לא חוסמים ניסיון חדש בכלל - זה מה שמאפשר
-- "נכשל -> נסה שוב" ו"הוחזר -> קנה שוב" בלי לגעת בשורה הישנה.
--
-- race-safety: זו לא בדיקה-ואז-כתיבה ברמת אפליקציה (חשופה ל-TOCTOU) - Postgres אוכף ייחודיות
-- ברמת ה-index עצמו בזמן ה-INSERT/UPDATE: שני INSERT מקבילים לאותו (report_id, product_type)
-- עם status חוסם - השני ממתין לראשון (נעילת index-entry מובנית), ואז נכשל עם unique_violation
-- ברגע שהראשון commit. אין חלון זמן שבו שתי שורות חוסמות "כמעט בו-זמנית" עוברות את הבדיקה גם
-- יחד - זהה למנגנון שכבר מוכח לעבוד עם cardcom_internal_deal_number ב-dohefes_finalize_verified_payment.
create unique index if not exists idx_dohefes_payment_orders_one_active_per_report_product
  on dohefes_payment_orders (report_id, product_type)
  where status in ('created', 'pending', 'paid');

-- --- Rollback (מתועד בלבד, לא מבוצע) ---
--
-- drop index if exists idx_dohefes_payment_orders_one_active_per_report_product;
-- drop function if exists dohefes_finalize_verified_payment(text, text, text, integer, integer);
-- drop function if exists dohefes_upsert_active_entitlement(uuid, uuid, text);
-- drop trigger if exists dohefes_product_entitlements_require_verified_order on dohefes_product_entitlements;
-- drop trigger if exists dohefes_product_entitlements_touch_updated_at on dohefes_product_entitlements;
-- drop trigger if exists dohefes_payment_orders_touch_updated_at on dohefes_payment_orders;
-- drop table if exists dohefes_product_entitlements;
-- drop table if exists dohefes_payment_orders;
-- drop function if exists dohefes_payment_entitlement_requires_verified_order();
-- drop function if exists dohefes_payment_touch_updated_at();
--
-- (drop index if exists, בניגוד ל-drop trigger, כן אידמפוטנטי - ניתן להריץ פעמיים בבטחה.)
--
-- בטוח לביצוע בכל שלב: אין foreign key בכיוון ההפוך (dohefes_reports לא מפנה לשתי הטבלאות
-- האלה), ואין קוד קיים (React/Edge Function) שתלוי בהן - הן לא נצרכות על ידי שום דבר עד commit
-- עתידי. הסדר למעלה (index -> RPC -> triggers -> entitlements -> orders -> functions) חשוב:
-- entitlements תלויה ב-orders דרך foreign key, שתי פונקציות ה-RPC נמחקות ראשונות כי אינן תלות
-- של אף אובייקט אחר, וכל טריגר/פונקציה אחרת נמחקת רק אחרי שמי שמשתמש בה כבר לא קיים.

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

-- --- תרחישי בדיקה ל-dohefes_finalize_verified_payment (מתועדים בלבד, אותם כללים כמו למעלה) ---
--
-- הכנה (הזמנה חדשה, created, עם cardcom_low_profile_code שכבר נקבע - כאילו create-payment-order
-- כבר יצרה session אצל Cardcom והזמנה עברה ל-pending, בדיוק כמו שה-Edge Function האמיתית עושה):
--
--   insert into dohefes_payment_orders
--     (report_id, product_type, expected_amount_agorot, currency_code, status, idempotency_key,
--      provider_order_reference, cardcom_low_profile_code, access_token_hash)
--   values ('<report-A>', 'cashFlowAnalysis', 98000, 1, 'pending', 'idem-finalize-1', 'order-ref-finalize-1',
--           'lpc-finalize-1', 'hash-finalize-1')
--   returning id;  -- שמור כ-<finalize-order-id>
--
-- הערה: מ-commit חמישי (ביקורת אבטחה) ואילך, הפונקציה מקבלת גם שלושה פרמטרים "מאומתים" -
-- p_verified_provider_order_reference/p_verified_amount_agorot/p_verified_currency_code - אלה
-- הערכים שה-Edge Function כביכול קיבלה מ-Cardcom (GetLowProfileIndicator) ומעבירה הלאה. בתרחישים
-- #8-#11 למטה הם תואמים בכוונה להזמנה עצמה ('order-ref-finalize-1'/98000/1, ר' ה"הכנה" למעלה) -
-- כדי לבודד את מה שכל תרחיש בפועל בודק (idempotency/mismatch/terminal state), לא את בדיקת ההתאמה
-- עצמה - זו נבדקת בנפרד בתרחיש #13.
--
-- 8. finalize ראשון מצליח:
--   select * from dohefes_finalize_verified_payment('lpc-finalize-1', 'deal-finalize-1', 'order-ref-finalize-1', 98000, 1);
--   -- צפוי: שורה אחת, outcome='finalized', order_id=<finalize-order-id>, entitlement_id לא null.
--   -- לוודא גם: dohefes_payment_orders.status='paid' על אותה שורה, ו-dohefes_product_entitlements
--   -- מכילה בדיוק שורה אחת עם report_id/product_type/payment_order_id תואמים.
--
-- 9. callback כפול עם אותה עסקה בדיוק -> מצליח idempotently, בלי תופעות לוואי כפולות:
--   select * from dohefes_finalize_verified_payment('lpc-finalize-1', 'deal-finalize-1', 'order-ref-finalize-1', 98000, 1);
--   -- צפוי: outcome='already_finalized', אותם order_id/report_id/product_type/entitlement_id
--   -- כמו בתרחיש #8 - לוודא ש-dohefes_product_entitlements עדיין מכילה **שורה אחת בלבד** (לא
--   -- שתיים) לאותו report_id/product_type, ו-granted_at התעדכן ל-now() החדש.
--
-- 10. callback שני עם InternalDealNumber אחר -> נכשל, ההזמנה לא משתנה:
--   select * from dohefes_finalize_verified_payment('lpc-finalize-1', 'deal-finalize-DIFFERENT', 'order-ref-finalize-1', 98000, 1);
--   -- צפוי: outcome='deal_mismatch'. לוודא: dohefes_payment_orders.cardcom_internal_deal_number
--   -- על אותה שורה **נשאר** 'deal-finalize-1' (לא השתנה ל-'deal-finalize-DIFFERENT').
--
-- 11. הזמנה במצב סופי (failed/cancelled/refunded) לא נפתחת מחדש בלי מדיניות מפורשת:
--   -- (יוצרים הזמנה נפרדת עם status='failed', cardcom_low_profile_code='lpc-finalize-failed',
--   --  provider_order_reference='order-ref-finalize-failed', expected_amount_agorot=98000, ואז:)
--   select * from dohefes_finalize_verified_payment('lpc-finalize-failed', 'deal-finalize-2', 'order-ref-finalize-failed', 98000, 1);
--   -- צפוי: outcome='terminal_state'. לוודא: status על אותה שורה נשאר 'failed', לא הפך ל-'paid'.
--
-- 12. אותו InternalDealNumber עבור **הזמנה אחרת** -> ה-unique constraint הקיים על
--     cardcom_internal_deal_number חוסם, לא מאפשר לשייך עסקת Cardcom אחת לשתי הזמנות:
--   -- (יוצרים הזמנה שנייה, נפרדת, pending, עם cardcom_low_profile_code='lpc-finalize-3',
--   --  provider_order_reference='order-ref-finalize-3', expected_amount_agorot=98000):
--   select * from dohefes_finalize_verified_payment('lpc-finalize-3', 'deal-finalize-1', 'order-ref-finalize-3', 98000, 1);
--   -- ('deal-finalize-1' כבר שייך להזמנה מתרחיש #8) -- צפוי: outcome='deal_number_conflict'.
--   -- לוודא: ההזמנה השנייה נשארת 'pending' (לא 'paid'), ואין entitlement חדשה שנוצרה עבורה.
--
-- 13. (ממצא ביקורת - הגנת-עומק חדשה) הערכים ה"מאומתים" לא תואמים לשורה עצמה -> נכשל, לפני כל
--     הסתעפות אחרת, אפילו אם ה-p_cardcom_internal_deal_number עצמו תקין לחלוטין:
--   -- (יוצרים הזמנה חדשה, pending, cardcom_low_profile_code='lpc-finalize-4',
--   --  provider_order_reference='order-ref-finalize-4', expected_amount_agorot=98000, currency_code=1):
--   select * from dohefes_finalize_verified_payment('lpc-finalize-4', 'deal-finalize-4', 'order-ref-finalize-4', 1, 1);
--   -- (הסכום המאומת שהועבר, 1 אגורה, לא תואם ל-expected_amount_agorot=98000 בהזמנה עצמה) --
--   -- צפוי: outcome='verification_mismatch'. לוודא: ההזמנה נשארת 'pending' (לא 'paid'), אין
--   -- entitlement שנוצרה. אותה תוצאה צפויה גם כש-p_verified_provider_order_reference או
--   -- p_verified_currency_code (ולא הסכום) הם אלה שלא תואמים.

-- --- תרחישי בדיקה ל-idx_dohefes_payment_orders_one_active_per_report_product (מתועדים בלבד) ---
--
-- 14. שתי הזמנות created/pending לאותו (report_id, product_type) -> ה-INSERT השני נכשל:
--   insert into dohefes_payment_orders
--     (report_id, product_type, expected_amount_agorot, currency_code, idempotency_key,
--      provider_order_reference, access_token_hash)
--   values ('<report-A>', 'cashFlowAnalysis', 98000, 1, 'idem-cap-1', 'order-ref-cap-1', 'hash-cap-1');
--   -- מצליח. עכשיו:
--   insert into dohefes_payment_orders
--     (report_id, product_type, expected_amount_agorot, currency_code, idempotency_key,
--      provider_order_reference, access_token_hash)
--   values ('<report-A>', 'cashFlowAnalysis', 98000, 1, 'idem-cap-2', 'order-ref-cap-2', 'hash-cap-2');
--   -- צפוי: EXCEPTION duplicate key value violates unique constraint
--   -- "idx_dohefes_payment_orders_one_active_per_report_product"
--
-- 15. אותה הזמנה, אחרי שעברה ל-failed -> מותר ליצור הזמנה שנייה (לא חוסמת):
--   update dohefes_payment_orders set status = 'failed', failure_code = 'test'
--   where provider_order_reference = 'order-ref-cap-1';
--   -- עכשיו ה-insert השני (מתרחיש 14, עם idem-cap-2) אמור להצליח.
--
-- 16. מוצר אחר באותו דוח, או דוח אחר באותו מוצר -> לא נחסמים (המפתח הוא הזוג המלא):
--   insert into dohefes_payment_orders
--     (report_id, product_type, expected_amount_agorot, currency_code, idempotency_key,
--      provider_order_reference, access_token_hash)
--   values ('<report-A>', 'baseReport', 98000, 1, 'idem-cap-3', 'order-ref-cap-3', 'hash-cap-3');
--   -- צפוי: מצליח, גם אם יש עדיין הזמנה חוסמת ל-('<report-A>', 'cashFlowAnalysis').
