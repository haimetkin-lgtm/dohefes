// בדיקה סטטית ממוקדת (Commit 4, סעיף 6: "אל תסתפק רק בחיפוש טקסט") לחיווט outputAccess בפועל
// במסכים - **בנוסף** ל-lib/report/outputAccess.test.ts (שבודק את החלטת ההרשאה וה-handlers
// עצמם, טהור, בלי React). כאן: קריאת קוד המקור של כל call site של ReportView, ווידוא ש:
// (א) כל אחד מהם מספק outputAccess **במפורש** - אין default שקט שמעניק full;
// (ב) הערך שסופק תואם למצב הצפוי (trial/full/sample) לפי מה שהמסך הזה בפועל מייצג;
// (ג) אין נתיב חלופי שקורא ל-downloadWorkbook/window.print ישירות מהמסך (המסלול היחיד הוא
//     דרך ReportView).
// לא רינדור React - קריאת טקסט + regex ממוקדים על מבנה קבוע וידוע (props של JSX, לא ניחוש
// חופשי) - שונה מהותית מ"חיפוש טקסט" גנרי.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readApp(relativePath: string): string {
  return readFileSync(join(process.cwd(), "app", relativePath), "utf-8");
}

const REPORT_VIEW = readFileSync(join(process.cwd(), "app/calculator/ReportView.tsx"), "utf-8");
const CALCULATOR = readApp("calculator/page.tsx");
const REPORT = readApp("report/page.tsx");
const SAMPLE = readApp("sample/page.tsx");
const CUSTOM_SAMPLE = readApp("custom-sample/page.tsx");

/** מוצא קריאה ל-<ReportView ...> ומחזיר את התוכן שבין <ReportView ל-/> הסוגר (props). */
function extractReportViewProps(source: string): string {
  const match = source.match(/<ReportView\s([\s\S]*?)\/>/);
  expect(match, "לא נמצאה קריאה ל-<ReportView ... /> בקובץ").not.toBeNull();
  return match![1];
}

describe("9. כל call site של ReportView מספק outputAccess במפורש - אין default שקט", () => {
  it("ReportView.tsx - outputAccess הוא פרופ חובה, בלי '?' ובלי '=' של ברירת מחדל בפירוק הפרמטרים", () => {
    // תבנית הפירוק בפועל: outputAccess, בלי outputAccess?, ובלי outputAccess = "...".
    expect(REPORT_VIEW).toMatch(/outputAccess,/);
    expect(REPORT_VIEW).not.toMatch(/outputAccess\?:/);
    expect(REPORT_VIEW).not.toMatch(/outputAccess\s*=\s*"(trial|full|sample)"/);
  });

  it.each([
    ["calculator/page.tsx", CALCULATOR],
    ["report/page.tsx", REPORT],
    ["sample/page.tsx", SAMPLE],
    ["custom-sample/page.tsx", CUSTOM_SAMPLE],
  ])("%s מספק outputAccess= בקריאה ל-<ReportView>", (_name, source) => {
    const props = extractReportViewProps(source);
    expect(props).toMatch(/outputAccess=/);
  });
});

describe("מיפוי call site -> מצב, כפי שהוגדר בהנחיה", () => {
  it('calculator/page.tsx - outputAccess תלוי ב-reportId (תנאי, לא ערך קבוע יחיד) - "full" כש-reportId קיים, "trial" אחרת', () => {
    const props = extractReportViewProps(CALCULATOR);
    expect(props).toContain('outputAccess={reportId ? "full" : "trial"}');
  });

  it('report/page.tsx - outputAccess="full" קבוע (תאימות זמנית לדוח שמור)', () => {
    const props = extractReportViewProps(REPORT);
    expect(props).toContain('outputAccess="full"');
  });

  it('sample/page.tsx - outputAccess="sample" קבוע', () => {
    const props = extractReportViewProps(SAMPLE);
    expect(props).toContain('outputAccess="sample"');
  });

  it('custom-sample/page.tsx - outputAccess="sample" קבוע (אותה סיבה כמו sample/page.tsx - נתוני דוגמה בדויים)', () => {
    const props = extractReportViewProps(CUSTOM_SAMPLE);
    expect(props).toContain('outputAccess="sample"');
  });
});

describe("10. query string כגון ?paid=true אינו משנה trial ל-full", () => {
  it("calculator/page.tsx - outputAccess תלוי אך ורק ב-reportId (state), לא ב-paidPending/searchParams.get(\"paid\") ישירות בביטוי", () => {
    const props = extractReportViewProps(CALCULATOR);
    expect(props).not.toMatch(/paid/i);
  });

  it("reportId עצמו נכתב ל-state רק אחרי insert מוצלח (לא נגזר ישירות מ-'paid'==='true' בכל רינדור)", () => {
    // setReportId נקרא רק בתוך .then(({ data }) => { if (data?.id) { setReportId(data.id); ... אחרי insert. גם בטעינת דוח קיים (?id=).
    expect(CALCULATOR).toMatch(/setReportId\(data\.id\)/);
    expect(CALCULATOR).toMatch(/setReportId\(existingId\)/);
  });
});

describe("13. אין נתיב חלופי מ-/calculator או /sample שמפעיל Excel/הדפסה ישירות", () => {
  it.each([
    ["calculator/page.tsx", CALCULATOR],
    ["sample/page.tsx", SAMPLE],
    ["report/page.tsx", REPORT],
    ["custom-sample/page.tsx", CUSTOM_SAMPLE],
  ])("%s לא מייבא downloadWorkbook ולא קורא ל-window.print ישירות - הכל דרך ReportView", (_name, source) => {
    expect(source).not.toMatch(/downloadWorkbook/);
    expect(source).not.toMatch(/window\.print\(\)/);
  });

  it("ReportView.tsx הוא נקודת הקריאה היחידה ל-downloadWorkbook/window.print בכל שרשרת דוח האפס", () => {
    expect(REPORT_VIEW).toMatch(/downloadWorkbook/);
    expect(REPORT_VIEW).toMatch(/window\.print/);
  });
});

describe("1+5. trial/sample מציגים את שני הכפתורים (לא מוסתרים) / 6. full לא מציג הודעת נעילה", () => {
  it("שני הכפתורים מוצגים תמיד (unconditional) - לא עטופים בתנאי exportUnlocked, רק disabled מותנה", () => {
    // אם הכפתורים היו מותנים ב-exportUnlocked, היה מופיע {exportUnlocked && ( ... לפני התגית
    // <button> הראשונה של הייצוא - זה בדיוק מה שאסור (הכפתורים חייבים תמיד להיות מוצגים,
    // "נראים נעולים", לא נעלמים).
    const exportButtonsBlock = REPORT_VIEW.slice(REPORT_VIEW.indexOf("הורדת קובץ Excel") - 400, REPORT_VIEW.indexOf("הדפסה / שמירה כ-PDF") + 50);
    expect(exportButtonsBlock).not.toMatch(/\{exportUnlocked\s*&&/);
    expect(exportButtonsBlock).not.toMatch(/\{!exportUnlocked\s*\?\s*null/);
  });

  it("2. הודעת הנעילה (LOCKED_EXPORT_MESSAGE) מוצגת רק כש-!exportUnlocked - לא מוצגת ב-full", () => {
    expect(REPORT_VIEW).toMatch(/\{!exportUnlocked\s*&&[\s\S]{0,120}LOCKED_EXPORT_MESSAGE/);
  });
});

describe("11+12. אין שינוי בחישוב/מוטציה של נתוני הדוח", () => {
  it("ReportView.tsx לא מייבא/קורא ל-computeProject - לעולם לא מחשב מחדש, רק מציג result שהתקבל", () => {
    expect(REPORT_VIEW).not.toMatch(/computeProject/);
  });

  it("ReportView.tsx לא מבצע הקצאה ל-inputs./result. (אין מוטציה של ה-props שהתקבלו)", () => {
    expect(REPORT_VIEW).not.toMatch(/\binputs\.\w+\s*=[^=]/);
    expect(REPORT_VIEW).not.toMatch(/\bresult\.\w+\s*=[^=]/);
  });

  it("downloadWorkbook/window.print מקבלים את inputs/result כפי שהם, בלי עיבוד נוסף באתר הקריאה", () => {
    expect(REPORT_VIEW).toMatch(/downloadWorkbook\(inputs, result\)/);
  });
});

describe("ReportView.tsx - הכפתורים משתמשים ב-disabled אמיתי + handlers מ-outputAccess.ts, לא בלוגיקה מקומית", () => {
  it("שני הכפתורים מקבלים disabled={!exportUnlocked} (לא רק עיצוב CSS) - לא aria-disabled, שהוא נוסף לא תחליף", () => {
    // רווח לפני "disabled=" בכוונה - "aria-disabled={!exportUnlocked}" גם הוא מסתיים באותה
    // תת-מחרוזת בדיוק, ה-\s מבטיח שסופרים רק את ה-attribute disabled עצמו, לא aria-disabled.
    const disabledCount = (REPORT_VIEW.match(/\sdisabled=\{!exportUnlocked\}/g) || []).length;
    expect(disabledCount).toBe(2);
    const ariaDisabledCount = (REPORT_VIEW.match(/aria-disabled=\{!exportUnlocked\}/g) || []).length;
    expect(ariaDisabledCount).toBe(2);
  });

  it("onClick עובר דרך handleExcelExportClick/handlePrintClick מ-lib/report/outputAccess, לא קורא לפונקציות הייצוא ישירות", () => {
    expect(REPORT_VIEW).toMatch(/onClick=\{.*handleExcelExportClick\(outputAccess/);
    expect(REPORT_VIEW).toMatch(/onClick=\{.*handlePrintClick\(outputAccess/);
  });

  it("מיובא מ-@/lib/report/outputAccess, לא מוגדר מקומית בקובץ", () => {
    expect(REPORT_VIEW).toMatch(/from "@\/lib\/report\/outputAccess"/);
  });
});
