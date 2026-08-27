// פרסור Name-To-Value (key=value&key2=value2...) עם lookup לא-תלוי-רישיות.
//
// נדרש במפורש עבור תגובת GetLowProfileIndicator (בניגוד לתגובת LowProfile Create הרגילה -
// זו נשארת case-sensitive לפי הבדיקות הקיימות ב-cardcom-client.test.ts, לא משתנה כאן).
//
// קובץ טהור, בלי ייבוא ספציפי ל-Deno - נבדק ישירות ב-Vitest.

/** המפתחות במפה המוחזרת נשמרים lowercased. getField מבצע גם הוא lowercase על השם המבוקש, כך
 *  ש-"Operation"/"operation"/"OPERATION" כולם מוצאים את אותו ערך - **אך התאמה היא תמיד מדויקת
 *  אחרי lowercase**, לא fuzzy/partial - שם שדה אחר לגמרי (למשל "Oper" או "OperationX") לעולם
 *  לא "מתקרב" בטעות לשדה הנכון. */
export function parseNameToValue(text: string): Map<string, string> {
  const params = new URLSearchParams(text);
  const map = new Map<string, string>();
  for (const [key, value] of params.entries()) {
    map.set(key.toLowerCase(), value);
  }
  return map;
}

export function getField(map: Map<string, string>, key: string): string | undefined {
  return map.get(key.toLowerCase());
}
