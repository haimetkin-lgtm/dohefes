# דור 2, שלב תזרים ומימון: מפרט תכנון

**Status: Approved design, not implemented.**
תאריך אישור: 2026-08-25. גרסת סכמה מתוכננת ליישום: `CASH_FLOW_SCHEMA_VERSION = 1`. גרסת מסמך: 4 (מעודכנת אחרי
סבב ביקורת שלישי - יחידת `fraction` עקבית, חריגה ממסגרת אשראי, מעגליות עמלת אי-ניצול, שתי התאמות נפרדות
לתרחיש הבסיס, החלטה סופית ל-`auto`).

מסמך זה מתאר **תכנון בלבד**. שום שינוי לא בוצע במנוע החישוב הקיים (`lib/calc/engine.ts`) או בטיפוסים
הקיימים (`lib/calc/types.ts`). כל דבר שמתואר כ"קיים" הוא תיאור נאמן של הקוד/קבצי המקור **כפי שהם היום**, לא
יכולת חדשה.

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
commissionsNis               = guaranteeCommissionNis + unusedCreditCommissionNis + accountOpeningCommissionNis
```

קירוב **סטטי, לא תלוי-זמן**. הנוסחה הזו **נשארת בדיוק כפי שהיא** - `computeProject`/`ProjectResult` לא משתנים
בשלב התכנון או בתחילת שלב היישום (ר' §10 מפת תאימות). **חשוב לשלב 4 להלן**: `commissionsNis` (כולל
`accountOpeningCommissionNis`) הוא סכום **נפרד** מ-`indirectNis`/`directConstructionNis`/`landNis` כבר היום -
לא נכלל ב"סה"כ הוצאות תפעוליות".

**סטייה קיימת מהמקור, לא נוצרה היום**: `purchaseGroup` מקבלת כרגע את אותה נוסחת מימון/ערבות/אי-ניצול כמו כל
סוג עסקה אחר. לפי 03-קבוצת-רכישה.md, בתרחיש הבסיס שלושתן אמורות להיות אפס. תיקון מתוכנן **רק** במנוע התזרים
החדש, לא ב-`computeCosts` הקיים.

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

`costTimingOverrides` לא יכול להתבסס על `keyof CostInputs` (קרקע נמצאת ב-`LandInputs` נפרד, וחלק מהסעיפים הם
ערכים **מחושבים**, לא שדה קלט גולמי). מוגדר טיפוס עצמאי, `CashFlowCostItemId`:

```ts
type CashFlowCostItemId =
  // קרקע (מ-LandInputs, לא מ-CostInputs)
  | "landPurchase" | "bettermentLevy"
  // עקיפות
  | "brokerage" | "purchaseTax" | "electricConnection" | "planningFlat"
  | "planningConsultants" | "engineeringInspection" | "marketing" | "legal"
  | "legalRefund" | "financialSupervision" | "overhead" | "managementFee"
  | "contingency" | "municipalFees" | "organizerFee" | "relocationRent"
  // בנייה ישירה, מפורק לפי קטגוריה - מעורב שימושים דורש עקומות נפרדות בפועל (04-מעורב.md)
  | "demolition" | "constructionResidential" | "constructionResidentialPremium"
  | "constructionCommercial" | "constructionOffice" | "constructionPublicBuilding"
  | "constructionExistingStructure" | "constructionUnderground" | "constructionDevelopment"
  // עמלת מימון חד-פעמית, שכן ניתנת לתזמון חיצוני (בשונה מערבויות/ריבית/אי-ניצול, ר' §4)
  | "accountOpeningCommission";
```

**במפורש לא כלול**: `guaranteeCommission*`, `unusedCreditCommission`, `interest`. אלה תוצרים של הלולאה
החודשית עצמה (§4), מחושבים מחדש בכל חודש - אין להם `timingRule` חיצוני.

טבלת ה-`timingRule` המוצע:

| `CashFlowCostItemId` | מקור בתוצאת המנוע הקיים | `timingRule` |
|---|---|---|
| `landPurchase` | `LandInputs.landPurchaseNis` | `landPurchaseMonth` |
| `bettermentLevy` | `LandInputs.bettermentLevyNis` | `requiresProjectAgreement` |
| `brokerage` | `landNis * brokerageRate` | `landPurchaseMonth` |
| `purchaseTax` | `purchaseTaxBasis * purchaseTaxRate` | `landPurchaseMonth` |
| `electricConnection` | `unitCount * electricConnectionPerUnitNis` | `preCompletion` |
| `planningFlat` | `CostInputs.planningFlatNis` | `constructionStart` |
| `planningConsultants` | `directConstructionNis * planningConsultantsRate` | `spreadOverConstruction` |
| `engineeringInspection` | `CostInputs.engineeringInspectionFlatNis` | `spreadOverConstruction` |
| `marketing` | `developerRevenueExclVatNis * marketingRate` | `salesCurve` |
| `legal` | `developerRevenueExclVatNis * VAT_FACTOR * legalRate` | `salesCurve` |
| `legalRefund` | `unitCount * legalRefundPerUnitNis` | `salesCurve` |
| `financialSupervision` | `CostInputs.financialSupervisionFlatNis` | `spreadOverEscort` |
| `overhead` | `directConstructionNis * overheadRate` | `spreadOverConstruction` |
| `managementFee` | `directConstructionNis * managementFeeRate` | `spreadOverConstruction` |
| `contingency` | `directConstructionNis * contingencyRate` | `spreadOverConstruction` |
| `municipalFees` | `computeMunicipalFees(...)` | `permitMonth` |
| `organizerFee` | `CostInputs.organizerFeeNis` | `landPurchaseMonth` |
| `relocationRent` | `relocationUnitsCount*relocationMonths*rate` | `spreadOverRelocation` |
| `demolition` | `CostInputs.demolitionFlatNis` | `constructionStart` |
| `construction*` (8 מזהים) | `ConstructionCostRow`/`costPerSqmByCategory` | `spreadOverConstruction`, לפי עקומת הבנייה (§7) |
| `accountOpeningCommission` | `developerRevenueExclVatNis*1.17*accountOpeningCommissionRate` | `escortStart` |

### 2.1 שתי התאמות נפרדות לתרחיש הבסיס (תוקן - הייתה שגויה בגרסה הקודמת)

הגרסה הקודמת דרשה שסכום **כל** סעיפי `CashFlowCostItemId` (כולל `accountOpeningCommission`) יתאים בדיוק
ל-`indirectNis+directConstructionNis+landNis` - אבל `accountOpeningCommissionNis` הוא חלק מ-`commissionsNis`
הקיים, **לא** מהשלושה האלה (ר' §0). זו הייתה דרישת ולידציה שגויה מבנית, לא ניתן לתקן אותה בלי לפצל אותה.
**תוקן לשתי התאמות נפרדות:**

```ts
interface CashFlowReconciliation {
  scheduledOperatingCostsNis: number;     // סכום כל CashFlowCostItemId פרט ל-accountOpeningCommission
  baseOperatingCostsNis: number;          // = indirectNis + directConstructionNis + landNis (מהמנוע הקיים)
  accountOpeningCommissionNis: number;    // מתוזמן בנפרד, לא חלק מההתאמה התפעולית
  totalGuaranteeCommissionsNis: number;   // סכום כל הערבויות שחושבו בפועל בתזרים
  totalUnusedCreditCommissionNis: number; // סכום עמלות אי-הניצול שחושבו בתזרים
  totalInterestNis: number;               // סכום הריבית שחושבה בתזרים
  operatingCostDifferenceNis: number;     // scheduledOperatingCostsNis - baseOperatingCostsNis, אמור להיות ≈0
}
```

**ההתאמה מול תרחיש הבסיס נדרשת רק על `scheduledOperatingCostsNis` מול `baseOperatingCostsNis`** (עלויות
תפעוליות בלבד). **אין** דרישה שסך עלויות המימון החדשות (ריבית+ערבויות+אי-ניצול+פתיחת תיק, מחושבות חודש-אחר-חודש)
יהיה זהה לקירוב הסטטי הישן (`financingNis`/`commissionsNis` של המנוע הקיים) - זה בדיוק מה שדור 2 בא **לתקן**,
לא לשחזר.

---

## 3. לוח תקבולים ומכירות

### 3.1 שני דגמים, לא במעמד שווה

- **ברירת המחדל החדשה לדוחות חדשים**: `explicitSchedule` - לוח תקבולים מפורש וניתן לעריכה. **`preset`
  התחלתי בלבד, לא דרישה**: 15% בחתימה / 70% פרוס על הביצוע / 15% במסירה - **הנחת ברירת מחדל עסקית, לא דרישת
  חוק המכר.** חוזה מכר ספציפי גובר תמיד.
- **`legacyConstructionLinked`**: הדגם המקורי מ-01-תמא-38.md, נשמר **אך ורק** לתאימות/שחזור מול קבצי המקור.
  **דוחות חדשים לעולם לא ייבחרו בו כברירת מחדל.**

### 3.2 טיפוס תזמון תשלום - יחידת `fraction`, לא `percent` (תוקן)

הגרסה הקודמת השתמשה ב-`percent` (ערכים כמו 15/70/15), בעוד שכל שאר המנוע (`guaranteeCommissionRate`,
`marketingRate` וכו') שומר שיעורים כשבר 0-1. סיכון ממשי לטעות פי 100. **תוקן**:

```ts
type PaymentTiming =
  | { kind: "relativeToSale"; monthsAfterSale: number }
  | { kind: "projectMonth"; monthIndex: number }
  | { kind: "evenSpread"; fromMonthsAfterSale: number; toMonthsAfterSale: number }
  | { kind: "constructionProgress"; cumulativeProgress: number }   // לצורך legacyConstructionLinked בלבד
  | { kind: "handover" };

interface PaymentTranche {
  fraction: number;     // 0-1, לא מצטבר. סכום כל המנות של אותה קטגוריה = 1 בדיוק
  timing: PaymentTiming;
  label: string;        // לתצוגה בלבד
}
```

**ולידציה נדרשת**: כל `fraction` סופי (`Number.isFinite`) ובטווח [0,1]; סכום כל ה-`fraction` בקטגוריה קרוב ל-1
בסבילות מספרית מוגדרת (למשל `1e-6`, לא שוויון מדויק בגלל floating point); בדיקה מפורשת שאין ערך כמו `15`
במקום `0.15` (למשל: דחיית כל `fraction > 1` בשלב הולידציה, כדי לתפוס בדיוק את הטעות הזו).

### 3.3 דוגמה: תרגום preset 15/70/15 לחודשי תקבול בפועל (מתוקנת ליחידת fraction)

פרויקט עם `constructionMonths=24`, יחידה שנמכרה ב-`saleMonth=3`:

```ts
[
  { fraction: 0.15, timing: { kind: "relativeToSale", monthsAfterSale: 0 }, label: "בחתימה" },       // חודש 3
  { fraction: 0.70, timing: { kind: "evenSpread", fromMonthsAfterSale: 1, toMonthsAfterSale: 21 }, label: "בהתקדמות" }, // חודשים 4-24
  { fraction: 0.15, timing: { kind: "handover" }, label: "במסירה" },                                  // חודש 24
]
```

### 3.4 הבחנות שכבר מתועדות במקור (04-מעורב.md §4.2), נשמרות

| קטגוריה | preset |
|---|---|
| מגורים למכירה | `explicitSchedule` (ברירת מחדל 0.15/0.70/0.15) |
| מסחר | הכל `handover` בלבד, אין תשלומים מקדימים |
| משרדים | כמו מגורים |
| יחידות תמורה (`isCompensationUnit`) | אין תקבול בשום שיטה |
| קבוצת רכישה | תשלומי חברים לפי התקדמות, מנגנון נפרד מהמודל הזה |

---

## 4. הון עצמי, אשראי, ומסגרת - waterfall מלא (תוקן שוב: חריגה ממסגרת + מעגליות עמלת אי-ניצול)

### 4.1 מסגרת האשראי - הוגדרה ונאכפת (הייתה חסרה לגמרי)

```ts
creditFacilityLimitNis: number | "auto";
```

**החלטה סופית לגרסה הראשונה** (לא נשאר פתוח): **פרויקט אמיתי מחייב מסגרת מפורשת** (קלט מהסכם הליווי בפועל).
`"auto"` **מותר רק בתרחישי דמו/דוגמה**, ומחושב **לפני** הרצת מנוע התזרים (לא נגזר משיא החוב של אותה ריצה עצמה
- זה היה יוצר מצב שבו עמלת אי-הניצול תמיד קרובה ל-0), מתוך הקירוב הסטטי הקיים היום:

```
autoFacilityNis = creditFacilityNis(מהמנוע הקיים, computeCosts) * (1 + מרווח קבוע ומתועד, למשל 15%)
```

עם אזהרה גלויה שזו הערכה בלבד, לא מסגרת אמיתית מהבנק. `purchaseGroup` (preset ברירת מחדל): `0`.

### 4.2 Waterfall חודשי מלא (תוקן: אכיפת מסגרת, בלי המצאת כסף)

```
1. openingCashBalanceNis[m] = closingCashBalanceNis[m-1]        (0 בחודש הראשון)
   openingDebtBalanceNis[m] = closingDebtBalanceNis[m-1]         (0 בחודש הראשון)

2. unusedFacilityForCommissionNis[m] = max(0, creditFacilityLimitNisUsed - openingDebtBalanceNis[m])
   unusedCreditCommissionNis[m]      = unusedFacilityForCommissionNis[m] * unusedCreditCommissionRate/12
   ← מבוסס על יתרת הפתיחה (openingDebtBalanceNis), לפני משיכה/פירעון של אותו חודש - פותר מעגליות
   (עמלה→מחסור→משיכה→יתרה מנוצלת→עמלה חדשה). ר' 4.4.

3. operatingInflowsNis[m]   = תקבולים תפעוליים (§3)
4. operatingOutflowsNis[m]  = תשלומים תפעוליים מתוזמנים (§2) + guaranteeCommissionNis[m] (§6) + unusedCreditCommissionNis[m] (משלב 2)
   cashBeforeFinancing[m]   = openingCashBalanceNis[m] + operatingInflowsNis[m] - operatingOutflowsNis[m]

5. אם cashBeforeFinancing[m] < minimumCashBalanceNis:
       shortfall             = minimumCashBalanceNis - cashBeforeFinancing[m]
       equityInjectionNis[m] = min(shortfall, equityCapNis - הון עצמי שהוזרם עד כה)
   אחרת: equityInjectionNis[m] = 0, shortfall = 0

6. remainingShortfall[m]      = max(0, shortfall - equityInjectionNis[m])
   availableFacilityNis[m]    = max(0, creditFacilityLimitNisUsed - openingDebtBalanceNis[m])   ← נאכף בפועל
   creditDrawNis[m]           = min(remainingShortfall[m], availableFacilityNis[m])
   fundingShortfallNis[m]     = max(0, remainingShortfall[m] - creditDrawNis[m])
   ← אם המסגרת לא מספיקה, לא ממציאים כסף: fundingShortfallNis > 0, isComplete=false, אזהרה מפורשת (ר' 4.5)
   cashAfterDraw[m]           = cashBeforeFinancing[m] + equityInjectionNis[m] + creditDrawNis[m]

7. closingDebtBeforeInterestNis[m] = openingDebtBalanceNis[m] + creditDrawNis[m]
   surplus                        = max(0, cashAfterDraw[m] - minimumCashBalanceNis)
   creditRepaymentNis[m]          = min(surplus, closingDebtBeforeInterestNis[m])
   closingDebtBeforeInterestAfterRepaymentNis[m] = closingDebtBeforeInterestNis[m] - creditRepaymentNis[m]

8. interestNis[m] = (annualInterestRate/12) * closingDebtBeforeInterestAfterRepaymentNis[m]
   ← על היתרה אחרי משיכה/פירעון, לפני הוספת הריבית עצמה - אין מעגליות (ר' 4.4)
   מדיניות ברירת מחדל: הריבית מצטרפת ליתרת החוב (מהוונת), לא יוצאת כמזומן החודש

9. closingDebtBalanceNis[m] = closingDebtBeforeInterestAfterRepaymentNis[m] + interestNis[m]
   closingCashBalanceNis[m] = cashAfterDraw[m] - creditRepaymentNis[m]
```

### 4.3 חריגה ממסגרת אשראי - לא ממציאים כסף (חדש)

כשה`fundingShortfallNis[m] > 0` (המסגרת לא מספיקה לכסות את הצורך אחרי הון עצמי): **נבחרה שיטת "שורת deficit
מפורשת"**, לא הרשאת יתרת מזומן שלילית. כלומר `closingCashBalanceNis` **לא** יורד מתחת ל-`minimumCashBalanceNis`
באופן מלאכותי - `fundingShortfallNis` עצמו הוא האינדיקציה המפורשת לכשל, שדה נפרד וברור, לא "מוסתר" בתוך יתרת
מזומן שלילית שיכולה להתבלבל עם באג. כשקיים `fundingShortfallNis > 0` בכל חודש כלשהו: `CashFlowResult.isComplete
= false`, ומתווספת אזהרה מפורשת ("הפרויקט אינו בר-מימון במסגרת שהוגדרה, חודש X חסר Y ₪").

### 4.4 בסיס הריבית ובסיס עמלת אי-הניצול - שני מעגלים שונים, שני פתרונות

```ts
type InterestBalanceBasis = "closingDebtBeforeInterest" | "averageOpeningAndPreInterestClosing";
type UnusedCreditCommissionBalanceBasis = "openingDebt";  // יחיד בגרסה הראשונה, ר' למטה
```

- **ריבית**: מחושבת על `closingDebtBeforeInterestAfterRepaymentNis[m]` (אחרי משיכה/פירעון של אותו חודש, לפני
  הריבית עצמה) - ר' שלב 8 למעלה. פותרת מעגליות "יתרה→ריבית→אשראי→יתרה חדשה".
- **עמלת אי-ניצול**: מעגליות **שונה** - אם מחושבת על היתרה **אחרי** משיכת החודש, נוצר מעגל "עמלה→מחסור→משיכה→
  יתרה מנוצלת→עמלה חדשה". **תוקן**: מחושבת על `openingDebtBalanceNis[m]` (יתרת **פתיחת** החודש, לפני כל
  פעילות של אותו חודש עצמו) - ר' שלב 2 למעלה. `unusedCreditCommissionBalanceBasis: "openingDebt"` הוא הערך
  היחיד הנתמך בגרסה הראשונה; בסיס ממוצע מתוכנן כאפשרות עתידית, **רק אם יש פתרון מפורש למעגליות שלו**, לא
  יושם סתם.

הבחירה בפועל מוצגת בדוח דרך `financing.interestBalanceBasisUsed` ו-`financing.unusedCreditCommissionBalanceBasisUsed`
- לעולם לא נסתרת.

### 4.5 הזרמת הון עצמי

**ברירת מחדל `asNeededUpToCap`**: מוזרם רק כשנדרש (שלב 5), עד לתקרה `equityCapNis`. **לא** מוזרם כולו בחודש
הראשון בלי קשר לצורך, ולא נפרס שווה בשווה. `proRata` מתוכננת כאפשרות עתידית, לא ברירת מחדל.

### 4.6 דוגמה מספרית של חודש אחד (מוכיחה את משוואת המאזן, כולל אכיפת מסגרת)

נתונים: `openingCashBalanceNis=0`, `openingDebtBalanceNis=1,000,000`, `creditFacilityLimitNisUsed=1,200,000`,
תקבולים `100,000`, תשלומים תפעוליים (לא כולל עמלות מימון) `400,000`, `minimumCashBalanceNis=0`, הון עצמי מוצה
במלואו, ריבית שנתית `6%` (חודשי `0.5%`), `unusedCreditCommissionRate` שנתי `0.35%` (חודשי `≈0.0292%`).

```
unusedFacilityForCommission = max(0, 1,200,000 - 1,000,000) = 200,000
unusedCreditCommissionNis   = 200,000 * 0.0292% ≈ 58

operatingOutflows = 400,000 + guaranteeCommission(נניח 0, לצורך הפשטות) + 58 = 400,058
cashBeforeFinancing = 0 + 100,000 - 400,058 = -300,058
shortfall            = 300,058
equityInjection      = 0   (התקרה מוצתה)
remainingShortfall    = 300,058
availableFacility     = max(0, 1,200,000 - 1,000,000) = 200,000
creditDraw            = min(300,058, 200,000) = 200,000        ← נאכף! לא 300,058
fundingShortfall       = max(0, 300,058 - 200,000) = 100,058    ← המסגרת לא הספיקה, כשל מימון גלוי
cashAfterDraw          = -300,058 + 0 + 200,000 = -100,058

closingDebtBeforeInterest = 1,000,000 + 200,000 = 1,200,000
surplus                   = max(0, -100,058-0) = 0  →  repayment = 0
interest                  = 0.5% * 1,200,000 = 6,000
closingDebtBalance         = 1,200,000 + 6,000 = 1,206,000
closingCashBalance         = -100,058 - 0 = -100,058
```

**הערה חשובה**: בדוגמה הזו `closingCashBalanceNis` יצא שלילי (-100,058) **למרות** ההחלטה ב-4.3 "לא להרשות
מזומן שלילי מלאכותית" - כי `fundingShortfallNis` (100,058) **הוא בדיוק** ההסבר לפער: יתרת המזומן השלילית כאן
**אינה** תוצאה מלאכותית, היא השיקוף החשבונאי הישיר של `fundingShortfallNis` שכבר דווח בנפרד ומפורשות. שני
השדות מתלכדים במספר (לא סתירה) - `fundingShortfallNis` הוא הדגל שמסביר *למה* המזומן שלילי, לא מנגנון נפרד
שמונע ממנו להיות שלילי. מתועד כך במפורש כדי לא להטעות.

**בדיקת מאזן**: מקורות (openingCash 0 + inflows 100,000 + equity 0 + creditDraw 200,000) = 300,000 = שימושים
(outflows 400,058 + repayment 0 + Δcash(-100,058-0)) = 400,058-100,058 = 300,000 ✓.

---

## 5. קבוצת רכישה: preset ברירת מחדל, לא הכרעה קבועה בקוד

```ts
const PURCHASE_GROUP_DEFAULT_PRESET: Partial<CashFlowAssumptions> = {
  creditFacilityLimitNis: 0,
  guarantees: [],
};
```

**preset ברירת מחדל בלבד** - ניתן לדריסה מלאה. **אזהרה מקצועית**: הסיווג לצורך חוק המכר תלוי במהות העסקה
בפועל, לא בשם. לפי הנחיית משרד הבינוי והשיכון, קבוצת רכישה אמיתית בדרך כלל אינה כפופה לחובות חוק המכר של
יזם מוכר, אך פרויקט **המכונה** "קבוצת רכישה" כשבפועל מדובר במכר דירות לציבור עלול להיחשב חייב בחובות אלה על
אף השם. **אין להסתמך על תיוג `dealType` בלבד.**

תאימות: שינוי ה-preset קורה **רק** במנוע התזרים החדש, לא ב-`computeCosts`/`computeProject` הקיימים.

---

## 6. ערבויות: שלושה מנגנונים נפרדים

**עדכון תיעודי (6-prep)**: הטיפוס למטה תואם עכשיו במדויק את `GuaranteeMechanism` המאושר והמיושם בפועל ב-
`lib/calc/cashflow-types.ts` (`annualRateFraction`/`durationMonths`, לא `ratePct`/`durationYears` כפי שנוסח כאן
בטעות בגרסה קודמת של המסמך - `cashflow-types.ts` הוא מקור האמת, המסמך תוקן בהתאם, לא הקוד).

```ts
type GuaranteeMechanism =
  | { kind: "buyerSaleLaw"; annualRateFraction: number }
  | { kind: "kombinatsiaOwner"; annualRateFraction: number; durationMonths: number }
  | { kind: "unitCompensationOwner"; annualRateFraction: number | "requiresVerification" };
```

`annualRateFraction` הוא **שבר עשרוני שנתי**, אחיד עם שאר המנוע (`PaymentTranche.fraction` וכו'):

```ts
0.0085  // 0.85% - תקין
0.85    // שגוי - זה 85%, לא 0.85%
85      // שגוי - טעות אחוז-במקום-שבר
```

| מנגנון | בסיס | שיעור | משך חשיפה | מקור |
|---|---|---|---|---|
| `buyerSaleLaw` | תקבולי רוכשים זכאים **מצטברים**, כפי שהם מופיעים בפועל בלוח התקבולים (`eligibleBuyerReceiptsNis`) - **לא** הכנסה חשבונאית מוכרת לפי אחוז ביצוע, ולא שווי כל היחידות | 0.85% (evidenced) | דינמי | 01/04/05 |
| `kombinatsiaOwner` | שווי שוק **קבוע** של יחידות הבעלים | 1.0% (evidenced) | מח"מ **קבוע**: 3 שנים | 05 בלבד |
| `unitCompensationOwner` | **שווי דירת התמורה החדשה** | **אין ברירת מחדל** - קלט מפורש או `"requiresVerification"` | ממועד פינוי עד מסירת דירת התמורה והשבת הערבות | לא נמצא במקור |

**חשוב (6-prep)**: הבסיס העדכני של `buyerSaleLaw` (`eligibleBuyerReceiptsNis`) הוחלף מהניסוח הקודם ("הכנסה
מצטברת שהוכרה") ביוזמת המשתמש, כדי להסיר עמימות בין בסיס מזומן (תקבולים בפועל) לבין מושג חשבונאי של הכרה
בהכנסה לפי אחוז ביצוע - שני דברים שונים שעלולים להתפצל מהותית כשלוח התשלומים (למשל 15/70/15) אינו זהה לעקומת
התקדמות הבנייה. **קובץ המקור המקורי (01-תמא-38.md) אינו קיים בריפו הזה** ולא ניתן לאמת ישירות מולו איזה משני
המושגים תואם את החישוב המקורי - זו נקודה שנותרה פתוחה לאימות מול המקור המקורי אם וכאשר הוא יהיה זמין, לא
הוכרעה כאן על סמך ראיה ישירה.

**בסיסי הערבות ומועדי ההתחלה/השחרור אינם חלק מ-`GuaranteeMechanism` ואינם נגזרים ממנו בשקט.** `GuaranteeMechanism`
מכיל רק שיעור (ומשך, עבור `kombinatsiaOwner`) - לא בסיס כספי, לא חודש התחלה, לא חודש שחרור. אלה מתקבלים כקלט
מפורש נפרד לפונקציית לוח הערבויות (`computeGuaranteeSchedule`, §11), לכל מופע מנגנון בנפרד: `eligibleBuyerReceiptsNis`
חודשי לכל חודש (`buyerSaleLaw`), שווי שוק קבוע + חודש התחלה מפורש (`kombinatsiaOwner`), שווי דירת התמורה + חודש
פינוי + חודש מסירת דירת התמורה (`unitCompensationOwner`). אין ברירת מחדל שקטה לאף אחד מהם.

**לא מוחל אוטומטית** `kombinatsiaOwner` על יחידות תמורה בתמ"א/פינוי בינוי. ללא שיעור מפורש: לא מחושב (0),
מסומן ב-`missingAssumptions`. **מתוכננים בנפרד, לא מחושבים בשלב א'**: ערבות שכירות, ערבות מיסים, ערבות רישום.

---

## 7. עקומת הבנייה - union מבחין

```ts
type ConstructionCurveAssumptions =
  | { model: "linear" }
  | { model: "sCurve"; shapeParameter?: number }   // ברירת מחדל חדשה
  | { model: "legacy" }
  | { model: "custom"; cumulativePercentByMonth: number[] };
```

`linear`/`sCurve`/`legacy` מחשבים את הפילוג בזמן ריצה. `custom` הוא היחיד עם מערך קלט. **חייב לסכם בדיוק
ל-100%** בחודש האחרון, בכל המודלים.

---

## 8. DSCR - לא נוסף בשלב זה

DSCR מתאים לנכס עם הכנסה תפעולית שוטפת. בפרויקט הקמה-ומכירה האשראי נפרע בבת אחת מתקבולים. **לא נוסף כברירת
מחדל.** יישקל רק אם ייבנה תרחיש החזקה-והשכרה.

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
  fraction: number;        // 0-1, לא מצטבר
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
type UnusedCreditCommissionBalanceBasis = "openingDebt";
type EquityInjectionMode = "asNeededUpToCap" | "proRata";

// --- ערבויות (§6) ---
type GuaranteeMechanism =
  | { kind: "buyerSaleLaw"; annualRateFraction: number }
  | { kind: "kombinatsiaOwner"; annualRateFraction: number; durationMonths: number }
  | { kind: "unitCompensationOwner"; annualRateFraction: number | "requiresVerification" };

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
  schemaVersion: number;
  salesSchedule: SalesScheduleAssumptions;
  constructionCurve: ConstructionCurveAssumptions;
  interestBalanceBasis: InterestBalanceBasis;                       // ברירת מחדל "closingDebtBeforeInterest"
  unusedCreditCommissionBalanceBasis: UnusedCreditCommissionBalanceBasis; // "openingDebt", יחיד לעת עתה
  equityInjectionMode: EquityInjectionMode;
  equityCapNis: number;
  minimumCashBalanceNis: number;                                     // ברירת מחדל 0
  creditFacilityLimitNis: number | "auto";                           // §4.1 - "auto" רק לדוגמאות
  guarantees: GuaranteeMechanism[];
  costTimingOverrides?: Partial<Record<CashFlowCostItemId, CostTimingRule>>;
}

interface CashFlowMonth {
  monthIndex: number;
  phase: "permit" | "demolition" | "construction" | "marketing" | "handover";

  openingCashBalanceNis: number;
  openingDebtBalanceNis: number;
  closingCashBalanceNis: number;
  closingDebtBalanceNis: number;

  operatingInflowsNis: number;
  operatingOutflowsNis: number;
  equityInjectionNis: number;

  availableFacilityNis: number;      // חדש - מה שנשאר מהמסגרת בפועל, לפני המשיכה
  creditDrawNis: number;
  creditRepaymentNis: number;
  fundingShortfallNis: number;       // חדש - כשל מימון גלוי, לא מומצא כסף

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
  unusedCreditCommissionBalanceBasisUsed: UnusedCreditCommissionBalanceBasis;
  creditFacilityLimitNisUsed: number;
  peakFacilityUtilizationRatio: number | null;
  maximumFundingShortfallNis: number;   // חדש - הכי גדול שחסר בחודש בודד כלשהו, 0 אם אין כשל
  facilityExceeded: boolean;            // חדש - true אם יש חודש כלשהו עם fundingShortfallNis>0
}

interface CashFlowReconciliation {
  scheduledOperatingCostsNis: number;
  baseOperatingCostsNis: number;
  accountOpeningCommissionNis: number;
  totalGuaranteeCommissionsNis: number;
  totalUnusedCreditCommissionNis: number;
  totalInterestNis: number;
  operatingCostDifferenceNis: number;
}

interface CashFlowResult {
  months: CashFlowMonth[];
  financing: FinancingSummary;
  reconciliation: CashFlowReconciliation;
  warnings: string[];
  missingAssumptions: string[];
  isComplete: boolean;   // false אם missingAssumptions לא ריק, או אם facilityExceeded=true
}
```

---

## 10. מפת תאימות לדוחות קיימים

| | היום | אחרי שלב היישום |
|---|---|---|
| `ProjectInputs`/`ProjectResult` | ללא שינוי | **ללא שינוי** |
| `CashFlowAssumptions` | לא קיים | שדה חדש ונפרד לגמרי |
| `computeCashFlow` | לא קיים | פונקציה חדשה ונפרדת, נקראת רק במפורש |
| דוח ישן ב-Supabase | נטען ומחושב היום | ממשיך בדיוק כמו היום |
| אימות מול קבצי המקור | לא רלוונטי | דורש בחירה מפורשת ב-`legacyConstructionLinked`, לא ברירת מחדל |

**מסקנה**: אין סיכון לדוחות קיימים. `computeCashFlow` תוספתי בלבד.

---

## 11. חלוקה מומלצת ל-commits

**המשתמש אישר: מתחילים ב-commit 1 בלבד לעת עתה. commits 2-7 ממתינים לבדיקת diff של commit 1.**

1. **[מאושר להתחלה]** טיפוסים וקבועים (§9) + פונקציות ולידציה (`fraction` בטווח [0,1] וסכום≈1,
   `cumulativePercentByMonth` מסכם 100%, `costTimingOverrides` ללא כפילות) - **ללא** `computeCashFlow`,
   **ללא** שינוי מסכים, **ללא** שינוי לתוצאת `computeProject`.
2. `ConstructionCurveAssumptions` - מימוש `linear`/`sCurve`/`legacy`/`custom`.
3. `SalesScheduleAssumptions` + `PaymentTiming` - preset 0.15/0.70/0.15 + `legacyConstructionLinked`.
4. `computeCashFlow` - ה-waterfall המלא (§4.2), כולל אכיפת מסגרת ו-preset `purchaseGroup`.
5. שכבת הערבויות (§6) + `CashFlowReconciliation` (§2.1).
6. בדיקות vitest לפי §12.
7. חיווט תצוגתי ראשוני, נפרד מהדוח הקיים.

---

## 12. תכנית בדיקות (מעודכנת)

| # | תרחיש | מה מוודאים |
|---|---|---|
| 1-11 | (כבסיס: ללא מכירות, ללא הון עצמי, ממומן כולו בהון עצמי, תקבולים מקדימים, מסגרת נדרשת לאורך הביצוע, פירעון מלא במסירה, יחידות תמורה ללא תקבולים, אפס חודשי בנייה, משך חריג, NaN/Infinity, מאזן חודשי) | ר' גרסה קודמת, ללא שינוי מהותי |
| 12 | עקומת בנייה מסכמת בדיוק 100% | בכל ארבעת המודלים, גם `constructionMonths=1` |
| 13 | `purchaseGroup` preset | מסגרת=0, ערבויות=[] כברירת מחדל, ניתן לדריסה |
| 14 | `legacyConstructionLinked` משחזר את דגם המקור | תוצאה זהה לנוסחת 01-תמא-38.md |
| 15 | `unitCompensationOwner` בלי שיעור | לא מחושב, ב-`missingAssumptions`, `isComplete=false` |
| 16 | `interestBalanceBasisUsed` מוצג נכון | לא נסתר |
| 17 | אין מעגליות ריבית | ריבית מחודש m לא משפיעה על `creditDrawNis[m]` של אותו חודש |
| 18 | `creditFacilityLimitNis="auto"` נגזר מהאומדן הסטטי + מרווח, לא משיא בדיעבד | ר' §4.1 |
| 19 | `PaymentTranche[]` תקין | סך `fraction`≈1 לכל קטגוריה, אין ערך שלילי או `>1`, כל `timing` בתוך ציר הפרויקט |
| 20 | `costTimingOverrides` ללא כפילות/אובדן | `scheduledOperatingCostsNis` = `baseOperatingCostsNis` בדיוק (לא כולל `accountOpeningCommission`) |
| 21 | **חדש**: חריגה ממסגרת אשראי | הון מוצה + מסגרת קטנה מדי → `fundingShortfallNis>0`, `facilityExceeded=true`, `isComplete=false`, לא מומצא כסף, לא זורק |
| 22 | **חדש**: אין מעגליות עמלת אי-ניצול | `unusedCreditCommissionNis[m]` מחושב מ-`openingDebtBalanceNis[m]` בלבד, לא תלוי ב-`creditDrawNis[m]` של אותו חודש |
| 23 | **חדש**: `CashFlowReconciliation` נכון | `operatingCostDifferenceNis≈0`; `accountOpeningCommissionNis`/ערבויות/ריבית/אי-ניצול **לא** נדרשים להיות שווים לקירוב הישן |

---

## סיכום עבור אישור פתיחת ענף יישום

**סטטוס: מסמך זה מאושר (גרסה 4). מאושר לפתוח ענף יישום, אך ורק ל-commit 1 (טיפוסים+ולידציה) בשלב זה.**

תיקוני הסבב השלישי: `PaymentTranche.fraction` (0-1) במקום `percent`; אכיפת מסגרת אשראי בפועל
(`availableFacilityNis`/`fundingShortfallNis`, לא המצאת כסף); בסיס נפרד ולא-מעגלי לעמלת אי-ניצול
(`openingDebt`); שתי התאמות נפרדות לתרחיש הבסיס (`CashFlowReconciliation`, לא דרישת שוויון שגויה שכללה את
`accountOpeningCommission` בטעות); החלטה סופית ל-`"auto"` (רק דוגמאות, נגזר מהקירוב הסטטי הקיים + מרווח
מתועד, לא משיא בדיעבד).

**כשל מימון**: נבחרה שיטת "שורת deficit מפורשת" (`fundingShortfallNis`) - יתרת המזומן יכולה לצאת שלילית
בפועל, אבל זה **תוצאה חשבונאית ישירה** של `fundingShortfallNis` שכבר דווח, לא מנגנון סמוי. מתועד בדוגמה
המספרית ב-§4.6.

הנחות שעדיין דורשות אימות מקצועי, ללא שינוי מהגרסה הקודמת: `bettermentLevy` (עיתוי תלוי-פרויקט), שיעור
`unitCompensationOwner`, `averageOpeningAndPreInterestClosing` (ייתכן שלא ייושם), נוסחת ה-S-curve המדויקת.
