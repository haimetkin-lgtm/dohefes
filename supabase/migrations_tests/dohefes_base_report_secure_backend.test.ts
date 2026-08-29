// בדיקות סטטיות (טקסטואליות בלבד, לא SQL אמיתי) על קובצי migration/rollback של
// dohefes_base_report_secure_backend - אותו דפוס בדיוק כמו
// supabase/migrations_tests/dohefes_tracking_data.test.ts (Commit 5a). "21. RPC permissions/
// RLS/rollback נבדקים סטטית" - אין סביבת Postgres זמינה כאן (ר' vitest.config.mts), אז הבדיקה
// היא על **מבנה הטקסט** של ה-SQL עצמו.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = join(process.cwd(), "supabase/migrations/20260829151144_dohefes_base_report_secure_backend.sql");
const ROLLBACK_PATH = join(process.cwd(), "supabase/migrations_rollback/20260829151144_dohefes_base_report_secure_backend_rollback.sql");

const migrationSql = readFileSync(MIGRATION_PATH, "utf-8");
const rollbackSql = readFileSync(ROLLBACK_PATH, "utf-8");

/** שורות "חיות" בלבד - מסיר הערות trailing (אחרי --) וגם שורות שהן הערה מלאה - כדי שבדיקות
 *  "אין X" לא ייכשלו/יעברו בטעות בגלל אזכור X בתוך תיעוד. */
function activeSql(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.split("--")[0])
    .join("\n");
}

describe("קבצי migration/rollback קיימים ולא ריקים", () => {
  it("קובץ המיגרציה קיים ולא ריק", () => {
    expect(migrationSql.length).toBeGreaterThan(0);
  });

  it("קובץ ה-rollback קיים ולא ריק", () => {
    expect(rollbackSql.length).toBeGreaterThan(0);
  });
});

describe("21. אין שינוי סכמה - לא נוצרת טבלה חדשה, לא ALTER על dohefes_reports", () => {
  it("אין 'create table' בקובץ המיגרציה", () => {
    expect(activeSql(migrationSql).toLowerCase()).not.toMatch(/create table/);
  });

  it("אין 'alter table' בקובץ המיגרציה (כולל לא על dohefes_reports)", () => {
    expect(activeSql(migrationSql).toLowerCase()).not.toMatch(/alter table/);
  });

  it("אין 'create policy'/'grant ... to anon'/'grant ... to authenticated' בקובץ", () => {
    const active = activeSql(migrationSql).toLowerCase();
    expect(active).not.toMatch(/create policy/);
    expect(active).not.toMatch(/grant\s+.*\s+to\s+anon/);
    expect(active).not.toMatch(/grant\s+.*\s+to\s+authenticated/);
  });
});

describe("21. שלושת ה-RPCs - security definer, search_path קבוע, EXECUTE ל-service_role בלבד", () => {
  it("שלושת ה-RPCs קיימים", () => {
    expect(migrationSql).toMatch(/create or replace function dohefes_create_base_report_payment_order/);
    expect(migrationSql).toMatch(/create or replace function dohefes_get_report_data/);
    expect(migrationSql).toMatch(/create or replace function dohefes_save_report_data/);
  });

  it("שלושתם security definer עם search_path קבוע (pg_catalog, public)", () => {
    const definerCount = (migrationSql.match(/security definer/g) || []).length;
    expect(definerCount).toBeGreaterThanOrEqual(3);
    const searchPathCount = (migrationSql.match(/set search_path = pg_catalog, public/g) || []).length;
    expect(searchPathCount).toBeGreaterThanOrEqual(3);
  });

  it("שלושתם: revoke מ-public/anon/authenticated וגם grant ל-service_role בלבד", () => {
    expect(migrationSql).toMatch(
      /revoke execute on function dohefes_create_base_report_payment_order\(text, text, integer, integer, text, text\) from public, anon, authenticated/
    );
    expect(migrationSql).toMatch(
      /grant execute on function dohefes_create_base_report_payment_order\(text, text, integer, integer, text, text\) to service_role/
    );
    expect(migrationSql).toMatch(/revoke execute on function dohefes_get_report_data\(uuid, text\) from public, anon, authenticated/);
    expect(migrationSql).toMatch(/grant execute on function dohefes_get_report_data\(uuid, text\) to service_role/);
    expect(migrationSql).toMatch(
      /revoke execute on function dohefes_save_report_data\(uuid, text, text, text, jsonb, jsonb\) from public, anon, authenticated/
    );
    expect(migrationSql).toMatch(/grant execute on function dohefes_save_report_data\(uuid, text, text, text, jsonb, jsonb\) to service_role/);
  });

  it("get/save מקבלות p_access_token_hash (טקסט), לא p_access_token גולמי - שם הפרמטר מרמז hash בלבד", () => {
    expect(migrationSql).toMatch(/p_access_token_hash text/);
    expect(migrationSql).not.toMatch(/p_access_token\b(?!_hash)/);
  });

  it("get/save בודקים גם product_type='baseReport' וגם entitlement_status='active' - שתי בדיקות, לא רק אחת", () => {
    const productTypeOccurrences = (migrationSql.match(/product_type = 'baseReport'/g) || []).length;
    expect(productTypeOccurrences).toBeGreaterThanOrEqual(4); // 2 בדיקות (order+entitlement) X 2 פונקציות
    const entitlementActiveOccurrences = (migrationSql.match(/entitlement_status = 'active'/g) || []).length;
    expect(entitlementActiveOccurrences).toBeGreaterThanOrEqual(2);
  });
});

describe("21. dohefes_create_base_report_payment_order - draft+order אטומיים, ללא dynamic SQL", () => {
  it("שני INSERT (dohefes_reports ואז dohefes_payment_orders) בתוך אותו בלוק begin...exception...end", () => {
    const active = activeSql(migrationSql);
    const functionBody = active.split("create or replace function dohefes_create_base_report_payment_order")[1]?.split("$$;")[0] ?? "";
    expect(functionBody).toMatch(/insert into dohefes_reports/);
    expect(functionBody).toMatch(/insert into dohefes_payment_orders/);
    expect(functionBody).toMatch(/exception when unique_violation/);
    // שני ה-INSERTs מופיעים **לפני** ה-exception (אותו בלוק), לא בבלוקים נפרדים.
    const insertReportsIndex = functionBody.indexOf("insert into dohefes_reports");
    const insertOrdersIndex = functionBody.indexOf("insert into dohefes_payment_orders");
    const exceptionIndex = functionBody.indexOf("exception when unique_violation");
    expect(insertReportsIndex).toBeGreaterThan(-1);
    expect(insertOrdersIndex).toBeGreaterThan(insertReportsIndex);
    expect(exceptionIndex).toBeGreaterThan(insertOrdersIndex);
  });

  it("payment_status נכתב כ-'pending' בלבד ביצירת draft, לעולם לא 'paid'", () => {
    const functionBody =
      activeSql(migrationSql).split("create or replace function dohefes_create_base_report_payment_order")[1]?.split("$$;")[0] ?? "";
    expect(functionBody).toMatch(/payment_status\)\s*\n?\s*values \(null, p_deal_type, '\{\}'::jsonb, null, 'pending'\)/);
    expect(functionBody.toLowerCase()).not.toMatch(/'paid'/);
  });

  it("אין EXECUTE של מחרוזת (dynamic SQL) בקובץ כולו", () => {
    expect(activeSql(migrationSql).toLowerCase()).not.toMatch(/execute\s+['"$]/);
  });

  it("dealType מאומת מול רשימה קשיחה של שבעת הערכים - מופיעה בשתי הפונקציות (create + save)", () => {
    const occurrences = (
      migrationSql.match(/'tama38', 'basic', 'kombinatsia', 'pinuyBinui', 'kombinatsiaTemurot', 'purchaseGroup', 'mixedUse'/g) || []
    ).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});

describe("save - אינה יכולה לשנות id/payment_status/tracking/created_at", () => {
  it("ה-UPDATE היחיד ב-dohefes_save_report_data קובע רק project_name/deal_type/inputs/results", () => {
    const active = activeSql(migrationSql);
    const functionBody = active.split("create or replace function dohefes_save_report_data")[1]?.split("$$;")[0] ?? "";
    const updateBlock = functionBody.match(/update dohefes_reports\s+set([\s\S]*?)where id = p_report_id;/);
    expect(updateBlock).not.toBeNull();
    const setClause = updateBlock ? updateBlock[1] : "";
    expect(setClause).toMatch(/project_name = p_project_name/);
    expect(setClause).toMatch(/deal_type = p_deal_type/);
    expect(setClause).toMatch(/inputs = p_inputs/);
    expect(setClause).toMatch(/results = p_results/);
    expect(setClause).not.toMatch(/payment_status/);
    expect(setClause).not.toMatch(/\btracking\b/);
    expect(setClause).not.toMatch(/created_at/);
    expect(setClause).not.toMatch(/\bid\s*=/);
  });

  it("dohefes_save_report_data אינה כוללת פרמטר p_id/p_payment_status/p_tracking/p_created_at בחתימה", () => {
    const active = activeSql(migrationSql);
    const signature = active.split("create or replace function dohefes_save_report_data")[1]?.split(")")[0] ?? "";
    expect(signature).not.toMatch(/p_payment_status/);
    expect(signature).not.toMatch(/p_tracking/);
    expect(signature).not.toMatch(/p_created_at/);
    expect(signature).not.toMatch(/p_id\b/);
  });
});

describe("get - אינה מחזירה payment_status/token/hash/order data", () => {
  it("RETURNS TABLE של dohefes_get_report_data כולל רק outcome/report_id/project_name/deal_type/inputs/results", () => {
    const active = activeSql(migrationSql);
    const afterFunctionName = active.split("create or replace function dohefes_get_report_data")[1] ?? "";
    // מבודד רק את גוף ה-`returns table (...)` עצמו - **לא** את רשימת הפרמטרים שלפניו (שכוללת
    // p_access_token_hash, שמכיל את המחרוזת "token" - היה גורם לכשל-בדיקה שווא על שורה שלא
    // אמורה להיבדק בכלל כאן).
    const returnsBlock = afterFunctionName.split("returns table (")[1]?.split(")\nlanguage")[0] ?? "";
    expect(returnsBlock).toMatch(/report_id uuid/);
    expect(returnsBlock).toMatch(/project_name text/);
    expect(returnsBlock).toMatch(/deal_type text/);
    expect(returnsBlock).toMatch(/inputs jsonb/);
    expect(returnsBlock).toMatch(/results jsonb/);
    expect(returnsBlock).not.toMatch(/payment_status/);
    expect(returnsBlock).not.toMatch(/token/);
    expect(returnsBlock).not.toMatch(/\bhash\b/);
  });
});

describe("21. Rollback - מסרב לרוץ כשיש orders/entitlements/drafts, לא מוחק בשקט", () => {
  it("בודק count על dohefes_payment_orders/dohefes_product_entitlements עם product_type='baseReport' לפני כל DROP", () => {
    expect(rollbackSql).toMatch(/select count\(\*\) into v_orders_count from dohefes_payment_orders where product_type = 'baseReport'/);
    expect(rollbackSql).toMatch(
      /select count\(\*\) into v_entitlements_count from dohefes_product_entitlements where product_type = 'baseReport'/
    );
  });

  it("raise exception כש-count>0, לפני שורת ה-DROP הראשונה בקובץ", () => {
    const raiseIndex = rollbackSql.indexOf("raise exception");
    const firstDropIndex = rollbackSql.indexOf("drop function");
    expect(raiseIndex).toBeGreaterThan(-1);
    expect(firstDropIndex).toBeGreaterThan(raiseIndex);
  });

  it("מסיר את שלושת ה-RPCs עם IF EXISTS, לא נוגע בטבלאות dohefes_reports/dohefes_payment_orders/dohefes_product_entitlements", () => {
    expect(rollbackSql).toMatch(/drop function if exists dohefes_save_report_data\(uuid, text, text, text, jsonb, jsonb\)/);
    expect(rollbackSql).toMatch(/drop function if exists dohefes_get_report_data\(uuid, text\)/);
    expect(rollbackSql).toMatch(
      /drop function if exists dohefes_create_base_report_payment_order\(text, text, integer, integer, text, text\)/
    );
    expect(activeSql(rollbackSql).toLowerCase()).not.toMatch(/drop table/);
  });
});

describe("אין נגיעה ב-RLS/policies הפתוחות של dohefes_reports", () => {
  it("שום 'alter table dohefes_reports' בקובץ המיגרציה או ה-rollback", () => {
    expect(activeSql(migrationSql).toLowerCase()).not.toMatch(/alter table dohefes_reports/);
    expect(activeSql(rollbackSql).toLowerCase()).not.toMatch(/alter table dohefes_reports/);
  });
});
