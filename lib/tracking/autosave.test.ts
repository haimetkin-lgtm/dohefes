import { describe, expect, it } from "vitest";
import { decideAutosaveAction } from "./autosave";

describe("decideAutosaveAction - 7. אין save לפני load מוצלח", () => {
  it("lastSavedSnapshot=null (עדיין לא נטען מעולם) -> none, גם אם ה-snapshots 'שונים' טכנית", () => {
    const result = decideAutosaveAction({ currentEntriesSnapshot: "[{}]", lastSavedSnapshot: null, saveInFlight: false });
    expect(result).toBe("none");
  });
});

describe("decideAutosaveAction - 8. load אינו גורם ל-save", () => {
  it("מיד אחרי טעינה מוצלחת - currentEntriesSnapshot===lastSavedSnapshot (הקורא קובע אותם שווים בטעינה) -> none", () => {
    const loaded = JSON.stringify([{ id: "i1" }]);
    const result = decideAutosaveAction({ currentEntriesSnapshot: loaded, lastSavedSnapshot: loaded, saveInFlight: false });
    expect(result).toBe("none");
  });

  it("מצב ריק תקין (entries=[] מהשרת) - שני ה-snapshots '[]' זהים -> none, לא 'נתונים חדשים לעריכה'", () => {
    const empty = JSON.stringify([]);
    const result = decideAutosaveAction({ currentEntriesSnapshot: empty, lastSavedSnapshot: empty, saveInFlight: false });
    expect(result).toBe("none");
  });
});

describe("decideAutosaveAction - 9. שינוי משתמש אמיתי גורם ל-scheduleSave", () => {
  it("snapshot נוכחי שונה מהאחרון-שנשמר, אין save פעיל -> scheduleSave", () => {
    const result = decideAutosaveAction({
      currentEntriesSnapshot: JSON.stringify([{ id: "i1", actualNis: 500 }]),
      lastSavedSnapshot: JSON.stringify([{ id: "i1", actualNis: 0 }]),
      saveInFlight: false,
    });
    expect(result).toBe("scheduleSave");
  });
});

describe("decideAutosaveAction - 14. אין שתי שמירות מקבילות", () => {
  it("saveInFlight=true -> none, גם אם יש שינוי אמיתי ממתין", () => {
    const result = decideAutosaveAction({
      currentEntriesSnapshot: JSON.stringify([{ id: "i1", actualNis: 999 }]),
      lastSavedSnapshot: JSON.stringify([{ id: "i1", actualNis: 0 }]),
      saveInFlight: true,
    });
    expect(result).toBe("none");
  });
});

describe("decideAutosaveAction - טהרה", () => {
  it("קריאות חוזרות עם אותו קלט מחזירות תמיד אותה תוצאה (דטרמיניסטי, בלי side effects)", () => {
    const input = { currentEntriesSnapshot: "[1]", lastSavedSnapshot: "[0]", saveInFlight: false } as const;
    expect(decideAutosaveAction(input)).toBe(decideAutosaveAction(input));
  });
});
