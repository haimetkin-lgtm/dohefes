# דור 2, שלב תזרים ומימון: מפרט תכנון

**Status: Approved design, not implemented.**
תאריך אישור: 2026-08-25. גרסת סכמה מתוכננת ליישום: `CASH_FLOW_SCHEMA_VERSION = 1`.

מסמך זה מתאר **תכנון בלבד**. שום שינוי לא בוצע במנוע החישוב הקיים (`lib/calc/engine.ts`) או בטיפוסים
הקיימים (`lib/calc/types.ts`). כל דבר במסמך הזה שמתואר כ"קיים" הוא תיאור נאמן של הקוד/קבצי המקור כפי שהם
**היום**, לא יכולת חדשה. יישום בפועל (מנוע `computeCashFlow`, טיפוסים חדשים, בדיקות) יתחיל רק בענף נפרד,
אחרי אישור נוסף לפי §9.

מקורות שנקראו: `AGENTS.md`, `README.md`, `lib/calc/types.ts`, `lib/calc/engine.ts`, וששת מפרטי הנוסחאות
ב-`Dropbox/2026/קלוד קוד - מיזמים/דוחות אפס/מפרט נוסחאות/` (קריאה מלאה של 01-תמא-38, 03-קבוצת-רכישה,
05-קומבינציה-בעין; קריאה ממוקדת בסעיפי התזרים/מכירות של 04-מעורב-מגורים-ותעסוקה).

---

## 0. המצב הקיים היום (MVP, קירוב סטטי - לא ישונה בשלב הזה)

מבוסס `lib/calc/engine.ts`, `computeCosts` סעיפים C+F:

```
totalDirectAndIndirect = directConstructionNis + indirectNis + landNis
presaleInflowNis       = developerRevenueExclVatNis * 1.17 * presaleRate
creditFacilityNis      = max(0, totalDirectAndIndirect - equityNis - presaleInflowNis)
avgOutstandingBalanceNis = creditFacilityNis / 2                              ← קירוב: "חצי מהשיא"
financingNis            = avgOutstandingBalanceNis * annualInterestRate * (constructionMonths/12)

guaranteeCommissionNis      = totalRevenueInclVatNis * guaranteeCommissionRate * 0.5   ← קירוב: "חצי מהבסיס הסופי"
unusedCreditCommissionNis   = creditFacilityNis * unusedCreditCommissionRate * 0.5
accountOpeningCommissionNis = developerRevenueExclVatNis * 1.17 * accountOpeningCommissionRate  ← חד-פעמי בפועל
```

קירוב **סטטי, לא תלוי-זמן**: אין חודשים, שלבים, עקומת בנייה או לוח תקבולים. הנוסחה הזו **נשארת בדיוק כפי שהיא**
עד שתוחלף במפורש - `computeProject`/`ProjectResult` לא משתנים במסגרת שלב התכנון הזה, וגם לא בתחילת שלב היישום
(ר' §8 מפת תאימות).

**סטייה קיימת מהמקור, לא נוצרה היום**: `purchaseGroup` מקבלת כרגע את אותה נוסחת מימון/ערבות/אי-ניצול כמו כל
סוג עסקה אחר. לפי 03-קבוצת-רכישה.md, בתרחיש הבסיס שלושתן אמורות להיות אפס (ר' §5). זו נקודת תיקון מתוכננת
ב**מנוע התזרים החדש בלבד** (ר' §5), לא ב-`computeCosts` הקיים.

---

## 1. ציר הזמן

### 1.1 שלבים (preset)

| # | שלב | אורך/עיגון | מקור |
|---|---|---|---|
| 1 | רכישת קרקע / חתימת עסקה | נקודתי, חודש 0 | קלט ישיר, לא מתוזמן בקבצי המקור |
| 2 | תכנון וקידום היתר | `permitMonths` (קיים) | כל הקבצים |
| 3 | קבלת היתר | נקודתי, סוף שלב 2 | כל הקבצים |
| 4 | ליווי בנקאי ופתיחת חשבון | נקודתי, סביב שלב 3 | `accountOpeningCommissionNis` כבר חד-פעמי |
| 5 | הריסה ופינוי | תחילת שלב 6 | `demolitionFlatNis`, `relocationMonths`/`relocationUnitsCount` (קיימים) |
| 6 | ביצוע בנייה | `constructionMonths` (קיים) | כל הקבצים - עקומת הוצאה מצטברת |
| 7 | שיווק ומכירות | מקביל לשלב 6 | `marketingRate` (קיים) |
| 8 | תקבולי רוכשים | מקביל לשלב 6, ר' §3 | שני דגמים במקור |
| 9 | מסירה וסגירה | סוף שלב 6 | תשלום אחרון, שחרור ערבויות |

### 1.2 רלוונטיות לכל סוג עסקה

| סוג עסקה | 1 (קרקע) | 4 (ליווי בנקאי) | 5 (הריסה/פינוי) | 8 (תקבולים) |
|---|---|---|---|---|
| `basic` | כן, במזומן | כן | לא | מלא |
| `tama38` (הריסה) | לא (תמורה בעין) | כן | כן | רק יחידות שאינן תמורה |
| `tama38` (חיזוק) | לא | כן | פינוי זמני, **בלי** הריסה | רק יחידות תוספת חדשות |
| `pinuyBinui` | לא | כן | כן | רק יחידות שאינן תמורה |
| `kombinatsia`/`kombinatsiaTemurot` | לא (גלום בבנייה) | כן | תלוי פרויקט | רק חלק היזם |
| `purchaseGroup` | כן, ע"י הקבוצה | preset ברירת מחדל: **לא**, ניתן לדריסה (ר' §5) | תלוי פרויקט | תשלומי חברים, לא "מכירה" |
| `mixedUse` | לא | כן | תלוי פרויקט | שלושה מסלולים מקבילים |

---

## 2. פריסת העלויות

כל סעיף מקבל `timingRule` **גלוי בטיפוס עצמו** (ר' §7), לא נוסחה קבורה. אוצר המילים המוצע ל-`rule`:

`landPurchaseMonth` · `permitMonth` · `escortStart` · `constructionStart` · `preCompletion` ·
`spreadOverConstruction` · `spreadOverEscort` · `spreadOverRelocation` · `salesCurve` · `requiresProjectAgreement`

| סעיף | `timingRule` | סטטוס |
|---|---|---|
| `landPurchaseNis` | `landPurchaseMonth` | preset |
| `bettermentLevyNis` | `requiresProjectAgreement` | **דורש התאמה לפרויקט** - ברירת מחדל: מועד מימוש הזכויות או לפני ההיתר, תלוי סוג פרויקט |
| תיווך | `landPurchaseMonth` | preset |
| מס רכישה | `landPurchaseMonth` | preset - ברירת מחדל חודש העסקה |
| חיבור חשמל | `preCompletion` | preset - לקראת סיום הביצוע, לפני אכלוס |
| תכנון ומדידות | `constructionStart` | preset |
| תכנון ויועצים (% מבנייה) | `spreadOverConstruction` | preset |
| פיקוח הנדסי | `spreadOverConstruction` | preset - שכר חודשי למפקח, ר' זיכרון פרויקט |
| שיווק (% מהכנסות) | `salesCurve` | preset |
| משפטי (% מהכנסות) | `salesCurve` | preset |
| החזר שכ"ט עו"ד | `salesCurve` (בחתימת כל חוזה) | preset |
| ליווי פיננסי | `spreadOverEscort` | preset - פריסה חודשית לאורך תקופת הליווי הבנקאי |
| תקורות / דמי ניהול / בצ"מ (% מבנייה) | `spreadOverConstruction` | preset |
| אגרות והיטלי בנייה | `permitMonth` | preset - בחודש ההיתר או הסמוכים לו |
| הריסה | `constructionStart` | preset |
| בנייה ישירה (כל תעריפי המ"ר) | `spreadOverConstruction`, לפי עקומת הבנייה (ר' §7) | preset |
| דמי שכירות לדיירים | `spreadOverRelocation` | preset - צמוד ל-`relocationMonths`, לא ל-`constructionMonths` |
| שכר מארגן (קבוצת רכישה) | `landPurchaseMonth` | preset |
| פתיחת תיק (עמלה חד-פעמית) | `escortStart` | preset |

כל השורות למעלה הן **presets לעריכה**, לא קבועים. `bettermentLevyNis` מסומן במפורש כדורש התאמה כי אין לו
עיגון-זמן עקבי בין סוגי הפרויקטים.

---

## 3. לוח תקבולים ומכירות

**שני דגמים, לא במעמד שווה:**

- **ברירת המחדל החדשה לדוחות חדשים**: `explicitSchedule` - לוח תקבולים מפורש וניתן לעריכה לחלוטין, לכל
  קטגוריית יחידות בנפרד. **`preset` התחלתי בלבד** (לא דרישה): 15% בחתימה / 70% פרוס על תקופת הביצוע / 15%
  במסירה. **זו הנחת ברירת מחדל עסקית, לא דרישת חוק המכר** - חוזה מכר ספציפי גובר תמיד על ה-preset, ויש
  לאפשר עריכה מלאה של הלוח לכל פרויקט.
- **`legacyConstructionLinked`**: הדגם המקורי מ-01-תמא-38.md (הכנסה מוכרת = פונקציה של קצב ההוצאה המצטברת
  על הבנייה, "אחוז השלמה"). נשמר **אך ורק** לתאימות/שחזור מול קבצי המקור המקוריים (בדיקות אימות, השוואה
  לקובץ ה-Excel המקורי). **דוחות חדשים לעולם לא ייבחרו בו כברירת מחדל.**

**הפרדה מפורשת** בין `saleMonth` (מועד חתימת חוזה המכר, ליחידה/קבוצת יחידות) לבין `paymentReceiptDates`
(מועדי קבלת כל תשלום בפועל לפי הלוח שנבחר) - אלה שני נתונים שונים, לא אותו שדה.

**הבחנות שכבר מתועדות במקור (04-מעורב.md §4.2), נשמרות במודל החדש:**

| קטגוריה | preset |
|---|---|
| מגורים למכירה | לוח `explicitSchedule` (ברירת מחדל 15/70/15) |
| מסחר | הכל במסירה בלבד, אין תשלומים מקדימים (נכס מניב) |
| משרדים | כמו מגורים |
| יחידות תמורה (`isCompensationUnit`) | אין תקבול בשום שיטה |
| קבוצת רכישה | לא "מכירה" - תשלומי חברים לפי התקדמות, מנגנון ייעודי נפרד מהמודל הזה |

---

## 4. הון עצמי ואשראי

**סדר עדיפויות חודשי (preset, ברירת מחדל `asNeededUpToCap`):**

```
בכל חודש, לפי הסדר:
1. שימוש בתקבולים זמינים לאותו חודש.
2. הזרמת הון עצמי נדרש, עד לתקרת ההון העצמי שהוגדרה (equityCapNis) - רק הסכום הדרוש, לא הכל מראש.
3. משיכת אשראי בנקאי עבור מה שנשאר לכסות אחרי 1+2.
```

**לא**: הזרמת כל ההון בחודש הראשון בלי קשר לצורך, ולא פריסה שווה אוטומטית בלי קשר לצורך. שיטת הזרמה
פרו-רטה/יחסית (`proRata`) מתוכננת כאפשרות עתידית, **לא ברירת מחדל כרגע** - רלוונטית רק אם הסכם ליווי ספציפי
דורש זאת.

**בסיס חישוב הריבית**, שדה מפורש וגלוי, לא נסתר:

```ts
interestBalanceBasis: "closing" | "averageOpeningClosing"
```

**גרסה ראשונה: ברירת המחדל `"closing"`** (ריבית חודשית על יתרת הסגירה של החודש) - תואמת את שיטת קובצי המקור
(`interest[t] = rate/4 * balance[t]`). `"averageOpeningClosing"` מתוכנן כאפשרות נוספת אם היישום פשוט, אבל
**הבחירה בין השתיים מוצגת בגוף הדוח במפורש** ("ריבית מחושבת על יתרת סגירה חודשית"), לא נסתרת בנוסחה.

```
יתרת מזומן לפני מימון[m]   = תקבולים[m] - תשלומים[m]
הזרמת הון עצמי[m]           = min(צורך[m], equityCapNis - הון עצמי שכבר הוזרם)
משיכת אשראי[m]              = השארית אחרי 1+2
פירעון אשראי מתוך תקבולים[m] = תקבולים שמקזזים ישירות את יתרת החוב
יתרת חוב לסוף חודש[m]       = יתרת חוב[m-1] + משיכה[m] - פירעון[m]
שיא האשראי                  = max(יתרת חוב לסוף חודש) על פני כל הציר
ריבית חודשית[m]             = ריבית_שנתית/12 * בסיס[m]   (בסיס = closing, בגרסה ראשונה)
מסגרת שלא נוצלה[m]          = max(0, מסגרת_קבועה - יתרת חוב[m])
```

---

## 5. קבוצת רכישה: preset ברירת מחדל, לא הכרעה קבועה בקוד

לפי 03-קבוצת-רכישה.md, ה-preset של מנוע התזרים ל-`purchaseGroup`:

```ts
const PURCHASE_GROUP_DEFAULT_PRESET = {
  financingNis: 0,
  buyerGuaranteeCommissionNis: 0,
  unusedCreditCommissionNis: 0,
  fundingSource: "memberEquity",
};
```

**זהו preset ברירת מחדל בלבד, לא קידוד קשיח**. פרויקט "קבוצת רכישה" ספציפי יכול לדרוס אותו במלואו (למשל אם
נדרש בפועל ליווי בנקאי). **אזהרה מקצועית שתוצג בממשק**: הסיווג לצורך חוק המכר תלוי במהות העסקה בפועל, לא רק
בשם שנבחר. לפי הנחיית משרד הבינוי והשיכון, קבוצת רכישה אמיתית (רוכשים בעלים שבונים לעצמם) בדרך כלל אינה
כפופה לחובות חוק המכר של יזם מוכר, אך פרויקט **המכונה** "קבוצת רכישה" בלבד, כשבפועל מדובר במכר דירות לציבור,
עלול להיחשב חייב בחובות אלה על אף השם. **אין להסתמך על תיוג `dealType` בלבד לצורך זה.**

תאימות: שינוי ה-preset הזה קורה **רק** במנוע התזרים החדש (`computeCashFlow`), לא ב-`computeCosts`/
`computeProject` הקיימים. דוחות ישנים שנטענים דרך המנוע הקיים ממשיכים לקבל בדיוק את אותה תוצאה כמו היום.

---

## 6. ערבויות: שלושה מנגנונים נפרדים, לא אחד

```ts
type GuaranteeMechanism =
  | { kind: "buyerSaleLaw"; ratePct: number }                                     // רוכשים משלמים
  | { kind: "kombinatsiaOwner"; ratePct: number; durationYears: number }          // בעלים בקומבינציה
  | { kind: "unitCompensationOwner"; ratePct: number | "requiresVerification" };  // תמורה בתמ"א/פינוי בינוי
```

| מנגנון | בסיס | שיעור | משך חשיפה | מקור |
|---|---|---|---|---|
| `buyerSaleLaw` | הכנסה מצטברת שהוכרה | 0.85% (evidenced) | דינמי, לפי קצב מכירות בפועל | 01/04/05 |
| `kombinatsiaOwner` | שווי שוק **קבוע** של יחידות הבעלים | 1.0% (evidenced) | מח"מ **קבוע**: 3 שנים | 05 בלבד |
| `unitCompensationOwner` (תמ"א 38/פינוי בינוי) | **שווי דירת התמורה החדשה** | **אין ברירת מחדל אוטומטית** - קלט מפורש, או `"requiresVerification"` אם לא סופק | **ממועד פינוי/מסירת הדירה הקיימת ועד מסירת דירת התמורה והשבת הערבות** | לא נמצא במקור, נקבע כעת כהנחה חדשה |

**לא מוחל אוטומטית** מנגנון `kombinatsiaOwner` (1%, מח"מ קבוע) על יחידות תמורה בתמ"א 38/פינוי בינוי - אלה
עסקאות שונות מהותית (קומבינציה = בעל קרקע יחיד עם שווי ידוע; תמ"א/פינוי בינוי = דיירים מרובים, כל אחד עם
דירת תמורה). כשלא סופק שיעור מפורש לפרויקט, `unitCompensationOwner.ratePct = "requiresVerification"` - המנוע
**לא מחשב** ערבות עבורו (0 בפועל), ומסמן אותו כנתון חסר בדוח, לא כשגיאה שקטה.

**מתוכננים בנפרד, לא מחושבים בשלב א' של מנוע התזרים:**
- ערבות שכירות (למקרה של דירות/יחידות מושכרות בתקופת הביניים)
- ערבות מיסים, כשרלוונטית
- ערבות רישום

בשלב א' מחושבות **רק** הערבויות עם בסיס ושיעור מוגדרים (`buyerSaleLaw`, `kombinatsiaOwner`, ו-
`unitCompensationOwner` כשסופק שיעור מפורש). כל השאר מסומנות כנתון חסר בדוח, לא מוערכות אוטומטית.

---

## 7. עקומת הבנייה

**ברירת מחדל חדשה לדוחות חדשים: `sCurve`** (התחלה איטית, האצה באמצע, האטה בסוף - משקפת התנהגות בנייה
מציאותית טוב יותר מפריסה אחידה).

```ts
type ConstructionCurveModel = "linear" | "sCurve" | "legacy";
interface ConstructionCurveAssumptions {
  model: ConstructionCurveModel;
  cumulativePercentByMonth: number[]; // חייב לסכם בדיוק ל-1.0 (100%) בחודש האחרון
}
```

- `linear`: פריסה אחידה, כמו שהמקור מרמז ("cum_spend" גדל בהדרגה, בלי צורה מפורשת).
- `sCurve`: ברירת המחדל החדשה, נוסחת S-curve סטנדרטית (למשל לוגיסטית/בטא), לא נגזרת ממקור ספציפי.
- `legacy`: פרופיל תואם-מקור, לצורך אימות מול קבצי ה-Excel המקוריים בלבד.

עתידי (לא בשלב א'): הזנת אחוז ביצוע ידני לכל חודש, לפרויקטים עם לוח בנייה בפועל שונה מכל preset.

**בדיקות נדרשות**: אין חודש עם אחוז שלילי, אין NaN/Infinity, הסכום המצטבר מגיע בדיוק ל-100% גם במשך בנייה
קצר (`constructionMonths=1`) או חריג (ארוך מאוד).

---

## 8. DSCR - לא נוסף בשלב זה

אושר: DSCR הוא מדד טיפוסי לנכס עם הכנסה תפעולית שוטפת ושירות חוב מחזורי. בפרויקט הקמה-ומכירה (כמו כל
המודלים כאן) האשראי נפרע בבת אחת מתקבולים, אין "שירות חוב" עיתי. **לא נוסף כברירת מחדל.** יישקל בעתיד רק אם
ייבנה תרחיש החזקה-והשכרה (למשל מסחר שנשאר בבעלות היזם ומניב שכירות שוטפת) - מחוץ להיקף השלב הזה.

---

## 9. מבנה הטיפוסים המוצע (סופי לשלב זה)

```ts
export const CASH_FLOW_SCHEMA_VERSION = 1;

interface PaymentTranche {
  cumulativePercent: number;   // אחוז מצטבר מהתמורה שנגבה עד סוף התקופה (0-1)
  label: string;               // לתצוגה בלבד, למשל "בחתימה" / "בהתקדמות" / "במסירה"
}

type SaleScheduleModel = "explicitSchedule" | "legacyConstructionLinked";

interface SalesScheduleAssumptions {
  model: SaleScheduleModel;
  byCategory: Partial<Record<UnitCategory, PaymentTranche[]>>;   // הלוח בפועל, כשמודל=explicitSchedule
  saleMonthByCategory: Partial<Record<UnitCategory, number>>;    // מועד חתימת חוזה, נפרד ממועד תשלום
}

type ConstructionCurveModel = "linear" | "sCurve" | "legacy";
interface ConstructionCurveAssumptions {
  model: ConstructionCurveModel;
  cumulativePercentByMonth: number[];
}

type InterestBalanceBasis = "closing" | "averageOpeningClosing";
type EquityInjectionMode = "asNeededUpToCap" | "proRata";

type GuaranteeMechanism =
  | { kind: "buyerSaleLaw"; ratePct: number }
  | { kind: "kombinatsiaOwner"; ratePct: number; durationYears: number }
  | { kind: "unitCompensationOwner"; ratePct: number | "requiresVerification" };

type CostTimingRuleKind =
  | "landPurchaseMonth" | "permitMonth" | "escortStart" | "constructionStart"
  | "preCompletion" | "spreadOverConstruction" | "spreadOverEscort"
  | "spreadOverRelocation" | "salesCurve" | "requiresProjectAgreement";

interface CostTimingRule {
  rule: CostTimingRuleKind;   // גלוי תמיד למשתמש, לא קבור בנוסחה
  note?: string;              // הסבר חופשי, בעיקר לסעיפים "דורש התאמה לפרויקט"
}

interface CashFlowAssumptions {
  schemaVersion: number;                     // = CASH_FLOW_SCHEMA_VERSION
  salesSchedule: SalesScheduleAssumptions;
  constructionCurve: ConstructionCurveAssumptions;
  interestBalanceBasis: InterestBalanceBasis;      // ברירת מחדל "closing", מוצג בדוח
  equityInjectionMode: EquityInjectionMode;        // ברירת מחדל "asNeededUpToCap"
  equityCapNis: number;                            // = CostInputs.equityNis היום
  guarantees: GuaranteeMechanism[];                // רק מנגנונים עם בסיס+שיעור מוגדרים
  costTimingOverrides?: Partial<Record<keyof CostInputs, CostTimingRule>>;
}

interface CashFlowMonth {
  monthIndex: number;
  phase: "permit" | "demolition" | "construction" | "marketing" | "handover";
  inflowsNis: number;
  outflowsNis: number;
  equityInjectionNis: number;
  creditDrawNis: number;
  creditRepaymentNis: number;
  closingDebtBalanceNis: number;
  interestNis: number;
  buyerGuaranteeCommissionNis: number;
  kombinatsiaOwnerGuaranteeCommissionNis: number;
  unitCompensationGuaranteeCommissionNis: number;
  unusedCreditCommissionNis: number;
}

interface FinancingSummary {
  peakDebtBalanceNis: number;
  peakDebtMonthIndex: number;
  totalInterestNis: number;
  totalBuyerGuaranteeCommissionNis: number;
  totalKombinatsiaOwnerGuaranteeCommissionNis: number;
  totalUnitCompensationGuaranteeCommissionNis: number;
  totalUnusedCreditCommissionNis: number;
  interestBalanceBasisUsed: InterestBalanceBasis;   // לתצוגה בדוח - "איזו שיטה נבחרה"
  missingGuaranteeData: string[];                   // רשימת ערבויות שלא חושבו כי חסר בסיס/שיעור
}

interface CashFlowResult {
  months: CashFlowMonth[];
  financing: FinancingSummary;
}
```

---

## 10. מפת תאימות לדוחות קיימים

| | היום | אחרי שלב היישום |
|---|---|---|
| `ProjectInputs`/`ProjectResult` (הקיימים) | ללא שינוי | **ללא שינוי** - `computeProject` ממשיך לחשב בדיוק כמו היום |
| `CashFlowAssumptions` | לא קיים | שדה **חדש ונפרד לגמרי**, לא מצטרף ל-`ProjectInputs` בשלב הזה |
| `computeCashFlow` | לא קיים | פונקציה **חדשה ונפרדת**, נקראת רק במפורש (לא אוטומטית מ-`computeProject`) |
| דוח ישן ב-Supabase (jsonb `inputs` בלי נתוני תזרים) | נטען ומחושב היום | ימשיך להיטען ולהיפתח **בדיוק כמו היום** - שום שדה חדש לא נדרש בשביל לפתוח דוח קיים |
| השוואה/אימות מול קבצי המקור המקוריים | לא רלוונטי היום | דורש בחירה מפורשת ב-`legacyConstructionLinked` + `constructionCurve.model="legacy"` - **לא** ברירת המחדל |

**מסקנה**: אין סיכון לדוחות קיימים. `computeCashFlow` הוא מודול תוספתי (additive), לא מחליף. `schemaVersion`
בטיפוס `CashFlowAssumptions` מיועד לשינויי סכמה **עתידיים** בתוך המודול החדש עצמו (אחרי שהוא כבר בשימוש),
לא לתאימות עם הדוחות הישנים של היום - אלה לא נוגעים במודול הזה בכלל.

---

## 11. חלוקה מומלצת ל-commits (ליישום, אחרי אישור לפתיחת ענף)

1. טיפוסים בלבד (§9), בלי לוגיקה - `lib/calc/cashflow-types.ts` חדש.
2. `ConstructionCurveAssumptions` - בונה `linear`/`sCurve`/`legacy`, כולל הבדיקה שהסכום = 100%.
3. `SalesScheduleAssumptions` - preset ברירת מחדל (15/70/15) + `legacyConstructionLinked`, עם הפרדת
   saleMonth/paymentReceiptDates.
4. `computeCashFlow` - הלולאה החודשית (הון עצמי → אשראי → ריבית), כולל preset של `purchaseGroup` (§5).
5. שכבת הערבויות (§6) - שלושת המנגנונים, כולל `missingGuaranteeData` לשקיפות כשחסר נתון.
6. בדיקות vitest לפי §12 (11+ תרחישים, כולל אלה שנוספו בסבב הזה: עקומת בנייה מסכמת 100%, preset קבוצת
   רכישה, לוח תשלומים explicit מול legacy).
7. חיווט תצוגתי ראשוני - עמוד/טבלת דיבוג נפרדת לבדיקה ידנית, **לא** משולב בדוח הקיים בשלב הזה.

---

## 12. תכנית בדיקות (מעודכנת)

| # | תרחיש | מה מוודאים |
|---|---|---|
| 1 | פרויקט ללא מכירות | לא זורק, בלי NaN |
| 2 | פרויקט ללא הון עצמי | הכל דרך אשראי |
| 3 | פרויקט ממומן כולו בהון עצמי | יתרת חוב תמיד 0 |
| 4 | תקבולים מקדימים עלויות | יתרת חוב יכולה להיות 0 לאורך כל התקופה |
| 5 | נדרשת מסגרת אשראי לאורך כל הביצוע | שיא באמצע/סוף |
| 6 | פירעון מלא במסירה | יתרת חוב = 0 בחודש המסירה בדיוק |
| 7 | יחידות תמורה ללא תקבולים | לא תורמות לתקבולים, כן ל"מסירה" כאירוע |
| 8 | אפס חודשי בנייה | לא זורק, לא NaN |
| 9 | משך חריג | לא איטי לא-סביר, לא חורג מגבולות |
| 10 | ללא NaN/Infinity בכל תרחיש | `Number.isFinite` בכל נקודת חישוב |
| 11 | שמירת מאזן בכל חודש | מקורות = שימושים + שינוי במזומן/חוב |
| 12 | **חדש**: עקומת בנייה מסכמת בדיוק 100% | גם ב-`constructionMonths=1`, גם בערך גדול מאוד |
| 13 | **חדש**: `purchaseGroup` preset | מימון/ערבות/אי-ניצול = 0 כברירת מחדל, ניתן לדריסה מלאה |
| 14 | **חדש**: `legacyConstructionLinked` משחזר את דגם המקור | תוצאה זהה לנוסחת 01-תמא-38.md המקורית |
| 15 | **חדש**: `unitCompensationOwner` בלי שיעור מפורש | לא מחושב (0), מופיע ב-`missingGuaranteeData`, לא זורק |
| 16 | **חדש**: `interestBalanceBasisUsed` מוצג נכון בפלט | הבחירה בפועל (closing/averageOpeningClosing) לא נסתרת |

---

## סיכום עבור אישור פתיחת ענף יישום

**סטטוס: מסמך זה מאושר. עדיין לא נפתח ענף יישום, עדיין לא נכתב קוד מנוע התזרים.**

- diff מעודכן: קובץ `GEN2_CASHFLOW_DESIGN.md` הוחלף במלואו (גרסה שנייה, משלבת את 8 ההחלטות). שום קובץ קוד
  לא שונה.
- מבנה הטיפוסים הסופי: §9.
- מפת תאימות לדוחות קיימים: §10.
- חלוקת commits: §11.
- הנחות שעדיין דורשות אימות מקצועי (לא הוכרעו, מסומנות במפורש בטבלאות למעלה):
  1. `bettermentLevyNis` - עיתוי מדויק תלוי-פרויקט, אין ברירת מחדל אחידה.
  2. שיעור ערבות `unitCompensationOwner` - אין ברירת מחדל, קלט מפורש בלבד או "דורש אימות".
  3. `averageOpeningClosing` כאפשרות שנייה לבסיס הריבית - ייושם רק "אם פשוט", לא מובטח בגרסה הראשונה.
  4. עקומת S-curve - נוסחה מוצעת (לא ממקור), דורשת אישור הצורה המדויקת לפני יישום.
