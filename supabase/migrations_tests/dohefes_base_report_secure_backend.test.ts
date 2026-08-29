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
});

describe("Commit 6a-fix: טיפול מדויק ב-unique_violation - שם ה-constraint המדויק, לא כל unique_violation", () => {
  function createFunctionBody(): string {
    return activeSql(migrationSql).split("create or replace function dohefes_create_base_report_payment_order")[1]?.split("$$;")[0] ?? "";
  }

  it("שם ה-constraint המדויק של idempotency_key מופיע מילולית - אומת מול הסכמה המותקנת בפועל (pg_constraint), לא נוחש", () => {
    // dohefes_payment_orders_idempotency_key_key - נבדק מול הפרויקט המקושר עצמו לפני כתיבת
    // הקוד הזה (npx supabase db query --linked), לא הונח מקונבנציית שמות בלבד.
    expect(createFunctionBody()).toMatch(/'dohefes_payment_orders_idempotency_key_key'/);
  });

  it("get stacked diagnostics מחלץ constraint_name בתוך ה-exception handler - לא parsing של הודעת השגיאה", () => {
    const functionBody = createFunctionBody();
    expect(functionBody).toMatch(/get stacked diagnostics v_constraint_name = constraint_name/);
    // מופיע **אחרי** exception when unique_violation, **לפני** הבדיקה על השם - סדר חייב להיות נכון.
    const exceptionIndex = functionBody.indexOf("exception when unique_violation");
    const diagnosticsIndex = functionBody.indexOf("get stacked diagnostics");
    const checkIndex = functionBody.indexOf("if v_constraint_name = 'dohefes_payment_orders_idempotency_key_key'");
    expect(exceptionIndex).toBeGreaterThan(-1);
    expect(diagnosticsIndex).toBeGreaterThan(exceptionIndex);
    expect(checkIndex).toBeGreaterThan(diagnosticsIndex);
  });

  it("fallback הוא 'raise;' חשוף (re-raise, לא הודעה חדשה) - לא רשימת constraints ידועים מפורטת, כך שגם constraint עתידי לא-מוכר מגיע לאותו fallback", () => {
    const functionBody = createFunctionBody();
    // בדיוק בדיקת-שוויון אחת (idempotency_key) בתוך ה-handler, לא switch/case על כמה שמות -
    // מוכיח מבנית שכל דבר שאינו idempotency_key (כולל constraint שעדיין לא קיים היום) נופל
    // לאותו fallback יחיד, לא לרשימה סגורה של constraints "מוכרים".
    const ifCount = (functionBody.match(/if v_constraint_name = /g) || []).length;
    expect(ifCount).toBe(1);
    expect(functionBody).toMatch(/\braise;/);
    // ה-raise החשוף מגיע **אחרי** ה-if/end if על idempotency_key, לא לפניו.
    const endIfIndex = functionBody.indexOf("end if;", functionBody.indexOf("if v_constraint_name = "));
    const raiseIndex = functionBody.indexOf("raise;");
    expect(raiseIndex).toBeGreaterThan(endIfIndex);
  });

  it("5/6. אין exception name/message מותאם אישית שעלול לכלול פרטי DB - raise; חשוף בלבד, בלי raise exception '...' עם טקסט חדש", () => {
    const functionBody = createFunctionBody();
    // אחרי exception when unique_violation, אסור שתופיע 'raise exception' (הודעה חדשה שהמפתח
    // כותב) - רק 'raise;' החשוף שמעביר את השגיאה המקורית כלשונה, בלי לבנות טקסט חדש שעלול
    // (בטעות עתידית) לכלול v_constraint_name או פרטי DB אחרים.
    const exceptionBlockStart = functionBody.indexOf("exception when unique_violation");
    const exceptionBlockEnd = functionBody.indexOf("end;", exceptionBlockStart);
    const handlerBody = functionBody.slice(exceptionBlockStart, exceptionBlockEnd);
    expect(handlerBody).not.toMatch(/raise exception/);
  });
});

describe("21. אין dynamic SQL, dealType מאומת מול רשימה קשיחה", () => {
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
    const returnsBlock = afterFunctionName.split("returns table (")[1]?.split(/\)\r?\nlanguage/)[0] ?? "";
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

describe("Commit 6a-fix: החלטת deal_type - הראיה מ-/calculator מתועדת במקור", () => {
  it("הערת dohefes_save_report_data מפנה במפורש לשורות 333/360/437-449 של app/calculator/page.tsx (הראיה הנבדקת בפועל, לא הנחה)", () => {
    expect(migrationSql).toMatch(/app\/calculator\/page\.tsx/);
    expect(migrationSql).toMatch(/333/);
    expect(migrationSql).toMatch(/360/);
    expect(migrationSql).toMatch(/437-449/);
  });

  it("p_deal_type עדיין קיים בחתימת dohefes_save_report_data (הוחלט להשאיר, לא להסיר) - נבדק structurally מול app/calculator/page.tsx בפועל בהמשך הקובץ הזה", () => {
    const signature = migrationSql.split("create or replace function dohefes_save_report_data")[1]?.split(")")[0] ?? "";
    expect(signature).toMatch(/p_deal_type text/);
  });

  it("הכפתורים בפועל ב-app/calculator/page.tsx (בורר סוג עסקה) הם ללא disabled/readOnly - מוכיח שה-UI אכן מאפשר שינוי בכל שלב, לא רק בהנחה", () => {
    const calculatorSource = readFileSync(join(process.cwd(), "app/calculator/page.tsx"), "utf-8");
    // הבורר עצמו (onClick={() => setDealType(dt)}) קיים ולא מותנה ב-!reportId/disabled באזור שלו.
    // עוגן על הערת ה-JSX הייעודית ({/* סוג עסקה */}) - לא על המחרוזת "סוג עסקה" הכללית, שמופיעה
    // גם בתוך הערות קוד אחרות בקובץ (תיאור מודל עסקי, לא ה-JSX של הבורר עצמו).
    const dealTypeSectionMatch = calculatorSource.match(/\{\/\* סוג עסקה \*\/\}[\s\S]{0,600}/);
    expect(dealTypeSectionMatch).not.toBeNull();
    const dealTypeSection = dealTypeSectionMatch ? dealTypeSectionMatch[0] : "";
    expect(dealTypeSection).toMatch(/onClick=\{\(\) => setDealType\(dt\)\}/);
    expect(dealTypeSection).not.toMatch(/disabled/);
  });

  it("effect 'שמירה רציפה' (autosave) מעביר את inputs המלא ל-saveReport המאובטח", () => {
    const calculatorSource = readFileSync(join(process.cwd(), "app/calculator/page.tsx"), "utf-8");
    expect(calculatorSource).toMatch(/saveReport\(supabase\.functions, \{ reportId, accessToken: reportAccessToken, inputs, results: result \}\)/);
    expect(calculatorSource).not.toMatch(/\.from\("dohefes_reports"\)/);
  });
});

describe("Commit 6a-fix: אין דליפת constraint name/פרטי DB בתגובת ה-HTTP (dohefes-create-payment-order)", () => {
  const indexSource = readFileSync(join(process.cwd(), "supabase/functions/dohefes-create-payment-order/index.ts"), "utf-8");

  it("ה-catch הכללי ב-Deno.serve הוא 'catch {' חשוף - בלי לקשור משתנה שגיאה בכלל, כך שאין אפשרות מבנית להעביר את תוכנו לתגובה", () => {
    // 'catch {' (בלי פרמטר) מופיע לפחות פעם אחת - לא catch (error)/catch (err) שמסתמך על
    // "לא להשתמש במשתנה בטעות" - כאן אין בכלל משתנה לגשת אליו.
    expect(indexSource).toMatch(/\}\s*catch\s*\{/);
    // אין אף 'catch (' עם פרמטר קשור בקובץ כולו.
    expect(indexSource).not.toMatch(/catch\s*\(/);
  });

  it("תגובת השגיאה הכללית היא ליטרל קבוע {error:\"internal_error\"} - לא בנויה מתוכן ה-exception", () => {
    const genericErrorOccurrences = (indexSource.match(/jsonResponse\(\{ error: "internal_error" \}, 500/g) || []).length;
    expect(genericErrorOccurrences).toBeGreaterThanOrEqual(1);
  });
});
