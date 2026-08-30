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

describe("הגנת אימות לפני הסרה - בדיוק constraint אחד, בהגדרה הצפויה, לפני כל שינוי", () => {
  it("סופרת כמה check constraints חד-עמודיים תואמים נמצאו בכל טבלה, ומסרבת (raise exception) אם הכמות אינה בדיוק 1", () => {
    const countOccurrences = (migrationSql.match(/select count\(\*\) into v_matching_count/g) || []).length;
    expect(countOccurrences).toBe(2); // dohefes_payment_orders + dohefes_product_entitlements
    const refusalOccurrences = (migrationSql.match(/if v_matching_count <> 1 then/g) || []).length;
    expect(refusalOccurrences).toBe(2);
    expect(migrationSql).toMatch(/raise exception[\s\S]{0,300}found %/);
  });

  it("משווה את ההגדרה בפועל (pg_get_constraintdef) מול מחרוזת קבועה ומתועדת, לא מנחשת/מפרסרת חלקית", () => {
    expect(migrationSql).toContain("pg_get_constraintdef(oid)");
    expect(migrationSql).toMatch(/v_expected_def constant text/);
    // הצורה המדויקת שאומתה מול הסכמה החיה (ANY(ARRAY[...]), לא IN(...)) - Postgres מנרמל אליה.
    expect(migrationSql).toContain(
      "CHECK ((product_type = ANY (ARRAY['baseReport'::text, 'cashFlowAnalysis'::text])))"
    );
    const mismatchOccurrences = (migrationSql.match(/if v_condef <> v_expected_def then/g) || []).length;
    expect(mismatchOccurrences).toBe(2);
  });

  it("שני התנאים (כמות + הגדרה) נבדקים על שתי הטבלאות **לפני** שקורה ולו DROP/ALTER אחד - אין ALTER/DROP לפני כל בדיקות ה-raise exception", () => {
    const raiseIndexes = [...migrationSql.matchAll(/raise exception/g)].map((m) => m.index ?? -1);
    const executeDropIndexes = [...migrationSql.matchAll(/execute format\('alter table .* drop constraint/g)].map((m) => m.index ?? -1);
    expect(raiseIndexes.length).toBe(4); // 2 constraints X (ספירה + הגדרה)
    expect(executeDropIndexes.length).toBe(2); // dohefes_payment_orders + dohefes_product_entitlements

    const lastRaiseIndex = Math.max(...raiseIndexes);
    const firstDropIndex = Math.min(...executeDropIndexes);
    expect(firstDropIndex).toBeGreaterThan(lastRaiseIndex);
  });

  it("שם הפונקציה/הקובץ עדיין מציין 'אידמפוטנטי' רק כהתייחסות היסטורית - ריצה כפולה נכשלת במפורש (מתועד בתרחישי הבדיקה), לא 'מתקנת' בשקט", () => {
    expect(migrationSql).toMatch(/אידמפוטנטית-שקטה/);
    expect(migrationSql).toMatch(/ריצה שנייה תמצא constraint עם/);
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
