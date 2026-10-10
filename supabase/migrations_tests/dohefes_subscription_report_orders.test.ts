// בדיקות סטטיות (טקסטואליות) על מיגרציית פתיחת דוח מתוך מנוי. לא מריצות SQL. התרחישים עצמם (מכסה, ניסיון חוזר,
// בידוד אסימונים, אילוצים, הרשאות) נבדקו מול המסד החי בטרנזקציה שנגללה לאחור, ר' דוח שלב 2.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/20261013000200_dohefes_subscription_report_orders.sql"), "utf-8");
const rollback = readFileSync(
  join(process.cwd(), "supabase/migrations_rollback/20261013000200_dohefes_subscription_report_orders_rollback.sql"),
  "utf-8"
);
const code = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
const migrationCode = code(migration);

describe("מיגרציית הזמנות מנוי, הגנות לפני שינוי אילוצים", () => {
  it("סופרת בדיוק אילוץ אחד על סכום ההזמנה ומשווה את ההגדרה לפני כל DROP", () => {
    expect(migrationCode).toContain("v_amount_count <> 1");
    expect(migrationCode).toContain("v_amount_def <> v_amount_expected");
    expect(migrationCode).toContain("v_evidence_def <> v_evidence_expected");
    expect(migrationCode.indexOf("v_evidence_def <> v_evidence_expected")).toBeLessThan(migrationCode.indexOf("drop constraint"));
    expect(migrationCode.indexOf("v_amount_def <> v_amount_expected")).toBeLessThan(migrationCode.indexOf("drop constraint"));
  });

  it("הזמנת קארדקום ממשיכה לדרוש את כל ההוכחה, והזמנת מנוי דורשת subscription_id", () => {
    expect(migrationCode).toContain(
      "(payment_source = 'cardcom' and cardcom_low_profile_code is not null and cardcom_internal_deal_number is not null)"
    );
    expect(migrationCode).toContain("(payment_source = 'subscription' and subscription_id is not null)");
  });

  it("סכום אפס מותר רק להזמנת מנוי", () => {
    expect(migrationCode).toContain(
      "check (expected_amount_agorot > 0 or (payment_source = 'subscription' and expected_amount_agorot = 0))"
    );
  });

  it("הזמנת מנוי לא נושאת שדות קארדקום, והמקור מקושר ל-subscription_id", () => {
    expect(migrationCode).toContain("cardcom_low_profile_code is null and cardcom_internal_deal_number is null and checkout_url is null");
    expect(migrationCode).toContain("check ((payment_source = 'subscription') = (subscription_id is not null))");
  });

  it("לא יוצרת foreign key לטבלת המנויים של ריפו אחר, ולא נוגעת ב-RLS, policies או הרשאות טבלה", () => {
    expect(migrationCode).not.toMatch(/references\s+(public\.)?decision_subscriptions/i);
    expect(migrationCode).not.toMatch(/enable row level security|create policy|drop policy|grant\s+(select|insert|update|delete|all)/i);
  });
});

describe("הפונקציה dohefes_open_report_from_subscription", () => {
  it("security definer עם search_path קבוע, ורק service_role יכול להריץ", () => {
    expect(migrationCode).toContain("security definer");
    expect(migrationCode).toContain("set search_path = pg_catalog, public");
    expect(migrationCode).toContain(
      "revoke execute on function dohefes_open_report_from_subscription(uuid, text, text, text, text) from public, anon, authenticated;"
    );
    expect(migrationCode).toContain(
      "grant execute on function dohefes_open_report_from_subscription(uuid, text, text, text, text) to service_role;"
    );
  });

  it("מנצלת מכסה ויוצרת דוח והרשאות באותו בלוק, כך שכשל מחזיר גם את המכסה", () => {
    const block = migrationCode.slice(migrationCode.indexOf("v_consume := public.subscription_consume_check"));
    expect(block.indexOf("subscription_consume_check")).toBeLessThan(block.indexOf("insert into dohefes_reports"));
    expect(block.indexOf("insert into dohefes_reports")).toBeLessThan(block.indexOf("exception when unique_violation"));
    expect(block).toContain("get stacked diagnostics v_constraint_name = constraint_name");
    expect(block).toContain("'dohefes_payment_orders_idempotency_key_key'");
    expect(block).toContain("raise;");
  });

  it("מפתח ה-idempotency מקבל מרחב שמות לפי משתמש", () => {
    expect(migrationCode).toContain("v_key := 'sub:' || p_user_id::text || ':' || p_idempotency_key");
  });

  it("מקבלת רק hash של אסימונים, ולא שומרת אסימון גולמי", () => {
    expect(migrationCode).toContain("p_base_token_hash text");
    expect(migrationCode).toContain("p_tracking_token_hash text");
    expect(migrationCode).not.toMatch(/p_(base|tracking)_token\s+text/);
  });
});

describe("rollback", () => {
  it("נעצר אם קיימות הזמנות מנוי, ומחזיר את האילוצים המקוריים", () => {
    const rollbackCode = code(rollback);
    expect(rollbackCode).toContain("payment_source = 'subscription'");
    expect(rollbackCode).toContain("refusing to roll back");
    expect(rollbackCode).toContain("check (expected_amount_agorot > 0)");
    expect(rollbackCode).toContain("drop column if exists payment_source");
  });
});
