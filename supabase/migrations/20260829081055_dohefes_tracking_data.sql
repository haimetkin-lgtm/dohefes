-- טבלה ייעודית לנתוני דוח מעקב (Commit 5a, product-catalog-implementation) - סכמה תוספתית
-- בלבד. ר' PRODUCT_CATALOG_AUDIT.md ("דוחות מעקב - אינם כלולים עוד") ל-audit העסקי המלא, ו-
-- supabase/migrations/20260829070351_dohefes_payment_tracking_reports_product_type.sql
-- ל-productType השלישי (trackingReports) שהוסף שם - המיגרציה הזו מניחה שהוא כבר קיים
-- (dohefes_payment_orders/dohefes_product_entitlements עם product_type='trackingReports').
--
-- **הסיבה שהעמודה הקיימת dohefes_reports.tracking לא משמשת יותר**: ה-RLS על dohefes_reports
-- (ר' supabase/schema.sql) פתוח **לחלוטין** ל-anon - insert with check(true), select
-- using(true), update using(true) with check(true) - על **כל הטבלה**, לא ניתן לבודד עמודה
-- יחידה ב-RLS רגיל. כל שער-הרשאה שהיה נבנה מעל React בלבד (בדיקת entitlement לפני שמציגים
-- כפתור) היה קוסמטי בלבד - כל אחד יכול לקרוא ל-Supabase REST API ישירות עם מפתח ה-anon
-- הציבורי ולעקוף את React כליל. audit מפורש בוצע ותועד לפני המיגרציה הזו (לא כאן - בדוח
-- ה-commit של סבב ה-audit) - נמצא כפגיע, נפסל במפורש כמנגנון אכיפה.
--
-- **הפתרון**: טבלה חדשה, נפרדת לגמרי, **באותו דפוס מוכח בדיוק** כמו dohefes_payment_orders/
-- dohefes_product_entitlements (ר' migrations/20260828062934_dohefes_payment_infrastructure.sql) -
-- RLS מופעל, אפס policies לאף תפקיד, גישה אך ורק דרך RPCs עם security definer שמאמתים
-- access_token_hash+entitlement לפני כל מגע בנתונים, נקראים רק דרך Edge Functions עם
-- service_role (ר' dohefes-get-tracking-data/dohefes-save-tracking-data).
--
-- **עמודת dohefes_reports.tracking הישנה לא נגעת בכלל בקובץ הזה** - לא נמחקת, לא משתנה, לא
-- מועתק ממנה מידע לטבלה החדשה (החלטה מפורשת: "אין לקוחות קיימים שדורשים migration עסקי" -
-- הדוח היחיד שקיים כרגע (נבדק read-only לפני כתיבת המיגרציה הזו) עם tracking=[] ריק - אין
-- מה להעביר). המחיקה תבוצע במיגרציית cleanup נפרדת, רק אחרי מעבר ה-UI (Commit 5b/6) ואימות
-- שאין בה מידע שצריך לשמר - **לא בקובץ הזה**.
--
-- schema.sql (dohefes_reports) עצמו: **לא שונה כלל** - שום שינוי ב-RLS שלו, שום policy חדשה,
-- שום GRANT ישיר.

-- --- dohefes_tracking_data: רשומה אחת בדיוק לכל דוח, entries הוא המערך השטוח שה-UI כותב היום ---
--
-- report_id הוא ה-primary key עצמו (לא id נפרד + unique(report_id)) - האכיפה של "רשומה אחת
-- לכל דוח" היא המפתח הראשי בעצמו, לא constraint נוסף - תואם את הסמנטיקה בפועל של העמודה
-- הישנה (מערך יחיד "חי" לכל דוח, בלי היסטוריה/גרסאות, ר' lib/tracking/types.ts - אין state
-- חלקי/"טיוטה" נפרד).
--
-- entries jsonb not null default '[]'::jsonb: מערך ריק הוא ברירת מחדל מפורשת, לא NULL - "כלי
-- ריק נשמר בצורה מפורשת ועקבית" (ר' דרישת ה-Commit) - שורה שקיימת עם entries=[] שקולה בדיוק
-- למה שהלקוח רואה לפני כל שמירה ראשונה (שורה עדיין לא קיימת בכלל - שני המצבים חוזרים כ-'active'
-- עם entries=[] מה-RPC, ר' dohefes_get_tracking_data למטה - לא נחשפת ללקוח ההבחנה בין "שורה
-- לא קיימת" ל"שורה קיימת עם מערך ריק", זה מימוש פנימי בלבד).
--
-- מבנה TrackingItem (lib/tracking/types.ts, לא הומצא כאן מחדש): { id, phase, description,
-- quantity, unitPriceNis, actualNis } - ה-check constraints למטה אוכפים רק את מה שניתן לאכוף
-- בבטחה ברמת SQL (מערך JSON תקין, לא ריק-מדי-גדול) - ולידציית המבנה המלאה של כל פריט (מפתחות
-- סגורים, מספרים סופיים) היא ב-supabase/functions/_shared/tracking-validator.ts (TypeScript,
-- ר' שם) - לא כאן, כי jsonb schema validation מלא ב-SQL טהור שביר/מסורבל מדי לתחזוקה.
create table if not exists dohefes_tracking_data (
  report_id uuid primary key references dohefes_reports(id) on delete restrict,
  entries jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- הגנת-עומק ברמת ה-DB: מבנה מינימלי (מערך, לא אובייקט/מספר/מחרוזת) + גבולות גודל, גם אם
  -- ה-Edge Function אי-פעם תבאג ותנסה לכתוב payload לא-תקין. 200_000 בתים / 1000 פריטים - אותם
  -- ערכים בדיוק כמו MAX_TRACKING_BODY_BYTES/MAX_TRACKING_ITEMS ב-tracking-validator.ts - אין
  -- דרך טכנית לשתף קבוע ממשי בין TS ל-SQL, מתועד כאן ושם במפורש כדי שלא יסטו.
  constraint dohefes_tracking_data_entries_is_array check (jsonb_typeof(entries) = 'array'),
  constraint dohefes_tracking_data_entries_not_too_large check (octet_length(entries::text) <= 200000),
  constraint dohefes_tracking_data_entries_not_too_many check (jsonb_array_length(entries) <= 1000)
);

-- הערה: dohefes_payment_touch_updated_at (מ-migrations/20260828062934_dohefes_payment_infrastructure.sql)
-- **לא** נבחרת כאן בכוונה - נוצרת פונקציה ייעודית dohefes_tracking_touch_updated_at למטה, כדי
-- לא ליצור תלות בין דומיין המעקב לדומיין התשלום (שם הפונקציה הקיימת כולל "payment" במפורש) -
-- אותה לוגיקה בדיוק, מוגדרת פעם שנייה במתכוון, לא ייבוא/שיתוף.

-- --- פונקציית trigger ייעודית לדומיין המעקב (לא dohefes_payment_touch_updated_at) ---
create or replace function dohefes_tracking_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

revoke execute on function dohefes_tracking_touch_updated_at() from public;

create trigger dohefes_tracking_data_touch_updated_at
  before update on dohefes_tracking_data
  for each row execute function dohefes_tracking_touch_updated_at();

create index if not exists idx_dohefes_tracking_data_updated_at on dohefes_tracking_data(updated_at);
-- הערה: report_id כבר מקבל אינדקס אוטומטית כ-primary key - אין צורך באינדקס נפרד עליו.

-- --- RLS: מופעלת, בכוונה בלי אף policy - זהה במדויק לדפוס dohefes_payment_orders/
-- dohefes_product_entitlements (ר' migrations/20260828062934_dohefes_payment_infrastructure.sql,
-- "RLS: מופעלת, ובכוונה בלי אף policy לאנונימי") ---
--
-- שום GRANT ישיר ל-anon/authenticated על הטבלה הזו בשום מקום בקובץ הזה - RLS מופעל בלי
-- policies כבר חוסם הכל, ה-GRANT הישיר היה מיותר וגם מטעה (מרמז שיש כוונה לפתוח גישה בעתיד
-- דרך policy, בעוד הכוונה היחידה היא Edge Functions עם service_role, שעוקף RLS מטבעו ולא
-- תלוי ב-GRANT כלשהו לתפקידי anon/authenticated).
alter table dohefes_tracking_data enable row level security;

-- --- RPC אטומי 1: קריאת נתוני מעקב, לאחר אימות token+entitlement באותה קריאה בדיוק ---
--
-- **לא** דפוס "בדוק entitlement -> קרא נתונים" כשתי פעולות נפרדות (חשוף למרוץ: revoke בין
-- שתי הפעולות). כאן שתי הבדיקות (הזמנה+entitlement) וקריאת הנתונים קורות בתוך אותה קריאת
-- פונקציה אחת - אותה טרנזקציה מרומזת, כמו dohefes_finalize_verified_payment.
--
-- **מקבלת רק hash של הטוקן, לעולם לא את הטוקן הגולמי** - ה-Edge Function מחשבת SHA-256
-- (Web Crypto, אותו pattern כמו payment-security.ts hashAccessToken) לפני הקריאה. הטוקן
-- הגולמי לעולם לא מגיע לצד ה-DB.
--
-- אימות: הזמנה עם access_token_hash תואם, report_id תואם, product_type='trackingReports'
-- **וגם** entitlement פעילה עבור אותו (report_id, 'trackingReports') - שתי הבדיקות יחד, אותה
-- הגנת-עומק כמו checkProductAccess (_shared/payment-access-service.ts) - לא מספיקה רק אחת.
--
-- outcome: 'invalid_input' (פרמטר חסר) | 'unavailable' (טוקן שגוי/דוח לא תואם/אין entitlement
-- פעילה - **אותה תגובה בדיוק** לכל המקרים האלה, לא מבחינה ביניהם) | 'active' (entries תמיד
-- מלא - '[]' אם אין שורה בטבלה עדיין, אחרת התוכן בפועל).
--
-- **עדכון (Commit 5b-fix, audit)**: מחזירה כעת גם project_name - נקרא כאן, **בתוך אותה פעולה
-- מאובטחת אחת**, מ-dohefes_reports.project_name בלבד (עמודת טקסט יחידה, לא inputs/results/
-- payment_status - "אין שדות דוח נוספים בתגובה"). זה **מחליף** קריאה אנונימית נפרדת מ-React
-- ל-dohefes_reports.project_name (שהייתה עוקפת את כל שכבת ההרשאה הזו - כל אחד עם reportId
-- תקין, גם בלי entitlement, יכול היה לקרוא אותה). כאן, project_name נחשף **רק** אחרי ששתי
-- הבדיקות (הזמנה+entitlement) כבר עברו - לא לפני, ולעולם לא ל-outcome שאינו 'active'.
-- **אין שינוי ב-RLS של dohefes_reports** - זו קריאה מבפנים הפונקציה עצמה (security definer,
-- אותה זכות שכבר יש ל-service_role/לפונקציה הזו על הטבלאות האחרות), לא גישה חדשה מבחוץ.
create or replace function dohefes_get_tracking_data(
  p_report_id uuid,
  p_access_token_hash text
)
returns table (outcome text, project_name text, entries jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order_found boolean;
  v_entitlement_found boolean;
  v_project_name text;
  v_entries jsonb;
begin
  if p_report_id is null or p_access_token_hash is null then
    return query select 'invalid_input'::text, null::text, null::jsonb;
    return;
  end if;

  select exists(
    select 1 from dohefes_payment_orders o
    where o.access_token_hash = p_access_token_hash
      and o.report_id = p_report_id
      and o.product_type = 'trackingReports'
  ) into v_order_found;

  if not v_order_found then
    return query select 'unavailable'::text, null::text, null::jsonb;
    return;
  end if;

  select exists(
    select 1 from dohefes_product_entitlements e
    where e.report_id = p_report_id
      and e.product_type = 'trackingReports'
      and e.entitlement_status = 'active'
  ) into v_entitlement_found;

  if not v_entitlement_found then
    return query select 'unavailable'::text, null::text, null::jsonb;
    return;
  end if;

  -- מגיעים לכאן רק אחרי ששתי הבדיקות עברו - project_name נחשף רק מהנקודה הזו ואילך.
  select r.project_name into v_project_name from dohefes_reports r where r.id = p_report_id;
  select d.entries into v_entries from dohefes_tracking_data d where d.report_id = p_report_id;

  return query select 'active'::text, v_project_name, coalesce(v_entries, '[]'::jsonb);
end;
$$;

revoke execute on function dohefes_get_tracking_data(uuid, text) from public, anon, authenticated;
grant execute on function dohefes_get_tracking_data(uuid, text) to service_role;

-- --- RPC אטומי 2: שמירת נתוני מעקב, אותן שתי בדיקות בדיוק, באותה פעולה אטומית ---
--
-- p_entries: כבר עברה ולידציית מבנה מלאה ב-TypeScript (tracking-validator.ts) **לפני** הקריאה
-- הזו - הבדיקה כאן (jsonb_typeof/גודל/מספר-פריטים, ר' check constraints על הטבלה) היא
-- הגנת-עומק, לא הוולידציה הראשית.
--
-- on conflict (report_id) do update: upsert יחיד - "שמירה ראשונה" ו"עדכון קיים" הם אותו נתיב
-- קוד בדיוק, לא שני מסלולים נפרדים (תואם ל-dohefes_upsert_active_entitlement, אותו עיקרון).
-- updated_at לא נכתב כאן במפורש - הטריגר dohefes_tracking_data_touch_updated_at כבר מטפל בזה
-- (גם על ON CONFLICT DO UPDATE, ר' Postgres docs - BEFORE UPDATE trigger כן יורה גם שם).
--
-- outcome: 'invalid_input' | 'invalid_payload' (jsonb_typeof(p_entries)<>'array' - לא אמור
-- לקרות בזרימה תקינה, ה-TS כבר סינן, אך מטופל כאן גם כהגנת-עומק ולא כ-exception גולמי) |
-- 'unavailable' (אותה משמעות בדיוק כמו ב-get) | 'saved'.
--
-- אם ה-INSERT ... ON CONFLICT נכשל בפועל בגלל check constraint (payload חרג מהגבולות, למרות
-- שה-TS כבר בדק) - זו EXCEPTION אמיתית שנזרקת ללקוח ה-Edge Function (לא outcome מובנה) -
-- מצב שלא אמור לקרות בזרימה תקינה, אך אם קרה, זה סימן שה-Edge Function וה-DB לא מסונכרנים
-- ("blocker נפרד", לא מוסתר בשקט).
create or replace function dohefes_save_tracking_data(
  p_report_id uuid,
  p_access_token_hash text,
  p_entries jsonb
)
returns table (outcome text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order_found boolean;
  v_entitlement_found boolean;
begin
  if p_report_id is null or p_access_token_hash is null or p_entries is null then
    return query select 'invalid_input'::text;
    return;
  end if;

  if jsonb_typeof(p_entries) <> 'array' then
    return query select 'invalid_payload'::text;
    return;
  end if;

  select exists(
    select 1 from dohefes_payment_orders o
    where o.access_token_hash = p_access_token_hash
      and o.report_id = p_report_id
      and o.product_type = 'trackingReports'
  ) into v_order_found;

  if not v_order_found then
    return query select 'unavailable'::text;
    return;
  end if;

  select exists(
    select 1 from dohefes_product_entitlements e
    where e.report_id = p_report_id
      and e.product_type = 'trackingReports'
      and e.entitlement_status = 'active'
  ) into v_entitlement_found;

  if not v_entitlement_found then
    return query select 'unavailable'::text;
    return;
  end if;

  -- report_id/entries בלבד נכתבים - שום עמודה על dohefes_reports עצמה לא נגעת כאן (אין UPDATE
  -- על dohefes_reports בקובץ הזה בכלל) - "נתוני דוח בסיס אינם ניתנים לשינוי דרך Function המעקב".
  insert into dohefes_tracking_data (report_id, entries)
  values (p_report_id, p_entries)
  on conflict (report_id) do update
    set entries = excluded.entries;

  return query select 'saved'::text;
end;
$$;

revoke execute on function dohefes_save_tracking_data(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function dohefes_save_tracking_data(uuid, text, jsonb) to service_role;

-- --- Rollback: נפרד, מחוץ ל-supabase/migrations/, אותה מוסכמה מדויקת כמו המיגרציות הקודמות ---
-- ר' supabase/migrations_rollback/20260829081055_dohefes_tracking_data_rollback.sql - מסרב
-- לרוץ אם יש כבר שורות בטבלה (לא מוחק/פוגם בשקט).

-- --- תרחישי בדיקה ידניים (מתועדים בלבד - לא מבוצעים אוטומטית, אותה מוסכמה כמו שאר הקובץ) ---
--
-- הכנה: <report-A> = uuid קיים ב-dohefes_reports. <tracking-order-id>/<hash-A> = הזמנת
-- trackingReports **משולמת ומאומתת** לאותו report_id (status='paid', verified_at/paid_at לא
-- null), עם access_token_hash='hash-A', ו-entitlement פעילה תואמת ב-dohefes_product_entitlements
-- (ר' תרחישי הבדיקה במיגרציה 20260828062934 ליצירת הזמנה+entitlement משולמת כחוק, רק עם
-- product_type='trackingReports' במקום 'cashFlowAnalysis').
--
-- 1. קריאה לפני כל שמירה -> 'active', entries='[]' (אין שורה עדיין בטבלה), project_name=שם
--    הדוח בפועל (בהנחה ש-<report-A> נוצר עם project_name='דוגמה'):
--   select * from dohefes_get_tracking_data('<report-A>', 'hash-A');
--   -- צפוי: outcome='active', project_name='דוגמה', entries='[]'::jsonb
--
-- 2. שמירה ראשונה -> 'saved', ואז קריאה חוזרת מחזירה בדיוק את מה שנשמר (וגם project_name):
--   select * from dohefes_save_tracking_data('<report-A>', 'hash-A',
--     '[{"id":"i1","phase":"ביסוס","description":"כלונסאות","quantity":10,"unitPriceNis":5000,"actualNis":3000}]'::jsonb);
--   -- צפוי: outcome='saved'.
--   select * from dohefes_get_tracking_data('<report-A>', 'hash-A');
--   -- צפוי: outcome='active', project_name='דוגמה', entries=המערך בדיוק שנשמר.
--
-- 3. עדכון (upsert) -> אותה שורה, לא שורה נוספת:
--   select * from dohefes_save_tracking_data('<report-A>', 'hash-A', '[]'::jsonb);
--   select count(*) from dohefes_tracking_data where report_id = '<report-A>';
--   -- צפוי: 1 (לא 2).
--
-- 4. hash שגוי -> 'unavailable', לא חושף אם הדוח קיים ולא חושף project_name:
--   select * from dohefes_get_tracking_data('<report-A>', 'hash-WRONG');
--   -- צפוי: outcome='unavailable', project_name=null, entries=null.
--
-- 5. hash תקין אך לדוח אחר -> 'unavailable' (התאמת report_id נבדקת יחד עם ה-hash):
--   select * from dohefes_get_tracking_data('<report-B-different>', 'hash-A');
--   -- צפוי: outcome='unavailable', project_name=null.
--
-- 6. entitlement שהוחזרה ל-revoked/refunded -> 'unavailable', גם אם ה-hash/reportId עדיין תואמים
--    (project_name לא נחשף - הבדיקה נכשלת **לפני** שמגיעים לשלב שקורא אותו):
--   update dohefes_product_entitlements set entitlement_status = 'revoked'
--   where report_id = '<report-A>' and product_type = 'trackingReports';
--   select * from dohefes_get_tracking_data('<report-A>', 'hash-A');
--   -- צפוי: outcome='unavailable', project_name=null. (ואותו דבר ל-dohefes_save_tracking_data)
--
-- 7. entitlement למוצר אחר (baseReport/cashFlowAnalysis) על אותו דוח -> לא מספיקה, 'unavailable':
--   -- (בהנחה ש-hash-A שייך רק להזמנת trackingReports - אין הזמנת trackingReports נפרדת -
--   --  entitlement של מוצר אחר לא עוברת את בדיקת ה-order כלל, כי ה-hash לא ימצא הזמנת
--   --  trackingReports תואמת מלכתחילה)
--
-- 8. payload לא-מערך -> 'invalid_payload', לא נכתב כלום:
--   select * from dohefes_save_tracking_data('<report-A>', 'hash-A', '{"not":"an array"}'::jsonb);
--   -- צפוי: outcome='invalid_payload'. הטבלה נשארת ללא שינוי.
--
-- 9. payload חורג מהגבלת הגודל/מספר-הפריטים (למשל מערך עם 1001 פריטים) -> EXCEPTION מה-check
--    constraint (לא outcome מובנה - התרחיש הזה לא אמור לקרות בזרימה תקינה, ה-TS כבר סינן):
--   -- צפוי: EXCEPTION violates check constraint "dohefes_tracking_data_entries_not_too_many"
