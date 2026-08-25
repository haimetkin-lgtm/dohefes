import { defineConfig } from "vitest/config";

// תשתית בדיקות מינימלית, בכוונה מוגבלת ל-lib/calc בלבד (מנוע החישוב הטהור, בלי תלות ב-React/דפדפן/Supabase).
// לא מרחיבים כרגע למסכי React או לשאר הפרויקט, ר' דיון בסבב "דור 2".
export default defineConfig({
  test: {
    include: ["lib/calc/**/*.test.ts"],
  },
});
