// בדיקות תוכן/קטלוג סטטיות (textual, לא snapshot) - Commit 3 (product-catalog-implementation).
// קוראות את קובצי המסך כטקסט ומוודאות את שמונת הדרישות שהתבקשו במפורש, בלי לרנדר React/JSX
// (אין תשתית כזו בפרויקט, ר' ההערה ב-vitest.config.mts) ובלי snapshot שביר - כל בדיקה בודקת
// עובדה טקסטואלית יציבה וממוקדת (מחרוזת אסורה/נדרשת, ייבוא קיים, סמיכות שורות), לא את כל
// תוכן הקובץ בבת אחת.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readApp(relativePath: string): string {
  return readFileSync(join(process.cwd(), "app", relativePath), "utf-8");
}

const HOME = readApp("page.tsx");
const START = readApp("start/page.tsx");
const CALCULATOR = readApp("calculator/page.tsx");
const REPORT = readApp("report/page.tsx");
const TRACKING = readApp("tracking/page.tsx");
const TRACKING_SAMPLE = readApp("tracking-sample/page.tsx");
const SAMPLE = readApp("sample/page.tsx");

const CHANGED_FILES: Record<string, string> = {
  "page.tsx": HOME,
  "start/page.tsx": START,
  "calculator/page.tsx": CALCULATOR,
  "report/page.tsx": REPORT,
  "tracking/page.tsx": TRACKING,
  "tracking-sample/page.tsx": TRACKING_SAMPLE,
  "sample/page.tsx": SAMPLE,
};

describe("1. מחיר מוצג מתוך הקטלוג - lib/catalog.ts, לא נוסחה מקומית", () => {
  it("כל מסך ששונה מייבא CATALOG/formatPriceNis מ-@/lib/catalog (חוץ מ-tracking, שמייבא רק לצורך תצוגת מחיר המעקב)", () => {
    for (const [name, source] of Object.entries(CHANGED_FILES)) {
      expect(source, `${name} אמור לייבא מ-@/lib/catalog`).toMatch(/from "@\/lib\/catalog"/);
    }
  });

  it("start/sample/page.tsx לא מייבאים יותר BASIC_PRICE_NIS - הוחלף בקטלוג", () => {
    expect(START).not.toMatch(/BASIC_PRICE_NIS/);
    expect(SAMPLE).not.toMatch(/BASIC_PRICE_NIS/);
  });

  it("start/calculator/report/tracking/sample קוראים ל-formatPriceNis בפועל, לא רק מייבאים אותו", () => {
    expect(START).toMatch(/formatPriceNis\(/);
    expect(CALCULATOR).toMatch(/formatPriceNis\(/);
    expect(REPORT).toMatch(/formatPriceNis\(/);
    expect(TRACKING).toMatch(/formatPriceNis\(/);
    expect(SAMPLE).toMatch(/formatPriceNis\(/);
  });
});

describe("2. אין טענה שמעקב כלול ללא תשלום - הניסוחים הישנים הוסרו לגמרי", () => {
  const OLD_PHRASES = [
    "כל דוחות המעקב לאותו פרויקט, ללא תשלום נוסף",
    "כל דוחות המעקב לאותו פרויקט ללא תשלום נוסף",
    "כל דוחות המעקב לאותו פרויקט לאורך הביצוע, ללא תשלום נוסף",
    "התשלום כולל את דוח האפס וגם את כל דוחות המעקב",
  ];

  it.each(OLD_PHRASES)("הניסוח הישן '%s' לא קיים באף מסך ששונה", (phrase) => {
    for (const [name, source] of Object.entries(CHANGED_FILES)) {
      expect(source, `${name} עדיין מכיל ניסוח ישן: "${phrase}"`).not.toContain(phrase);
    }
  });
});

describe("3. המעקב מוצג כמוצר נפרד, מקושר למחיר מהקטלוג", () => {
  it("start/calculator/report/tracking מציגים 'מוצר המשך' ליד CATALOG.trackingReports", () => {
    for (const source of [START, CALCULATOR, REPORT, TRACKING]) {
      expect(source).toMatch(/CATALOG\.trackingReports/);
      expect(source).toContain("מוצר המשך");
    }
  });
});

describe("4. התזרים אינו מוצג ככלול בדוח האפס", () => {
  it("אזכור cashFlowAnalysis ב-start/page.tsx מופיע רק בהקשר 'אינו כולל'", () => {
    expect(START).toMatch(/CATALOG\.cashFlowAnalysis/);
    expect(START).toContain("אינו כולל");
    // ה-שורה שמזכירה cashFlowAnalysis היא אותה שורה שמכילה "אינו כולל" - לא שתי הצהרות נפרדות
    const lines = START.split("\n");
    const cashflowLineIndex = lines.findIndex((l) => l.includes("CATALOG.cashFlowAnalysis"));
    expect(cashflowLineIndex).toBeGreaterThan(-1);
    const nearby = lines.slice(Math.max(0, cashflowLineIndex - 2), cashflowLineIndex + 1).join(" ");
    expect(nearby).toContain("אינו כולל");
  });

  it("אין באף מסך ששונה ניסוח חיובי כמו 'כולל...תזרים' (רק 'אינו כולל')", () => {
    for (const [name, source] of Object.entries(CHANGED_FILES)) {
      const positiveClaim = /כולל[^.]{0,20}תזרים/.test(source) && !/אינו כולל[^.]{0,40}תזרים|אינה כוללת[^.]{0,40}תזרים/.test(source);
      expect(positiveClaim, `${name} מכיל טענה חיובית שהתזרים כלול`).toBe(false);
    }
  });
});

describe("5. דירוג הוא כלי חינמי מלא בהקשר פינוי-בינוי", () => {
  it("start/page.tsx - הערת הדירוג (note) נמצאת בתוך אובייקט ה-DEAL_TYPES של pinuyBinui, לא גורפת", () => {
    const pinuyBlockMatch = START.match(/id: "pinuyBinui"[\s\S]{0,300}/);
    expect(pinuyBlockMatch).not.toBeNull();
    expect(pinuyBlockMatch![0]).toContain("דירוג");
  });

  it("ranking/ranking-sample מצהירים על שימוש חינמי ואינם דורשים reportId/Supabase", () => {
    const ranking = readApp("ranking/page.tsx");
    const rankingSample = readApp("ranking-sample/page.tsx");
    expect(ranking).toContain("כלי חינמי מלא");
    expect(rankingSample).toContain("הכלי החינמי");
    expect(ranking).not.toMatch(/reportId|supabase/i);
    expect(rankingSample).not.toMatch(/reportId|supabase/i);
  });

  it("calculator/page.tsx - קישור/טקסט הדירוג מותנה ב-dealType === \"pinuyBinui\" בסמיכות (לא מוצג לכל סוגי העסקה)", () => {
    const rankingIndex = CALCULATOR.indexOf("כלי דירוג יחידות");
    expect(rankingIndex).toBeGreaterThan(-1);
    const guardIndex = CALCULATOR.lastIndexOf('dealType === "pinuyBinui"', rankingIndex);
    expect(guardIndex).toBeGreaterThan(-1);
    // הסמיכות: אין עוד "section" חדש (סוף בלוק JSX) בין התנאי לקישור עצמו
    const between = CALCULATOR.slice(guardIndex, rankingIndex);
    expect(between.length).toBeLessThan(300);
  });
});

describe("6. גרסת הבדיקה מזוהה במפורש ככזו", () => {
  it('calculator/page.tsx מכיל את הביטוי המפורש "גרסת בדיקה להתרשמות"', () => {
    expect(CALCULATOR).toContain("גרסת בדיקה להתרשמות");
  });

  it("ההודעה לא טוענת שהכפתורים חסומים בפועל (אין 'נעול'/'חסום' סביב Excel/PDF בהודעת הטיוטה)", () => {
    const trialMessageMatch = CALCULATOR.match(/גרסת בדיקה להתרשמות[\s\S]{0,400}/);
    expect(trialMessageMatch).not.toBeNull();
    expect(trialMessageMatch![0]).not.toMatch(/נעול|חסום|לא זמין/);
  });
});

describe("7. אין קישור פעיל חדש לתזרים (cashflow)", () => {
  it("אף אחד מהמסכים ששונו לא מכיל href/קישור לנתיב cashflow", () => {
    for (const [name, source] of Object.entries(CHANGED_FILES)) {
      expect(source, `${name} מכיל קישור ל-cashflow`).not.toMatch(/\/cashflow/);
    }
  });

  it("cashFlowAnalysis לא מקושר לשום <a href> - רק טקסט תיאורי", () => {
    const cashflowMentionLines = START.split("\n").filter((l) => l.includes("cashFlowAnalysis"));
    for (const line of cashflowMentionLines) {
      expect(line).not.toMatch(/<a\s+href/);
    }
  });
});

describe("8. אין שכפול מספרי מחיר במסכים ששונו", () => {
  it("אף מסך ששונה לא מכיל את המחרוזת המעוצבת '980 ₪' כטקסט קבוע (רק דרך formatPriceNis)", () => {
    for (const [name, source] of Object.entries(CHANGED_FILES)) {
      expect(source, `${name} מכיל '980 ₪' כטקסט קבוע`).not.toContain("980 ₪");
    }
  });

  it("אף מסך ששונה לא מכיל את המחרוזת המעוצבת '1,800 ₪' כטקסט קבוע", () => {
    for (const [name, source] of Object.entries(CHANGED_FILES)) {
      expect(source, `${name} מכיל '1,800 ₪' כטקסט קבוע`).not.toContain("1,800 ₪");
    }
  });

  it("אין קבוע גולמי 98000/98_000 בקוד המסכים עצמם (המחיר תמיד מגיע מהקטלוג)", () => {
    for (const [name, source] of Object.entries(CHANGED_FILES)) {
      expect(source, `${name} מכיל 98000/98_000 מקודד`).not.toMatch(/98[,_]?000/);
    }
  });
});

describe("ranking/ranking-sample - נשארים פתוחים ללא מנגנון הרשאה", () => {
  it("שני הדפים עדיין לא תלויים ב-reportId/Supabase - המנוע לא השתנה", () => {
    const ranking = readApp("ranking/page.tsx");
    const rankingSample = readApp("ranking-sample/page.tsx");
    expect(ranking).not.toMatch(/supabase/i);
    expect(rankingSample).not.toMatch(/supabase/i);
  });
});

describe("tracking-sample - דוגמה פתוחה ונפרדת מהמוצר האמיתי", () => {
  it("מבהירה שהמעקב בתשלום נפרד, משתמשת במחיר מהקטלוג ולא פונה למסד", () => {
    expect(TRACKING_SAMPLE).toContain("אינו כלול במחיר דוח האפס");
    expect(TRACKING_SAMPLE).toMatch(/formatPriceNis\(CATALOG\.trackingReports\.priceAgorot\)/);
    expect(TRACKING_SAMPLE).not.toMatch(/supabase|reportId|purchaseProduct/);
  });
});
