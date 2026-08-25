# דוח אפס

כלי מקוון להפקת דוחות כדאיות כלכלית ודוחות מעקב לפרויקטי התחדשות עירונית (תמ"א 38, פינוי בינוי,
קומבינציה, קומבינצית תמורות, קבוצות רכישה, עירוב שימושים, ובסיסי). Next.js, static export
ל-GitHub Pages, אותו דפוס כמו `price-vs-value` / `hetel-hasbaha` / `rami`.

## מבנה

- `lib/calc/` - מנוע החישוב (framework-agnostic, לא תלוי ב-React/Supabase). מבוסס על שישה מפרטי
  נוסחאות ב-`Dropbox/2026/קלוד קוד - מיזמים/דוחות אפס/מפרט נוסחאות/`, מאומת מול עשרות קבצי
  פרויקטים אמיתיים נוספים. כולל גם מדדי היתכנות (נקודת איזון, שווי קרקע שיורי, מטריצת רגישות)
  ובדיקת הקצאה והוגנות ליחידה. יש לו בדיקות (`npm test`, vitest, ר' `lib/calc/feasibility.test.ts`).
- `lib/calc/chamberCosts.ts` - טבלת עלויות בנייה של לשכת שמאי המקרקעין, 16 אזורים.
- `app/calculator/` - המחשבון, כל שבעת סוגי העסקה. `ReportView.tsx` הוא רכיב הדוח המלא, משותף גם
  לדוגמאות (`app/sample`, `app/custom-sample`) וגם לצפייה בדוח שמור (`app/report`).
- `app/tracking/` - דוח מעקב בנייה תקופתי (תקציב מול ביצוע בפועל), לפי אותו UUID של דוח הכדאיות.
- `app/custom/intake/` - מסלול "בהתאמה אישית": הלקוח מעלה תיאור חופשי וקבצים, וסוכן AI ב-insure-vda
  בונה מהם שלד נתונים פיזיים בלבד (לא כספי).

## סטטוס (2026-08-25)

מחובר ופעיל מקצה לקצה: תשלום קארדקום (980/1,800/1,180 ₪), שמירת פרויקטים ב-Supabase (קישור קבוע
לפי UUID, autosave), ייצוא Excel, הדפסה/PDF, דוח מעקב בנייה, מסלול בהתאמה אישית עם סוכן AI.

## פיתוח

```
npm install
npm run dev
npm test    # vitest, lib/calc בלבד
npm run lint
```

## פריסה

Push ל-`main` מריץ `.github/workflows/deploy.yml` ומפרסם ל-GitHub Pages. דורש ריפו בשם `dohefes`
תחת `haimetkin-lgtm`, עם GitHub Pages מופעל (Settings → Pages → Source: GitHub Actions).
