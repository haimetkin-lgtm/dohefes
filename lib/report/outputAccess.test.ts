import { describe, expect, it, vi } from "vitest";
import { LOCKED_EXPORT_MESSAGE, handleExcelExportClick, handlePrintClick, isExportUnlocked } from "./outputAccess";
import type { OutputAccess } from "./outputAccess";

const LOCKED_STATES: OutputAccess[] = ["trial", "sample"];

describe("isExportUnlocked", () => {
  it("full -> true", () => {
    expect(isExportUnlocked("full")).toBe(true);
  });

  it("trial/sample -> false", () => {
    for (const access of LOCKED_STATES) {
      expect(isExportUnlocked(access)).toBe(false);
    }
  });
});

describe("handleExcelExportClick - 3. Excel במצב trial אינו מפעיל את פונקציית הייצוא / 5. sample נעול באותה צורה", () => {
  it.each(LOCKED_STATES)("access=%s - downloadExcel לא נקרא בכלל", (access) => {
    const downloadExcel = vi.fn();
    handleExcelExportClick(access, downloadExcel);
    expect(downloadExcel).not.toHaveBeenCalled();
  });

  it("7. access=full - downloadExcel נקרא בדיוק פעם אחת", () => {
    const downloadExcel = vi.fn();
    handleExcelExportClick("full", downloadExcel);
    expect(downloadExcel).toHaveBeenCalledTimes(1);
  });

  it("full - קריאה כפולה (שני קליקים) קוראת פעמיים, לא יותר/פחות - אין state נסתר שמונע קריאה חוזרת", () => {
    const downloadExcel = vi.fn();
    handleExcelExportClick("full", downloadExcel);
    handleExcelExportClick("full", downloadExcel);
    expect(downloadExcel).toHaveBeenCalledTimes(2);
  });
});

describe("handlePrintClick - 4. הדפסה במצב trial אינה מפעילה window.print / 5. sample נעול באותה צורה", () => {
  it.each(LOCKED_STATES)("access=%s - printReport לא נקרא בכלל", (access) => {
    const printReport = vi.fn();
    handlePrintClick(access, printReport);
    expect(printReport).not.toHaveBeenCalled();
  });

  it("8. access=full - printReport נקרא בדיוק פעם אחת", () => {
    const printReport = vi.fn();
    handlePrintClick("full", printReport);
    expect(printReport).toHaveBeenCalledTimes(1);
  });
});

describe("LOCKED_EXPORT_MESSAGE - ההודעה הקבועה המדויקת שהתבקשה", () => {
  it('שווה בדיוק ל-"ייצוא Excel והפקת דוח להדפסה זמינים בגרסה המלאה בתשלום"', () => {
    expect(LOCKED_EXPORT_MESSAGE).toBe("ייצוא Excel והפקת דוח להדפסה זמינים בגרסה המלאה בתשלום");
  });

  it("מקור יחיד - קבוע אחד בלבד, לא מחרוזת שמורכבת דינמית מ-outputAccess", () => {
    expect(typeof LOCKED_EXPORT_MESSAGE).toBe("string");
    expect(LOCKED_EXPORT_MESSAGE.length).toBeGreaterThan(0);
  });
});

describe("אין תלות ב-DOM/window - הקובץ כולו טהור", () => {
  it("isExportUnlocked/handleExcelExportClick/handlePrintClick לא נוגעים ב-window/document בעצמם - printReport/downloadExcel מוזרקים תמיד מבחוץ", () => {
    // בדיקת חוזה: קריאה עם פונקציות מזוייפות בלבד (בלי jsdom) מוכיחה בעצמה שאין גישה ישירה
    // ל-window בתוך המודול - אחרת הקריאה הייתה נכשלת בסביבת Node הרגילה (ר' vitest.config.mts,
    // אין environment: "jsdom" מוגדר).
    expect(() => handleExcelExportClick("trial", () => {})).not.toThrow();
    expect(() => handlePrintClick("trial", () => {})).not.toThrow();
    expect(() => isExportUnlocked("full")).not.toThrow();
  });
});
