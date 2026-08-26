// המרת אגורות (מקור האמת שלנו, integer) לפורמט השקלים העשרוני ש-Cardcom דורשת (SumToBill,
// שתי ספרות עשרוניות, כמחרוזת). בלי float חופשי בשום שלב - כל החישוב במספרים שלמים, המרה
// למחרוזת בסוף בלבד. קובץ טהור, בלי ייבוא ספציפי ל-Deno - נבדק ישירות ב-Vitest.

/**
 * 98_000 (אגורות) -> "980.00". דוחה כל דבר שאינו מספר שלם וחיובי - אין המרה "סלחנית" של
 * float/שלילי/0 לערך קרוב.
 */
export function agorotToShekelString(amountAgorot: number): string {
  if (!Number.isInteger(amountAgorot) || amountAgorot <= 0) {
    throw new Error(`agorotToShekelString: expected a positive integer number of agorot, got ${amountAgorot}`);
  }
  const shekels = Math.trunc(amountAgorot / 100);
  const remainderAgorot = amountAgorot % 100;
  return `${shekels}.${remainderAgorot.toString().padStart(2, "0")}`;
}
