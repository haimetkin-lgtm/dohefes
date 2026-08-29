// בדיקות סטטיות (טקסטואליות) על קובצי המיגרציה/rollback של trackingReports - **לא** מריצות SQL
// אמיתי מול Postgres (אין סביבת בדיקה כזו זמינה כאן, ר' vitest.config.mts) - קוראות את הקבצים
// כטקסט ומוודאות שהם עומדים בדרישות שהתבקשו במפורש: תוספתי בלבד, בלי מחיקת/שינוי נתונים, בלי
// RLS/policies/הרשאות חדשות, בלי מחיר מקודד, ושה-rollback חוסם את עצמו כשקיימות שורות
// trackingReports - במקום להמציא בדיקת אינטגרציה שאין לה סביבה להריץ בה.
//
// **קובץ נפרד מתיקיית supabase/migrations/ עצמה בכוונה** (לא ...__tests__ בתוכה) - כדי
// שלא יתבלבל אי-פעם עם קובצי migration אמיתיים אם מישהו יסרוק את התיקייה ההיא בעתיד לפי סיומת
// בלבד, לא רק *.sql (היום ה-CLI סורק *.sql בלבד, ר' ההערות בקבצי המיגרציה עצמם - זו הגנת-עומק
// תיעודית, לא תלות בפועל).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = join(process.cwd(), "supabase/migrations/20260829070351_dohefes_payment_tracking_reports_product_type.sql");
const ROLLBACK_PATH = join(
  process.cwd(),
  "supabase/migrations_rollback/20260829070351_dohefes_payment_tracking_reports_product_type_rollback.sql"
);
const ORIGINAL_MIGRATION_PATH = join(process.cwd(), "supabase/migrations/20260828062934_dohefes_payment_infrastructure.sql");

const migrationSql = readFileSync(MIGRATION_PATH, "utf-8");
const rollbackSql = readFileSync(ROLLBACK_PATH, "utf-8");

describe("מיגרציית trackingReports - קובץ קיים, timestamp חדש, לא נוגע במיגרציה המקורית", () => {
  it("קובץ המיגרציה קיים ולא ריק", () => {
    expect(migrationSql.length).toBeGreaterThan(0);
  });

  it("המיגרציה המקורית (20260828062934) לא שונתה - עדיין מכילה רק baseReport/cashFlowAnalysis ב-check המקורי", () => {
    const originalSql = readFileSync(ORIGINAL_MIGRATION_PATH, "utf-8");
    expect(originalSql).toContain("check (product_type in ('baseReport', 'cashFlowAnalysis'))");
    expect(originalSql).not.toContain("trackingReports");
  });
});

describe("מיגרציית trackingReports - תוספתית וממוקדת בלבד", () => {
  it("מרחיבה את שני ה-check constraints לכלול trackingReports, בכל שלושת המוצרים", () => {
    expect(migrationSql).toContain(
      "check (product_type in ('baseReport', 'cashFlowAnalysis', 'trackingReports'))"
    );
    const occurrences = migrationSql.split("check (product_type in ('baseReport', 'cashFlowAnalysis', 'trackingReports'))").length - 1;
    expect(occurrences).toBe(2); // dohefes_payment_orders + dohefes_product_entitlements
  });

  it("נוגעת רק בשתי טבלאות התשלום - dohefes_reports לא מוזכרת בשום alter/update/insert/delete", () => {
    const mutatingReportsStatements = migrationSql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .filter((line) => /\bdohefes_reports\b/.test(line));
    expect(mutatingReportsStatements).toEqual([]);
  });

  it("אין מחיקת/עדכון נתונים קיימים - שום DELETE/UPDATE/TRUNCATE מחוץ להערות", () => {
    const activeLines = migrationSql
      .split("\n")
      .map((line) => line.split("--")[0]) // מסיר הערות trailing, לא רק שורות מלאות
      .join("\n")
      .toLowerCase();
    expect(activeLines).not.toMatch(/\bdelete\s+from\b/);
    expect(activeLines).not.toMatch(/\bupdate\s+dohefes_/);
    expect(activeLines).not.toMatch(/\btruncate\b/);
    expect(activeLines).not.toMatch(/\bdrop\s+table\b/);
  });

  it("אין RLS/policy/הרשאות חדשות - לא alter...enable row level security, לא create/alter policy, לא grant/revoke", () => {
    const activeLines = migrationSql
      .split("\n")
      .map((line) => line.split("--")[0])
      .join("\n")
      .toLowerCase();
    expect(activeLines).not.toMatch(/row level security/);
    expect(activeLines).not.toMatch(/\bcreate\s+policy\b/);
    expect(activeLines).not.toMatch(/\balter\s+policy\b/);
    expect(activeLines).not.toMatch(/\bgrant\b/);
    expect(activeLines).not.toMatch(/\brevoke\b/);
  });

  it("אין מחיר מקודד ב-SQL פעיל (98000/expected_amount_agorot מופיעים רק בתוך תרחישי בדיקה מתועדים בהערות)", () => {
    const activeLines = migrationSql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(activeLines).not.toMatch(/98[,_]?000/);
    expect(activeLines).not.toMatch(/expected_amount_agorot/);
  });

  it("משתמשת בגילוי דינמי של שם ה-constraint (pg_constraint/conkey), לא בניחוש שם קבוע ב-DROP", () => {
    expect(migrationSql).toContain("pg_constraint");
    expect(migrationSql).toContain("conkey");
    expect(migrationSql).not.toMatch(/drop constraint if exists dohefes_payment_orders_product_type_check/);
  });
});

describe("rollback - חוסם את עצמו אם קיימות שורות trackingReports, לא מוחק/פוגם בשקט", () => {
  it("קובץ ה-rollback קיים ולא ריק", () => {
    expect(rollbackSql.length).toBeGreaterThan(0);
  });

  it("בודק ספירת שורות trackingReports בשתי הטבלאות לפני שממשיך", () => {
    expect(rollbackSql).toMatch(/count\(\*\).*dohefes_payment_orders.*trackingReports/s);
    expect(rollbackSql).toMatch(/count\(\*\).*dohefes_product_entitlements.*trackingReports/s);
  });

  it("זורק raise exception אם נמצאו שורות - לא ממשיך בשקט", () => {
    expect(rollbackSql.toLowerCase()).toMatch(/raise exception/);
  });

  it("אין שום DELETE/UPDATE שמוחק או פוגם שורות trackingReports - הגנה מפורשת מפני 'תיקון' שקט", () => {
    const activeLines = rollbackSql
      .split("\n")
      .map((line) => line.split("--")[0])
      .join("\n")
      .toLowerCase();
    expect(activeLines).not.toMatch(/\bdelete\s+from\b/);
    expect(activeLines).not.toMatch(/\bupdate\s+dohefes_/);
  });

  it("משחזרת את ה-check המקורי (בלי trackingReports) רק אחרי בדיקת הספירה - לא לפניה", () => {
    const guardIndex = rollbackSql.search(/raise exception/i);
    const restoreIndex = rollbackSql.indexOf("check (product_type in ('baseReport', 'cashFlowAnalysis'))");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(restoreIndex).toBeGreaterThan(-1);
    expect(restoreIndex).toBeGreaterThan(guardIndex);
  });

  it("לא מכילה 'trackingReports' ברשימת הערכים המשוחזרת - הרולבק מחזיר בדיוק לשני המוצרים המקוריים", () => {
    expect(rollbackSql).toContain("check (product_type in ('baseReport', 'cashFlowAnalysis'))");
    expect(rollbackSql).not.toContain("check (product_type in ('baseReport', 'cashFlowAnalysis', 'trackingReports'))");
  });
});
