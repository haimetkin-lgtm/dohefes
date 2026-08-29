// פונקציית החלטה טהורה: "האם יש לתזמן שמירה עכשיו?" - Commit 5b-fix. מבודדת מ-React/timers/
// state machine המלא (שכבר חי ב-access-state.ts) כדי שאפשר יהיה לבדוק את לב ההיגיון של
// autosave ישירות ב-Vitest, בלי להסתמך על שרשרת useEffect קשה לבדיקה (ר' audit ה-commit).
//
// **לא state machine מלא** - access-state.ts כבר מחזיק את המצבים עצמם (active/saveInProgress/
// saveError). זו רק פונקציית ה-DECISION שקובעת מתי autosave "אמור" לפעול, קרואה מתוך ה-effect
// ב-app/tracking/page.tsx בכל שינוי state.

export interface AutosaveDecisionInput {
  /** JSON.stringify(entries) הנוכחיים (אחרי כל עריכה) - מחושב על ידי הקורא, לא כאן (הפונקציה
   *  הזו לא יודעת כלום על TrackingItem עצמו, רק משווה מחרוזות). */
  currentEntriesSnapshot: string;
  /** ה-snapshot (JSON) האחרון שאושר כשמור בהצלחה בשרת. `null` אם עדיין לא נטען מעולם -
   *  autosave **לעולם לא** פועל לפני טעינה ראשונה מוצלחת (1/7/8 - "אין save לפני load", "load
   *  אינו גורם save", "מצב ריק תקין אינו 'נתונים חדשים'" - שלושתם נובעים מאותו כלל: ברגע
   *  שהטעינה מצליחה, הקורא קובע lastSavedSnapshot=JSON.stringify(loadedEntries) **לפני**
   *  שה-state עובר ל-active, כך שההשוואה הראשונה תמיד שווה - אין save מיותר). */
  lastSavedSnapshot: string | null;
  /** האם יש בקשת שמירה פעילה כרגע ברשת (9 - לא מתזמנים/לא מתחילים שמירה נוספת בזמן שיש אחת פעילה). */
  saveInFlight: boolean;
}

export type AutosaveDecision = "none" | "scheduleSave";

/**
 * 1/2/3/4/8/9: מחזירה "scheduleSave" **רק** כש-lastSavedSnapshot כבר ידוע (נטען בהצלחה),
 * ה-snapshot הנוכחי **שונה** ממנו בפועל (שינוי משתמש אמיתי, לא טעינה/מצב ריק תקין), ואין כרגע
 * שמירה פעילה. בכל מקרה אחר - "none", לא מתזמנת כלום.
 */
export function decideAutosaveAction(input: AutosaveDecisionInput): AutosaveDecision {
  if (input.lastSavedSnapshot === null) return "none";
  if (input.saveInFlight) return "none";
  if (input.currentEntriesSnapshot === input.lastSavedSnapshot) return "none";
  return "scheduleSave";
}
