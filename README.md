# דוח אפס

כלי מקוון להפקת דוחות כדאיות כלכלית ודוחות מעקב לפרויקטי התחדשות עירונית (תמ"א 38, פינוי בינוי,
קומבינציה, קבוצות רכישה, עירוב שימושים). Next.js, static export ל-GitHub Pages, אותו דפוס כמו
`price-vs-value` / `hetel-hasbaha` / `rami`.

## מבנה

- `lib/calc/` - מנוע החישוב (framework-agnostic, לא תלוי ב-React). מבוסס על שישה מפרטי נוסחאות
  ב-`Dropbox/2026/קלוד קוד - מיזמים/דוחות אפס/מפרט נוסחאות/`.
- `lib/calc/chamberCosts.ts` - טבלת עלויות בנייה של לשכת שמאי המקרקעין, 16 אזורים.
- `app/calculator/` - המחשבון (שלב 1: תמ"א 38 וקומבינציה בעין בלבד).

## סטטוס (2026-08-23)

מנוע חישוב ומחשבון עובדים מקצה לקצה, מאומת ידנית. **טרם מחובר**: תשלום קארדקום, שמירת פרויקטים
ב-Supabase, ייצוא Excel/PDF, ציר דוחות מעקב, מסלול "בהתאמה אישית" עם העלאת קבצים.

## פיתוח

```
npm install
npm run dev
```

## פריסה

Push ל-`main` מריץ `.github/workflows/deploy.yml` ומפרסם ל-GitHub Pages. דורש ריפו בשם `dohefes`
תחת `haimetkin-lgtm`, עם GitHub Pages מופעל (Settings → Pages → Source: GitHub Actions).
