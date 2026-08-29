// שכבת החלטת-הרשאה טהורה לייצוא Excel/הדפסה של דוח האפס (ReportView) - Commit 4
// (product-catalog-implementation). מבודדת "מי מותר לו לייצא" ואת ה-handlers עצמם (מה שקורה
// בלחיצה על הכפתור) מ-React, כדי שניתן לבדוק אותם ב-Vitest בלי סביבת רינדור (jsdom/
// @testing-library) - אין כזו בפרויקט (ר' ההערה ב-vitest.config.mts, "לא מרחיבים כרגע
// למסכי React"). ר' outputAccess.test.ts.
//
// **עקרון מרכזי (הנחיית Commit 4, סעיף 2)**: outputAccess הוא קלט מפורש מהמסך הקורא בלבד -
// לעולם לא מוסק מ-query string (?paid=true), מ-localStorage, מקיום נתונים, משם route, מתוצאת
// חישוב, או ממצב כפתור בצד לקוח. כל call site של ReportView (calculator/report/sample/
// custom-sample) קובע את הערך במפורש, כ-prop חובה בלי ברירת מחדל - ר' ReportView.tsx.

/**
 * - `trial` - גרסת בדיקה ללא רכישה (`/calculator` בלי `reportId`). ייצוא נעול.
 * - `full` - דוח מלא. **הערה חשובה**: כרגע (Commit 4) זהו תמיד מצב "תאימות זמני" - כל דוח עם
 *   `reportId` (בין אם ב-`/calculator` או ב-`/report`) הגיע מ-`dohefes_reports.payment_status`
 *   הישן (`?paid=true`, ר' `calculator/page.tsx`) - **לא** entitlement מאובטח. "full" כאן
 *   הוא הנחה תואמת-לאחור, לא אימות תשלום מאובטח - עד שמיגרציית `baseReport` למנגנון
 *   entitlement (ר' `GEN2_PAYMENT_ENTITLEMENT_DESIGN.md`, `PRODUCT_CATALOG_AUDIT.md` §7 שלב 7)
 *   תבוצע, מחוץ להיקף ה-Commit הזה. ייצוא פתוח.
 * - `sample` - דוגמה סטטית (`/sample`, `/custom-sample`), נתונים בדויים לחלוטין, לא דוח אמיתי
 *   של אף לקוח. ייצוא נעול, באותה צורה בדיוק כמו `trial` - הסיבה שונה (אין רכישה מול נתוני
 *   דוגמה), התוצאה זהה.
 */
export type OutputAccess = "trial" | "full" | "sample";

/** ההודעה הקבועה שמוצגת כשהייצוא נעול - מקור יחיד, לא משוכפלת בכל מסך. */
export const LOCKED_EXPORT_MESSAGE = "ייצוא Excel והפקת דוח להדפסה זמינים בגרסה המלאה בתשלום";

/** true רק במצב full - trial/sample שקולים לחלוטין מבחינת ייצוא (שניהם נעולים). */
export function isExportUnlocked(access: OutputAccess): boolean {
  return access === "full";
}

/**
 * ה-handler בפועל של כפתור ה-Excel. **לא קוראת ל-downloadExcel בכלל** כשנעול - לא רק "מסתירה"
 * את הכפתור מאחורי UI מושבת. הבדיקה כאן היא שכבת הגנה עצמאית, בנוסף ל-`disabled` האמיתי על
 * הכפתור עצמו ב-`ReportView.tsx` (הגנת-עומק מכוונת, לא כפילות מיותרת - כפתור `disabled` לא
 * מפעיל `onClick` בדפדפן בכלל, אך הבדיקה כאן ניתנת לאימות ישירות ב-Vitest, בלי DOM אמיתי).
 */
export function handleExcelExportClick(access: OutputAccess, downloadExcel: () => void): void {
  if (!isExportUnlocked(access)) return;
  downloadExcel();
}

/** אותו עיקרון בדיוק עבור הדפסה/PDF - `window.print()` לעולם לא נקרא כשנעול. */
export function handlePrintClick(access: OutputAccess, printReport: () => void): void {
  if (!isExportUnlocked(access)) return;
  printReport();
}
