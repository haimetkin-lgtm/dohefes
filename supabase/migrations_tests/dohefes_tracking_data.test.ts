// בדיקות סטטיות (טקסטואליות בלבד, לא SQL אמיתי) על קובצי migration/rollback של
// dohefes_tracking_data - אותו דפוס בדיוק כמו
// supabase/migrations_tests/dohefes_payment_tracking_reports_product_type.test.ts (Commit 2).
// "17. RPCs ו-RLS נבדקים סטטית" - אין סביבת Postgres זמינה כאן (ר. vitest.config.mts), אז
// הבדיקה היא על **מבנה הטקסט** של ה-SQL עצמו: RLS מופעל בלי אף policy, revoke/grant נכונים,
// אין GRANT ישיר לתפקידי לקוח, ואין נגיעה ב-dohefes_reports.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = join(process.cwd(), "supabase/migrations/20260829081055_dohefes_tracking_data.sql");
const ROLLBACK_PATH = join(process.cwd(), "supabase/migrations_rollback/20260829081055_dohefes_tracking_data_rollback.sql");

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

describe("מיגרציית dohefes_tracking_data - קובץ קיים, לא נוגע במיגרציות הקודמות", () => {
  it("קובץ המיגרציה קיים ולא ריק", () => {
    expect(migrationSql.length).toBeGreaterThan(0);
  });

  it("קובץ ה-rollback קיים ולא ריק", () => {
    expect(rollbackSql.length).toBeGreaterThan(0);
  });
});

describe("17. RLS - מופעל, אפס policies, אפס GRANT ישיר ל-anon/authenticated", () => {
  it("alter table dohefes_tracking_data enable row level security קיים", () => {
    expect(activeSql(migrationSql)).toMatch(/alter table dohefes_tracking_data enable row level security/);
  });

  it("אין אף create policy על dohefes_tracking_data (deny-all אמיתי)", () => {
    expect(activeSql(migrationSql).toLowerCase()).not.toMatch(/create policy/);
  });

  it("אין GRANT ישיר לטבלה עצמה ל-anon/authenticated (רק EXECUTE על ה-RPCs ל-service_role)", () => {
    const active = activeSql(migrationSql).toLowerCase();
    expect(active).not.toMatch(/grant\s+(select|insert|update|delete)\s+on\s+dohefes_tracking_data/);
    expect(active).not.toMatch(/grant\s+.*\s+to\s+anon/);
    expect(active).not.toMatch(/grant\s+.*\s+to\s+authenticated/);
  });
});

describe("17. RPCs - security definer, search_path קבוע, EXECUTE ל-service_role בלבד", () => {
  it("dohefes_get_tracking_data ו-dohefes_save_tracking_data קיימים כ-security definer עם search_path קבוע", () => {
    expect(migrationSql).toMatch(/create or replace function dohefes_get_tracking_data/);
    expect(migrationSql).toMatch(/create or replace function dohefes_save_tracking_data/);
    const definerCount = (migrationSql.match(/security definer/g) || []).length;
    expect(definerCount).toBeGreaterThanOrEqual(2);
    const searchPathCount = (migrationSql.match(/set search_path = pg_catalog, public/g) || []).length;
    expect(searchPathCount).toBeGreaterThanOrEqual(2);
  });

  it("שני ה-RPCs: revoke מ-public/anon/authenticated וגם grant ל-service_role בלבד", () => {
    expect(migrationSql).toMatch(/revoke execute on function dohefes_get_tracking_data\(uuid, text\) from public, anon, authenticated/);
    expect(migrationSql).toMatch(/grant execute on function dohefes_get_tracking_data\(uuid, text\) to service_role/);
    expect(migrationSql).toMatch(/revoke execute on function dohefes_save_tracking_data\(uuid, text, jsonb\) from public, anon, authenticated/);
    expect(migrationSql).toMatch(/grant execute on function dohefes_save_tracking_data\(uuid, text, jsonb\) to service_role/);
  });

  it("dohefes_save_tracking_data מקבלת p_access_token_hash (טקסט), לא p_access_token גולמי - שם הפרמטר מרמז hash בלבד", () => {
    expect(migrationSql).toMatch(/p_access_token_hash text/);
    expect(migrationSql).not.toMatch(/p_access_token\b(?!_hash)/); // אין פרמטר בשם access token גולמי בלי סיומת _hash
  });

  it("שני ה-RPCs בודקים גם product_type='trackingReports' וגם entitlement_status='active' - שתי בדיקות, לא רק אחת", () => {
    const occurrences = (migrationSql.match(/product_type = 'trackingReports'/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(4); // 2 בדיקות (order+entitlement) X 2 פונקציות
    const entitlementActiveOccurrences = (migrationSql.match(/entitlement_status = 'active'/g) || []).length;
    expect(entitlementActiveOccurrences).toBeGreaterThanOrEqual(2);
  });
});

describe("19. אין שינוי ב-dohefes_reports.tracking / RLS של dohefes_reports", () => {
  it("dohefes_reports מוזכרת רק בשתי שורות צפויות: ה-FK, וקריאת project_name בתוך dohefes_get_tracking_data (Commit 5b-fix) - שום שורה נוספת", () => {
    const linesTouchingReports = activeSql(migrationSql)
      .split("\n")
      .filter((line) => /\bdohefes_reports\b/.test(line));
    expect(linesTouchingReports.length).toBe(2);
    expect(linesTouchingReports.some((l) => l.includes("references dohefes_reports(id)"))).toBe(true);
    expect(linesTouchingReports.some((l) => /select r\.project_name into v_project_name from dohefes_reports r/.test(l))).toBe(true);
  });

  it("שום ALTER TABLE dohefes_reports / UPDATE dohefes_reports בקובץ - הקריאה החדשה היא SELECT בלבד", () => {
    const active = activeSql(migrationSql).toLowerCase();
    expect(active).not.toMatch(/alter table dohefes_reports/);
    expect(active).not.toMatch(/update dohefes_reports/);
  });

  it("הקריאה היחידה מ-dohefes_reports בוחרת project_name בלבד - לא inputs/results/payment_status/tracking", () => {
    const line = activeSql(migrationSql)
      .split("\n")
      .find((l) => /from dohefes_reports r/.test(l));
    expect(line).toBeDefined();
    expect(line).toMatch(/select r\.project_name/);
    for (const forbiddenField of ["inputs", "results", "payment_status", "tracking", "deal_type"]) {
      expect(line).not.toContain(forbiddenField);
    }
  });

  it("אין שום אזכור לעמודת tracking הישנה (dohefes_reports.tracking) - אין העתקת נתונים ישנים בשלב הזה", () => {
    expect(activeSql(migrationSql).toLowerCase()).not.toMatch(/\.tracking\b/);
  });

  it("rollback גם הוא לא נוגע ב-dohefes_reports בשום צורה", () => {
    const activeLinesTouchingReports = activeSql(rollbackSql)
      .split("\n")
      .filter((line) => /\bdohefes_reports\b/.test(line));
    expect(activeLinesTouchingReports).toEqual([]);
  });
});

describe("3/4/5. project_name נחשף רק עם entitlement פעילה, בלי שדות דוח נוספים", () => {
  it("returns table של dohefes_get_tracking_data הוא (outcome, project_name, entries) בדיוק - שום עמודה נוספת", () => {
    expect(migrationSql).toContain("returns table (outcome text, project_name text, entries jsonb)");
  });

  it("שני ה-early-return (order/entitlement לא נמצאו) מחזירים project_name=null::text במפורש - לא ערך אמיתי", () => {
    const earlyReturns = migrationSql.match(/return query select 'unavailable'::text, null::text, null::jsonb;/g) || [];
    expect(earlyReturns.length).toBe(2); // v_order_found כשלא נמצא, v_entitlement_found כשלא נמצא
  });

  it("invalid_input גם הוא לא חושף project_name", () => {
    expect(migrationSql).toContain("return query select 'invalid_input'::text, null::text, null::jsonb;");
  });

  it("קריאת project_name (SELECT מ-dohefes_reports) מופיעה **אחרי** שני בדיקות ה-not-found בקובץ - לא לפני", () => {
    const orderCheckIndex = migrationSql.indexOf("if not v_order_found then");
    const entitlementCheckIndex = migrationSql.indexOf("if not v_entitlement_found then");
    const projectNameSelectIndex = migrationSql.indexOf("select r.project_name into v_project_name");
    expect(orderCheckIndex).toBeGreaterThan(-1);
    expect(entitlementCheckIndex).toBeGreaterThan(-1);
    expect(projectNameSelectIndex).toBeGreaterThan(entitlementCheckIndex);
    expect(projectNameSelectIndex).toBeGreaterThan(orderCheckIndex);
  });

  it("התוצאה המוצלחת (outcome='active') מחזירה v_project_name, לא ערך קבוע/מומצא", () => {
    expect(migrationSql).toContain("return query select 'active'::text, v_project_name, coalesce(v_entries, '[]'::jsonb);");
  });
});

describe("18. rollback מסרב למחוק טבלה עם נתונים - לא מוחק בשקט", () => {
  it("בודק count(*) מ-dohefes_tracking_data לפני שממשיך", () => {
    expect(rollbackSql).toMatch(/count\(\*\).*from dohefes_tracking_data/s);
  });

  it("זורק raise exception אם נמצאו שורות", () => {
    expect(rollbackSql.toLowerCase()).toMatch(/raise exception/);
  });

  it("אין DELETE/TRUNCATE על dohefes_tracking_data בשום מקום - רק DROP TABLE, ורק אחרי הבדיקה", () => {
    const active = activeSql(rollbackSql).toLowerCase();
    expect(active).not.toMatch(/delete\s+from\s+dohefes_tracking_data/);
    expect(active).not.toMatch(/truncate/);
  });

  it("drop table מגיע אחרי ה-raise exception guard בקובץ (סדר נכון - לא DROP לפני הבדיקה)", () => {
    const guardIndex = rollbackSql.search(/raise exception/i);
    const dropIndex = rollbackSql.search(/drop table if exists dohefes_tracking_data/i);
    expect(guardIndex).toBeGreaterThan(-1);
    expect(dropIndex).toBeGreaterThan(-1);
    expect(dropIndex).toBeGreaterThan(guardIndex);
  });
});

describe("אין מחיר/סכום מקודד ב-SQL - אין שדה כספי בטבלה הזו בכלל", () => {
  it("אין 98000/98_000/expected_amount_agorot בקובץ המיגרציה", () => {
    const active = activeSql(migrationSql);
    expect(active).not.toMatch(/98[,_]?000/);
    expect(active).not.toMatch(/expected_amount_agorot/);
  });
});

describe("גבולות גודל - עקביים בין check constraints ל-tracking-validator.ts", () => {
  it("200000 בתים ו-1000 פריטים מופיעים כ-check constraints, זהים לקבועים ב-TS", () => {
    expect(migrationSql).toContain("octet_length(entries::text) <= 200000");
    expect(migrationSql).toContain("jsonb_array_length(entries) <= 1000");
  });
});
