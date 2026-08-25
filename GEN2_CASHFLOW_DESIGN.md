# דור 2, שלב תזרים ומימון: מפרט תכנון

**Status: Approved design, not implemented.**
תאריך אישור: 2026-08-25. גרסת סכמה מתוכננת ליישום: `CASH_FLOW_SCHEMA_VERSION = 1`. גרסת מסמך: 3 (מעודכנת אחרי
סבב ביקורת שני - יתרת מזומן חודשית, עיתוי תשלום מפורש, מזהה עלות ייעודי, מסגרת אשראי, מעגל ריבית, עקומת בנייה
כ-union מבחין, אזהרות/שלמות בפלט).

מסמך זה מתאר **תכנון בלבד**. שום שינוי לא בוצע במנוע החישוב הקיים (`lib/calc/engine.ts`) או בטיפוסים
הקיימים (`lib/calc/types.ts`). כל דבר שמתואר כ"קיים" הוא תיאור נאמן של הקוד/קבצי המקור **כפי שהם היום**, לא
יכולת חדשה. יישום בפועל (מנוע `computeCashFlow`, טיפוסים חדשים, בדיקות) עדיין לא התחיל - ימתין לאישור נוסף
לפני פתיחת ענף.

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

קירוב **סטטי, לא תלוי-זמן**. הנוסחה הזו **נשארת בדיוק כפי שהיא** - `computeProject`/`ProjectResult` לא משתנים
במסגרת שלב התכנון או בתחילת שלב היישום (ר' §10 מפת תאימות).

**סטייה קיימת מהמקור, לא נוצרה היום**: `purchaseGroup` מקבלת כרגע את אותה נוסחת מימון/ערבות/אי-ניצול כמו כל
סוג עסקה אחר. לפי 03-קבוצת-רכישה.md, בתרחיש הבסיס שלושתן אמורות להיות אפס (ר' §5). תיקון מתוכנן **רק** במנוע
התזרים החדש, לא ב-`computeCosts` הקיים.

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

## 2. פריסת העלויות ומזהה העלות הייעודי

**תיקון מהותי מהגרסה הקודמת**: `costTimingOverrides` לא יכול להתבסס על `keyof CostInputs`, כי חלק מהסעיפים
(קרקע, היטל השבחה) נמצאים ב-`LandInputs` נפרד, וחלקם בכלל לא שדה קלט גולמי אלא ערך **מחושב** בתוך
`computeCosts` (למשל תיווך = `landNis * brokerageRate`). לכן מוגדר טיפוס עצמאי, `CashFlowCostItemId`, שמכסה
את כל סעיפי העלות (קרקע/בנייה/עקיפות) בלי תלות במבנה `CostInputs`/`LandInputs` הקיים:

```ts
type CashFlowCostItemId =
  // קרקע (מ-LandInputs, לא מ-CostInputs)
  | "landPurchase" | "bettermentLevy"
  // עקיפות
  | "brokerage" | "purchaseTax" | "electricConnection" | "planningFlat"
  | "planningConsultants" | "engineeringInspection" | "marketing" | "legal"
  | "legalRefund" | "financialSupervision" | "overhead" | "managementFee"
  | "contingency" | "municipalFees" | "organizerFee" | "relocationRent"
  // בנייה ישירה, מפורק לפי קטגוריה (לא סעיף אחד מאוחד) - כי מעורב שימושים דורש עקומות
  // נפרדות למגורים/מסחר/משרדים בפועל (04-מעורב.md, שלושה גיליונות תזרים מקבילים)
  | "demolition" | "constructionResidential" | "constructionResidentialPremium"
  | "constructionCommercial" | "constructionOffice" | "constructionPublicBuilding"
  | "constructionExistingStructure" | "constructionUnderground" | "constructionDevelopment"
  // עמלה חד-פעמית שכן ניתנת לתזמון (בשונה מערבויות/ריבית/אי-ניצול, ר' הערה למטה)
  | "accountOpeningCommission";
```

**במפורש לא כלול** ב-`CashFlowCostItemId`: `guaranteeCommission*`, `unusedCreditCommission`, `interest`. אלה
לא "סעיפי עלות" עם תזמון חיצוני - הם **תוצרים** של הלולאה החודשית עצמה (§4), מחושבים מחדש בכל חודש לפי יתרת
החוב/ההכנסה המצטברת של אותו חודש. אין להם `timingRule` נפרד כי אין להם "מתי" עצמאי מהחישוב.

טבלת ה-`timingRule` המוצע לכל מזהה (זהה בתוכן לגרסה הקודמת, רק ממופה עכשיו למזהה תקין):

| `CashFlowCostItemId` | מקור בתוצאת המנוע הקיים | `timingRule` |
|---|---|---|
| `landPurchase` | `LandInputs.landPurchaseNis` | `landPurchaseMonth` |
| `bettermentLevy` | `LandInputs.bettermentLevyNis` | `requiresProjectAgreement` - **דורש התאמה לפרויקט** |
| `brokerage` | `landNis * brokerageRate` (מחושב) | `landPurchaseMonth` |
| `purchaseTax` | `purchaseTaxBasis * purchaseTaxRate` (מחושב) | `landPurchaseMonth` |
| `electricConnection` | `unitCount * electricConnectionPerUnitNis` | `preCompletion` |
| `planningFlat` | `CostInputs.planningFlatNis` | `constructionStart` |
| `planningConsultants` | `directConstructionNis * planningConsultantsRate` | `spreadOverConstruction` |
| `engineeringInspection` | `CostInputs.engineeringInspectionFlatNis` | `spreadOverConstruction` |
| `marketing` | `developerRevenueExclVatNis * marketingRate` | `salesCurve` |
| `legal` | `developerRevenueExclVatNis * VAT_FACTOR * legalRate` | `salesCurve` |
| `legalRefund` | `unitCount * legalRefundPerUnitNis` | `salesCurve` (בחתימה) |
| `financialSupervision` | `CostInputs.financialSupervisionFlatNis` | `spreadOverEscort` |
| `overhead` | `directConstructionNis * overheadRate` | `spreadOverConstruction` |
| `managementFee` | `directConstructionNis * managementFeeRate` | `spreadOverConstruction` |
| `contingency` | `directConstructionNis * contingencyRate` | `spreadOverConstruction` |
| `municipalFees` | `computeMunicipalFees(...)` | `permitMonth` |
| `organizerFee` | `CostInputs.organizerFeeNis` (קבוצת רכישה) | `landPurchaseMonth` |
| `relocationRent` | `relocationUnitsCount*relocationMonths*rate` | `spreadOverRelocation` |
| `demolition` | `CostInputs.demolitionFlatNis` | `constructionStart` |
| `construction*` (8 מזהים) | לפי `ConstructionCostRow`/`costPerSqmByCategory` | `spreadOverConstruction`, לפי עקומת הבנייה (§7) |
| `accountOpeningCommission` | `developerRevenueExclVatNis*1.17*accountOpeningCommissionRate` | `escortStart` |

אוצר המילים ל-`rule`: `landPurchaseMonth` · `permitMonth` · `escortStart` · `constructionStart` ·
`preCompletion` · `spreadOverConstruction` · `spreadOverEscort` · `spreadOverRelocation` · `salesCurve` ·
`requiresProjectAgreement`.

**ולידציה נדרשת בשלב היישום**: אין מזהה שמופיע פעמיים ברשימת ה-overrides, וסכום כל סעיפי העלות המתוזמנים
(לפני מימון) שווה בדיוק לסכום המקביל בתרחיש הבסיס של `computeCosts` הקיים (`indirectNis+directConstructionNis+
landNis`, ללא הפרש) - זו בדיקת "לא הלך כסף לאיבוד" ברמת הקלט, נפרדת מבדיקת המאזן החודשית (§12 תרחיש 11).

---

## 3. לוח תקבולים ומכירות

### 3.1 שני דגמים, לא במעמד שווה

- **ברירת המחדל החדשה לדוחות חדשים**: `explicitSchedule` - לוח תקבולים מפורש וניתן לעריכה, לכל קטגוריית
  יחידות בנפרד. **`preset` התחלתי בלבד, לא דרישה**: 15% בחתימה / 70% פרוס על תקופת הביצוע / 15% במסירה. **זו
  הנחת ברירת מחדל עסקית, לא דרישת חוק המכר** - חוזה מכר ספציפי גובר תמיד על ה-preset.
- **`legacyConstructionLinked`**: הדגם המקורי מ-01-תמא-38.md (הכנסה מוכרת = פונקציה של קצב ההוצאה המצטברת).
  נשמר **אך ורק** לתאימות/שחזור מול קבצי המקור המקוריים. **דוחות חדשים לעולם לא ייבחרו בו כברירת מחדל.**

### 3.2 טיפוס תזמון תשלום מפורש (תיקון מהגרסה הקודמת)

הגרסה הקודמת של `PaymentTranche` כללה רק `cumulativePercent`+`label`, בלי שום ציון **חודש**. תוקן:

```ts
type PaymentTiming =
  | { kind: "relativeToSale"; monthsAfterSale: number }                       // X חודשים אחרי חתימה
  | { kind: "projectMonth"; monthIndex: number }                              // חודש קבוע בציר הפרויקט
  | { kind: "evenSpread"; fromMonthsAfterSale: number; toMonthsAfterSale: number } // פרוס אחיד בין שני מועדים
  | { kind: "constructionProgress"; cumulativeProgress: number }              // לצורך legacyConstructionLinked בלבד
  | { kind: "handover" };                                                     // במסירה, מוגדר כחודש האחרון

interface PaymentTranche {
  percent: number;      // אחוז מהתמורה, לא מצטבר - נמנע מהסיכון של אחוז מצטבר יורד/כפול
  timing: PaymentTiming;
  label: string;        // לתצוגה בלבד
}
```

**ולידציה נדרשת**: סך `percent` בכל היחידות של `PaymentTranche[]` לקטגוריה = 100% בדיוק, אין `percent` שלילי,
כל `PaymentTiming` נופל בתוך ציר הפרויקט בפועל (לא לפני חודש 0, לא אחרי המסירה).

### 3.3 דוגמה: תרגום preset 15/70/15 לחודשי תקבול בפועל

פרויקט עם `constructionMonths=24`, יחידה שנמכרה ב-`saleMonth=3`:

```ts
[
  { percent: 15, timing: { kind: "relativeToSale", monthsAfterSale: 0 },  label: "בחתימה" },   // חודש 3
  { percent: 70, timing: { kind: "evenSpread", fromMonthsAfterSale: 1, toMonthsAfterSale: 21 }, label: "בהתקדמות" }, // חודשים 4-24, ~3.33% לחודש
  { percent: 15, timing: { kind: "handover" }, label: "במסירה" },                                // חודש 24
]
```

### 3.4 הבחנות שכבר מתועדות במקור (04-מעורב.md §4.2), נשמרות

| קטגוריה | preset |
|---|---|
| מגורים למכירה | `explicitSchedule` (ברירת מחדל 15/70/15) |
| מסחר | הכל `handover` בלבד, אין תשלומים מקדימים (נכס מניב) |
| משרדים | כמו מגורים |
| יחידות תמורה (`isCompensationUnit`) | אין תקבול בשום שיטה |
| קבוצת רכישה | לא "מכירה" - תשלומי חברים לפי התקדמות, מנגנון נפרד מהמודל הזה |

---

## 4. הון עצמי, אשראי, ויתרת מזומן חודשית (תוקן מהותית)

### 4.1 מה היה חסר

הגרסה הקודמת עקבה רק אחרי יתרת **חוב**, בלי יתרת **מזומן** נפרדת - לא ניתן היה להעביר עודף תקבולים מחודש
לחודש, להוכיח מאזן מלא, או להבחין בין "יש מזומן פנוי" לבין "צריך לפרוע חוב". תוקן: `CashFlowMonth` כולל עכשיו
גם יתרות פתיחה/סגירה למזומן וגם לחוב, בנפרד.

### 4.2 Waterfall חודשי מלא, בסדר הזה בדיוק

```
1. openingCashBalanceNis[m] = closingCashBalanceNis[m-1]        (0 בחודש הראשון)
   openingDebtBalanceNis[m] = closingDebtBalanceNis[m-1]         (0 בחודש הראשון)
2. operatingInflowsNis[m]   = תקבולים תפעוליים (לפי לוח התקבולים, §3)
3. operatingOutflowsNis[m]  = תשלומים תפעוליים (סעיפי עלות המתוזמנים לחודש זה, §2) + עמלות ערבות/אי-ניצול לחודש זה
   cashBeforeFinancing[m]   = openingCashBalanceNis[m] + operatingInflowsNis[m] - operatingOutflowsNis[m]
4. אם cashBeforeFinancing[m] < minimumCashBalanceNis:
       shortfall               = minimumCashBalanceNis - cashBeforeFinancing[m]
       equityInjectionNis[m]   = min(shortfall, equityCapNis - הון עצמי שהוזרם עד כה)
   אחרת: equityInjectionNis[m] = 0
5. remainingShortfall        = max(0, shortfall - equityInjectionNis[m])
   creditDrawNis[m]          = remainingShortfall   (0 אם אין מחסור)
   cashAfterDraw[m]          = cashBeforeFinancing[m] + equityInjectionNis[m] + creditDrawNis[m]
6. closingDebtBeforeInterestNis[m] = openingDebtBalanceNis[m] + creditDrawNis[m]
   surplus                        = max(0, cashAfterDraw[m] - minimumCashBalanceNis)
   creditRepaymentNis[m]          = min(surplus, closingDebtBeforeInterestNis[m])
   closingDebtBeforeInterestAfterRepaymentNis[m] = closingDebtBeforeInterestNis[m] - creditRepaymentNis[m]
7. interestNis[m] = (annualInterestRate/12) * בסיס[m]   ← הבסיס תלוי ב-interestBalanceBasis, ר' 4.4
   מדיניות ברירת מחדל: הריבית **לא** משולמת מהמזומן באותו חודש, אלא מצטרפת ליתרת החוב (מהוונת)
8. closingDebtBalanceNis[m] = closingDebtBeforeInterestAfterRepaymentNis[m] + interestNis[m]
   closingCashBalanceNis[m] = cashAfterDraw[m] - creditRepaymentNis[m]
```

`minimumCashBalanceNis` הוא שדה חדש ב-`CashFlowAssumptions`, **ברירת מחדל `0`**, ניתן לשינוי (למשל אם רוצים
תמיד "כרית" מזומן מינימלית לפני שממשיכים לפרוע חוב).

### 4.3 דוגמה מספרית, חודש עם משיכת אשראי (מוכיחה את משוואת המאזן)

נתונים: `openingCashBalanceNis=0`, `openingDebtBalanceNis=1,000,000`, תקבולים החודש `100,000`, תשלומים
`400,000`, `minimumCashBalanceNis=0`, הון עצמי כבר מוצה במלואו (הזרמה החודש=0), ריבית שנתית `6%` (חודשי `0.5%`).

```
cashBeforeFinancing = 0 + 100,000 - 400,000 = -300,000
shortfall            = 0 - (-300,000) = 300,000
equityInjection      = 0   (התקרה כבר מוצתה)
creditDraw           = 300,000
cashAfterDraw        = -300,000 + 0 + 300,000 = 0

closingDebtBeforeInterest = 1,000,000 + 300,000 = 1,300,000
surplus                   = max(0, 0-0) = 0  →  creditRepayment = 0
closingDebtBeforeInterestAfterRepayment = 1,300,000

interest = 0.5% * 1,300,000 = 6,500       ← מחושבת על היתרה *לפני* הוספת הריבית עצמה, אין מעגליות
closingDebtBalance = 1,300,000 + 6,500 = 1,306,500
closingCashBalance = 0 - 0 = 0
```

**בדיקת מאזן** (מקורות = שימושים + שינוי מזומן/חוב):

```
מקורות: openingCash(0) + inflows(100,000) + equity(0) + creditDraw(300,000)            = 400,000
שימושים: outflows(400,000) + repayment(0) + Δcash(closingCash-openingCash = 0)          = 400,000  ✓

Δdebt = closingDebt(1,306,500) - openingDebt(1,000,000) - creditDraw(300,000) + repayment(0) = 6,500
      = interest, כצפוי - הריבית "מופיעה" רק כגידול ביתרת החוב, לא כתזרים יוצא באותו חודש.
```

### 4.4 בסיס הריבית - שם השדה תוקן, אין עוד עמימות

```ts
type InterestBalanceBasis = "closingDebtBeforeInterest" | "averageOpeningAndPreInterestClosing";
```

**גרסה ראשונה: ברירת מחדל `"closingDebtBeforeInterest"`** - ריבית מחושבת על יתרת החוב **אחרי** משיכות/פירעונות
תפעוליים של אותו חודש, אבל **לפני** הוספת הריבית של אותו חודש עצמו (ר' שלב 6-7 ב-4.2 והדוגמה ב-4.3). זה פותר
את סיכון המעגליות (יתרת סגירה → ריבית → צורך נוסף באשראי → יתרת סגירה חדשה) על ידי כך שהריבית **לא** משפיעה
על משיכת האשראי של אותו חודש - היא מצטרפת רק ליתרת הפתיחה של החודש **הבא**.

`"averageOpeningAndPreInterestClosing"` (ממוצע בין יתרת הפתיחה ל-`closingDebtBeforeInterestAfterRepayment`,
**לפני** תוספת הריבית עצמה - כדי לא ליצור אותה מעגליות) מתוכננת כאפשרות שנייה, **תיושם רק אם פשוט**, לא
מובטחת בגרסה הראשונה. הבחירה בפועל מוצגת בדוח דרך `financing.interestBalanceBasisUsed` - לעולם לא נסתרת.

### 4.5 הזרמת הון עצמי

**ברירת מחדל `asNeededUpToCap`**: הון עצמי מוזרם רק כשנדרש (שלב 4 ב-4.2), עד לתקרה `equityCapNis`. **לא**
מוזרם כולו בחודש הראשון בלי קשר לצורך, ולא נפרס שווה בשווה ללא תלות בצורך בפועל. שיטת הזרמה יחסית/פרו-רטה
(`proRata`) מתוכננת כאפשרות עתידית, לא ברירת מחדל - רק אם הסכם ליווי ספציפי דורש זאת.

### 4.6 מסגרת אשראי - שדה חדש, לא הייתה מוגדרת

הגרסה הקודמת השתמשה ב"מסגרת קבועה" בנוסחת עמלת אי-הניצול, בלי להגדיר מאיפה היא מגיעה. תוקן:

```ts
creditFacilityLimitNis: number | "auto";
```

**בעיה שזוהתה ותוקנה**: אסור שהמסגרת תיגזר משיא החוב **של אותו תזרים עצמו** - זה יוצר מצב שבו עמלת אי-הניצול
תמיד קרובה ל-0 (המסגרת "מתאימה את עצמה בדיעבד" לצורך בפועל), מה שהופך את המנגנון חסר משמעות. לכן:

| הקשר | ברירת מחדל |
|---|---|
| פרויקט אמיתי (לקוח מזין נתונים) | קלט מפורש, מהסכם הליווי הבנקאי בפועל |
| תרחיש לדוגמה/דמו | `"auto"`, עם נוסחה מתועדת ואזהרה גלויה שזו הערכה, לא מסגרת אמיתית מהבנק (הצעה לנוסחה: שיא החוב הצפוי + רווח ביטחון קבוע, למשל 15%, לא שיא בדיעבד) |
| `purchaseGroup` (preset ברירת מחדל) | `0` |

פלט חדש: `creditFacilityLimitNisUsed: number` (הערך בפועל שנעשה בו שימוש) ו-`peakFacilityUtilizationRatio: number | null`
(שיא יתרת החוב חלקי המסגרת, `null` אם המסגרת 0 או לא רלוונטית).

---

## 5. קבוצת רכישה: preset ברירת מחדל, לא הכרעה קבועה בקוד

לפי 03-קבוצת-רכישה.md, ה-preset של מנוע התזרים ל-`purchaseGroup`:

```ts
const PURCHASE_GROUP_DEFAULT_PRESET: Partial<CashFlowAssumptions> = {
  creditFacilityLimitNis: 0,
  guarantees: [],   // אין buyerSaleLaw, אין kombinatsiaOwner - מימון כולו בהון חברי הקבוצה
};
```

**preset ברירת מחדל בלבד, לא קידוד קשיח** - פרויקט ספציפי יכול לדרוס במלואו (למשל אם נדרש בפועל ליווי בנקאי).
**אזהרה מקצועית שתוצג בממשק**: הסיווג לצורך חוק המכר תלוי במהות העסקה בפועל, לא רק בשם שנבחר. לפי הנחיית
משרד הבינוי והשיכון, קבוצת רכישה אמיתית (רוכשים בעלים שבונים לעצמם) בדרך כלל אינה כפופה לחובות חוק המכר של
יזם מוכר, אך פרויקט **המכונה** "קבוצת רכישה" בלבד, כשבפועל מדובר במכר דירות לציבור, עלול להיחשב חייב בחובות
אלה על אף השם. **אין להסתמך על תיוג `dealType` בלבד לצורך זה.**

תאימות: שינוי ה-preset קורה **רק** במנוע התזרים החדש (`computeCashFlow`), לא ב-`computeCosts`/`computeProject`
הקיימים. דוחות ישנים ממשיכים לקבל בדיוק את אותה תוצאה כמו היום.

---

## 6. ערבויות: שלושה מנגנונים נפרדים, לא אחד

```ts
type GuaranteeMechanism =
  | { kind: "buyerSaleLaw"; ratePct: number }
  | { kind: "kombinatsiaOwner"; ratePct: number; durationYears: number }
  | { kind: "unitCompensationOwner"; ratePct: number | "requiresVerification" };
```

| מנגנון | בסיס | שיעור | משך חשיפה | מקור |
|---|---|---|---|---|
| `buyerSaleLaw` | הכנסה מצטברת שהוכרה | 0.85% (evidenced) | דינמי, לפי קצב מכירות בפועל | 01/04/05 |
| `kombinatsiaOwner` | שווי שוק **קבוע** של יחידות הבעלים | 1.0% (evidenced) | מח"מ **קבוע**: 3 שנים | 05 בלבד |
| `unitCompensationOwner` (תמ"א 38/פינוי בינוי) | **שווי דירת התמורה החדשה** | **אין ברירת מחדל אוטומטית** - קלט מפורש, או `"requiresVerification"` | **ממועד פינוי/מסירת הדירה הקיימת ועד מסירת דירת התמורה והשבת הערבות** | לא נמצא במקור, הנחה חדשה |

**לא מוחל אוטומטית** `kombinatsiaOwner` (1%, מח"מ קבוע) על יחידות תמורה בתמ"א/פינוי בינוי - עסקאות שונות
מהותית. כשלא סופק שיעור מפורש, `unitCompensationOwner.ratePct = "requiresVerification"` - **לא מחושב** (0
בפועל), מסומן כנתון חסר בדוח (`missingAssumptions`, ר' §7), לא שגיאה שקטה.

**מתוכננים בנפרד, לא מחושבים בשלב א'**: ערבות שכירות, ערבות מיסים (כשרלוונטית), ערבות רישום. מחושבות רק
הערבויות עם בסיס+שיעור מוגדרים.

---

## 7. עקומת הבנייה (תוקן: union מבחין, לא שני שדות סותרים)

הבעיה בגרסה הקודמת: `model` ו-`cumulativePercentByMonth` ישבו יחד באותו אובייקט, בלי להבהיר אם המערך הוא
קלט (למודל `custom`) או פלט מחושב (למודלים `linear`/`sCurve`) - "שתי אמיתות" סותרות. תוקן ל-union מבחין:

```ts
type ConstructionCurveAssumptions =
  | { model: "linear" }
  | { model: "sCurve"; shapeParameter?: number }   // ברירת מחדל חדשה לדוחות חדשים
  | { model: "legacy" }                             // פרופיל תואם-מקור, לאימות בלבד
  | { model: "custom"; cumulativePercentByMonth: number[] };  // קלט ידני מלא, היחיד עם מערך בפועל
```

`linear`/`sCurve`/`legacy` **מחשבים** את `cumulativePercentByMonth` בזמן ריצה, לא מאחסנים אותו. `custom` הוא
היחיד שבו המערך הוא קלט אמיתי מהמשתמש. **חייב לסכם בדיוק ל-100%** בחודש האחרון, בכל המודלים.

עתידי (לא בשלב א'): הרחבת `custom` להזנת אחוז ביצוע חופשי לכל חודש בממשק, לא רק כטיפוס.

---

## 8. DSCR - לא נוסף בשלב זה

אושר: DSCR מתאים לנכס עם הכנסה תפעולית שוטפת ושירות חוב מחזורי. בפרויקט הקמה-ומכירה האשראי נפרע בבת אחת
מתקבולים, אין "שירות חוב" עיתי. **לא נוסף כברירת מחדל.** יישקל בעתיד רק אם ייבנה תרחיש החזקה-והשכרה.

---

## 9. מבנה הטיפוסים המוצע (סופי לשלב זה)

```ts
export const CASH_FLOW_SCHEMA_VERSION = 1;

// --- לוח תקבולים (§3) ---
type PaymentTiming =
  | { kind: "relativeToSale"; monthsAfterSale: number }
  | { kind: "projectMonth"; monthIndex: number }
  | { kind: "evenSpread"; fromMonthsAfterSale: number; toMonthsAfterSale: number }
  | { kind: "constructionProgress"; cumulativeProgress: number }
  | { kind: "handover" };

interface PaymentTranche {
  percent: number;         // לא מצטבר
  timing: PaymentTiming;
  label: string;
}

type SaleScheduleModel = "explicitSchedule" | "legacyConstructionLinked";

interface SalesScheduleAssumptions {
  model: SaleScheduleModel;
  byCategory: Partial<Record<UnitCategory, PaymentTranche[]>>;
  saleMonthByCategory: Partial<Record<UnitCategory, number>>;
}

// --- עקומת בנייה (§7) ---
type ConstructionCurveAssumptions =
  | { model: "linear" }
  | { model: "sCurve"; shapeParameter?: number }
  | { model: "legacy" }
  | { model: "custom"; cumulativePercentByMonth: number[] };

// --- מימון (§4) ---
type InterestBalanceBasis = "closingDebtBeforeInterest" | "averageOpeningAndPreInterestClosing";
type EquityInjectionMode = "asNeededUpToCap" | "proRata";

// --- ערבויות (§6) ---
type GuaranteeMechanism =
  | { kind: "buyerSaleLaw"; ratePct: number }
  | { kind: "kombinatsiaOwner"; ratePct: number; durationYears: number }
  | { kind: "unitCompensationOwner"; ratePct: number | "requiresVerification" };

// --- עיתוי עלויות (§2) ---
type CashFlowCostItemId =
  | "landPurchase" | "bettermentLevy"
  | "brokerage" | "purchaseTax" | "electricConnection" | "planningFlat"
  | "planningConsultants" | "engineeringInspection" | "marketing" | "legal"
  | "legalRefund" | "financialSupervision" | "overhead" | "managementFee"
  | "contingency" | "municipalFees" | "organizerFee" | "relocationRent"
  | "demolition" | "constructionResidential" | "constructionResidentialPremium"
  | "constructionCommercial" | "constructionOffice" | "constructionPublicBuilding"
  | "constructionExistingStructure" | "constructionUnderground" | "constructionDevelopment"
  | "accountOpeningCommission";

type CostTimingRuleKind =
  | "landPurchaseMonth" | "permitMonth" | "escortStart" | "constructionStart"
  | "preCompletion" | "spreadOverConstruction" | "spreadOverEscort"
  | "spreadOverRelocation" | "salesCurve" | "requiresProjectAgreement";

interface CostTimingRule {
  rule: CostTimingRuleKind;
  note?: string;
}

interface CashFlowAssumptions {
  schemaVersion: number;                     // = CASH_FLOW_SCHEMA_VERSION
  salesSchedule: SalesScheduleAssumptions;
  constructionCurve: ConstructionCurveAssumptions;
  interestBalanceBasis: InterestBalanceBasis;         // ברירת מחדל "closingDebtBeforeInterest"
  equityInjectionMode: EquityInjectionMode;           // ברירת מחדל "asNeededUpToCap"
  equityCapNis: number;                               // = CostInputs.equityNis היום
  minimumCashBalanceNis: number;                       // ברירת מחדל 0
  creditFacilityLimitNis: number | "auto";             // ר' §4.6, "0" ל-purchaseGroup כברירת מחדל
  guarantees: GuaranteeMechanism[];
  costTimingOverrides?: Partial<Record<CashFlowCostItemId, CostTimingRule>>;  // לא keyof CostInputs!
}

interface CashFlowMonth {
  monthIndex: number;
  phase: "permit" | "demolition" | "construction" | "marketing" | "handover";

  // יתרות (חדש - היה חסר לגמרי)
  openingCashBalanceNis: number;
  openingDebtBalanceNis: number;
  closingCashBalanceNis: number;
  closingDebtBalanceNis: number;

  operatingInflowsNis: number;
  operatingOutflowsNis: number;
  equityInjectionNis: number;
  creditDrawNis: number;
  creditRepaymentNis: number;
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
  interestBalanceBasisUsed: InterestBalanceBasis;
  creditFacilityLimitNisUsed: number;
  peakFacilityUtilizationRatio: number | null;
}

// --- פלט כולל (חדש - שקיפות שלמות) ---
interface CashFlowResult {
  months: CashFlowMonth[];
  financing: FinancingSummary;
  warnings: string[];             // למשל: "מסגרת אשראי הוערכה אוטומטית (auto), לא מהסכם ליווי בפועל"
  missingAssumptions: string[];   // למשל: "שיעור ערבות תמורה לא סופק ליחידה X, לא חושבה ערבות"
  isComplete: boolean;            // false אם missingAssumptions לא ריק - סימון גלוי, לא הצגת תזרים "שלם" כשחסר
}
```

---

## 10. מפת תאימות לדוחות קיימים

| | היום | אחרי שלב היישום |
|---|---|---|
| `ProjectInputs`/`ProjectResult` (הקיימים) | ללא שינוי | **ללא שינוי** - `computeProject` ממשיך לחשב בדיוק כמו היום |
| `CashFlowAssumptions` | לא קיים | שדה **חדש ונפרד לגמרי**, לא מצטרף ל-`ProjectInputs` בשלב הזה |
| `computeCashFlow` | לא קיים | פונקציה **חדשה ונפרדת**, נקראת רק במפורש |
| דוח ישן ב-Supabase (jsonb `inputs` בלי נתוני תזרים) | נטען ומחושב היום | ימשיך להיטען ולהיפתח **בדיוק כמו היום** |
| השוואה/אימות מול קבצי המקור המקוריים | לא רלוונטי היום | דורש בחירה מפורשת ב-`legacyConstructionLinked` + `constructionCurve.model="legacy"` - **לא** ברירת המחדל |

**מסקנה**: אין סיכון לדוחות קיימים. `computeCashFlow` תוספתי (additive), לא מחליף. `schemaVersion` מיועד
לשינויי סכמה **עתידיים** בתוך המודול החדש עצמו, לא לתאימות עם דוחות ישנים - אלה לא נוגעים במודול הזה בכלל.

---

## 11. חלוקה מומלצת ל-commits (ליישום, אחרי אישור לפתיחת ענף)

1. טיפוסים בלבד (§9), בלי לוגיקה.
2. `ConstructionCurveAssumptions` - `linear`/`sCurve`/`legacy`/`custom`, כולל בדיקת סכום=100%.
3. `SalesScheduleAssumptions` + `PaymentTiming` - preset 15/70/15 + `legacyConstructionLinked`.
4. `computeCashFlow` - ה-waterfall החודשי המלא (§4.2), כולל `minimumCashBalanceNis`/`creditFacilityLimitNis`
   ו-preset `purchaseGroup` (§5).
5. שכבת הערבויות (§6), כולל `missingAssumptions`/`warnings`/`isComplete` (§9).
6. בדיקות vitest לפי §12.
7. חיווט תצוגתי ראשוני - עמוד/טבלת דיבוג נפרדת, **לא** משולב בדוח הקיים בשלב הזה.

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
| 11 | שמירת מאזן בכל חודש | `openingCash+inflows+equity+draw = outflows+repayment+closingCash`, בדיוק כמו §4.3 |
| 12 | עקומת בנייה מסכמת בדיוק 100% | גם `constructionMonths=1`, גם ערך גדול מאוד, בכל ארבעת המודלים |
| 13 | `purchaseGroup` preset | מימון/ערבות/אי-ניצול = 0 כברירת מחדל, ניתן לדריסה מלאה |
| 14 | `legacyConstructionLinked` משחזר את דגם המקור | תוצאה זהה לנוסחת 01-תמא-38.md המקורית |
| 15 | `unitCompensationOwner` בלי שיעור מפורש | לא מחושב (0), מופיע ב-`missingAssumptions`, `isComplete=false`, לא זורק |
| 16 | `interestBalanceBasisUsed` מוצג נכון בפלט | הבחירה בפועל לא נסתרת |
| 17 | **חדש**: אין מעגליות ריבית | ריבית מחודש m לא משפיעה על `creditDrawNis[m]` של אותו חודש, ר' §4.4 |
| 18 | **חדש**: מסגרת אשראי לא נגזרת משיא בדיעבד | `creditFacilityLimitNis="auto"` מייצר ערך שאינו זהה תמיד לשיא המדויק שחושב |
| 19 | **חדש**: `PaymentTranche[]` תקין | סך `percent`=100% לכל קטגוריה, אין `percent` שלילי, כל `timing` בתוך ציר הפרויקט |
| 20 | **חדש**: `costTimingOverrides` ללא כפילות/אובדן | סכום סעיפי העלות המתוזמנים = סכום `computeCosts` הקיים, בדיוק |

---

## סיכום עבור אישור פתיחת ענף יישום

**סטטוס: מסמך זה מאושר (גרסה 3). עדיין לא נפתח ענף יישום, עדיין לא נכתב קוד מנוע התזרים.**

- diff עיקרי מול הגרסה הקודמת: §3 (טיפוס `PaymentTiming` חדש + דוגמת תרגום), §4 (יתרת מזומן חודשית מלאה,
  waterfall מפורש, בסיס ריבית ללא מעגליות ושם שדה מתוקן, מסגרת אשראי מוגדרת), §7 (union מבחין לעקומת בנייה,
  לא שני שדות סותרים), §9 (טיפוסים מעודכנים בהתאם לכל האמור, כולל `CashFlowCostItemId` חדש ו-`CashFlowResult`
  עם `warnings`/`missingAssumptions`/`isComplete`), §12 (4 בדיקות חדשות: מעגליות ריבית, מסגרת לא-בדיעבד, ולידציית
  PaymentTranche, ולידציית costTimingOverrides).
- דוגמה מספרית מלאה של חודש אחד עם משיכת אשראי, מוכיחה את משוואת המאזן: §4.3.
- תרגום preset 15/70/15 לחודשי תקבול בפועל: §3.3.
- רשימת `CashFlowCostItemId` מלאה עם מיפוי לנתוני המנוע הקיים: §2.
- הנחות שעדיין דורשות אימות מקצועי (לא הוכרעו):
  1. `bettermentLevy` - עיתוי מדויק תלוי-פרויקט, אין ברירת מחדל אחידה.
  2. שיעור ערבות `unitCompensationOwner` - אין ברירת מחדל, קלט מפורש או "דורש אימות".
  3. `averageOpeningAndPreInterestClosing` כבסיס ריבית חלופי - ייושם רק "אם פשוט".
  4. נוסחת ה-S-curve המדויקת (`shapeParameter`) - מוצעת, לא ממקור, דורשת אישור צורה.
  5. נוסחת ברירת המחדל ל-`creditFacilityLimitNis="auto"` בתרחישי דמו (שיא+רווח ביטחון 15%, הצעה בלבד).
