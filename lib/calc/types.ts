// טיפוסי הליבה של מנוע החישוב.
// מבוסס על מפרט הנוסחאות ב-Dropbox/2026/קלוד קוד - מיזמים/דוחות אפס/מפרט נוסחאות/
// שבעה מסלולים: כולם חולקים את אותה שרשרת ליבה (שטחים -> עלויות -> הכנסות -> מימון -> רווחיות).
// שלוש קבוצות מבחינת הנוסחה (ר' engine.ts):
//  - tama38/basic: קרקע במזומן, קלט ישיר.
//  - kombinatsia/pinuyBinui/kombinatsiaTemurot: קרקע באחוז חלוקה (הבדל היחיד ביניהם: בקומבינצית
//    תמורות שדה "שווי הקרקע לצורך מס רכישה" מייצג את מלוא שווי הקרקע, לא רק חלק היזם, ר' 06-קומבינצית-תמורות.md).
//  - purchaseGroup: כמו tama38/basic, אבל הפלט מתפרש כ"חיסכון לחברי הקבוצה" ולא "רווח יזם",
//    ומתווספת שכבת שכר מארגן נפרדת. mixedUse: כמו kombinatsia, אבל עם יחידות משלוש קטגוריות
//    (מגורים/מסחר/משרדים) שכל אחת נבדלת בטיפול במע"מ ובעלות בנייה, ר' UnitType.category.

export type DealType =
  | "tama38"
  | "basic"
  | "kombinatsia"
  | "pinuyBinui"
  | "kombinatsiaTemurot"
  | "purchaseGroup"
  | "mixedUse";

export type UnitCategory = "residential" | "commercial" | "office";

export interface UnitType {
  /** שם חופשי, למשל "דירת 4 חדרים" */
  name: string;
  /** מספר יחידות מהסוג הזה */
  count: number;
  /** שטח עיקרי ליחידה, מ"ר */
  areaSqm: number;
  /** ממ"ד ליחידה, מ"ר (0 אם לא רלוונטי) */
  mamadSqm: number;
  /** מרפסת רגילה ליחידה, מ"ר */
  balconySqm: number;
  /** מרפסת גג ליחידה, מ"ר (בדרך כלל 0 מלבד פנטהאוזים) */
  roofBalconySqm: number;
  /**
   * מחיר ליחידה, ₪. המשתמש מזין ישירות (מודול 03: הכנסות מוזנות ידנית).
   * מגורים: כולל מע"מ (מחולק ב-1.17). מסחר/משרדים: נטו ממע"מ, ללא חלוקה (ר' 04-מעורב-מגורים-ותעסוקה.md).
   */
  priceNis: number;
  /** קטגוריה, לצורך טיפול במע"מ ועלות בנייה נפרדת. ברירת מחדל residential אם לא מוגדר. */
  category?: UnitCategory;
}

export interface CostInputs {
  /** מקדם משקל למרפסות בחישוב שטח לשיווק (ברירת מחדל 0.5, כמו בכל תחשיבי המקור) */
  balconyWeight: number;
  /** עלות בנייה למ"ר, שטח עיקרי מגורים. ברירת מחדל מאומדן הלשכה (מודול 02) */
  mainConstructionCostPerSqm: number;
  /** עלות בנייה למ"ר מסחר, רלוונטי רק ל-mixedUse. אם 0, נופל חזרה למחיר המגורים */
  commercialConstructionCostPerSqm: number;
  /** עלות בנייה למ"ר משרדים, רלוונטי רק ל-mixedUse. אם 0, נופל חזרה למחיר המגורים */
  officeConstructionCostPerSqm: number;
  /** עלות בנייה למ"ר תת קרקעי/מרתף. ברירת מחדל מאומדן הלשכה */
  undergroundConstructionCostPerSqm: number;
  /** יחס עלות מרפסות מעלות השטח העיקרי (טווח הלשכה: 30%-50%, ברירת מחדל 50% כמו במקור) */
  balconyConstructionCostRatio: number;
  /** עלות פיתוח צמוד למ"ר */
  developmentCostPerSqm: number;
  /** שטח מרתף/חניה, מ"ר */
  undergroundAreaSqm: number;
  /** שטח מגרש נטו, מ"ר, לחישוב פיתוח */
  netPlotAreaSqm: number;
  /** הריסה ופינוי, סכום קבוע, ₪ (רלוונטי בעיקר לתמ"א 38, 0 בבנייה חדשה) */
  demolitionFlatNis: number;

  /** אגרות והיטלים עירוניים, סכום כולל שהמשתמש מזין (מודול 02: תלוי רשות מקומית) */
  municipalFeesNis: number;

  // עלויות עקיפות, אחוזים/סכומים ניתנים לעריכה. ברירות מחדל מתוך תחשיבי המקור.
  brokerageRate: number; // תיווך, % מעלות/תמורת הקרקע
  purchaseTaxRate: number; // מס רכישה, % (ברירת מחדל 6%)
  electricConnectionPerUnitNis: number; // חיבור חשמל ליח"ד
  planningFlatNis: number; // תכנון ומדידות, סכום קבוע
  /** תכנון ויועצים, % מעלות בנייה ישירה (2.5% במקור, "עלויות!A12" בקבצי המקור) */
  planningConsultantsRate: number;
  /** פיקוח הנדסי, סכום קבוע, ₪. שדה נפרד מ"תכנון ויועצים" (במקור: שכר חודשי למפקח × תקופת הבנייה) */
  engineeringInspectionFlatNis: number;
  marketingRate: number; // שיווק ופרסום, % מהכנסות
  legalRate: number; // משפטי, % מהכנסות כולל מע"מ
  legalRefundPerUnitNis: number; // החזר שכ"ט עו"ד ליח"ד (שלילי בדרך כלל)
  financialSupervisionFlatNis: number; // פיקוח פיננסי (ליווי בנקאי), סכום קבוע
  overheadRate: number; // תקורות הנהלה וכלליות, % מעלות בנייה
  /** דמי ניהול וניהול כספי, % מעלות בנייה. סעיף נפרד מתקורות הנהלה ומפיקוח פיננסי (6% במקור, "דוגמא.xlsx") */
  managementFeeRate: number;
  contingencyRate: number; // בצ"מ, % מעלות בנייה

  // עמלות מימון (מפושט, ר' הערה במנוע)
  guaranteeCommissionRate: number; // עמלת ערבות חוק מכר, % מהכנסות
  unusedCreditCommissionRate: number; // עמלת אי ניצול אשראי, % ממסגרת האשראי

  // מימון
  annualInterestRate: number; // ריבית שנתית, %
  constructionMonths: number; // משך תקופת הבנייה, חודשים
  permitMonths: number; // משך התקופה עד היתר, חודשים
  equityNis: number; // הון עצמי מושקע
  presaleRate: number; // אחוז מכירה מוקדמת (פרי-סייל)

  /** שכר המארגן בקבוצת רכישה, סכום קבוע, ₪. נוסף לעלויות העקיפות, מוצג גם בנפרד. 0 בשאר סוגי העסקה */
  organizerFeeNis: number;
}

export interface LandInputs {
  /** תמ"א 38: רכישת קרקע במזומן, ₪. לא רלוונטי לקומבינציה */
  landPurchaseNis: number;
  /** תמ"א 38: היטל השבחה בגין הקלות, ₪ */
  bettermentLevyNis: number;

  /** קומבינציה: אחוז השטח שחוזר לבעל הקרקע כתמורה בעין (למשל 0.4) */
  combinationOwnerShare: number;
  /** קומבינציה: שווי קרקע מוערך למ"ר/יח"ד, לצורך חישוב מס רכישה על חלק היזם בלבד */
  combinationLandValueForTaxNis: number;
}

export interface ProjectInputs {
  dealType: DealType;
  projectName: string;
  units: UnitType[];
  costs: CostInputs;
  land: LandInputs;
}

export interface AreaSummary {
  totalMainAreaSqm: number;
  totalMamadSqm: number;
  totalBalconySqm: number;
  totalRoofBalconySqm: number;
  /** שטח לשיווק = עיקרי + ממ"ד + (מרפסות * מקדם משקל) */
  totalMarketableAreaSqm: number;
  unitCount: number;
  /** פילוח שטח עיקרי + מרפסות/ממ"ד לפי קטגוריה, לחישוב עלות בנייה נפרדת ב-mixedUse */
  areaByCategory: Record<UnitCategory, { mainAreaSqm: number; otherAreaSqm: number }>;
}

export interface RevenueSummary {
  /** סה"כ הכנסה כולל מע"מ, ₪, לפי כל היחידות (100% מהבניין) */
  totalRevenueInclVatNis: number;
  /** סה"כ הכנסה לא כולל מע"מ, ₪ */
  totalRevenueExclVatNis: number;
  /** חלק היזם מההכנסה לא כולל מע"מ (100% בתמ"א 38, לפי חלק היזם בקומבינציה) */
  developerRevenueExclVatNis: number;
  averagePricePerSqmNis: number;
}

export interface CostBreakdown {
  landNis: number;
  indirectNis: number;
  commissionsNis: number;
  directConstructionNis: number;
  financingNis: number;
  totalExclFinancingNis: number;
  totalInclFinancingNis: number;
  /** שכר המארגן בקבוצת רכישה, כבר כלול ב-indirectNis, מוצג כאן גם בנפרד לתצוגה */
  organizerFeeNis: number;
}

export interface ProfitabilitySummary {
  revenueNis: number;
  totalCostNis: number;
  currentProfitNis: number;
  /** רווח לעלות, % */
  profitToCostRatio: number;
}

export interface ProjectResult {
  areas: AreaSummary;
  revenue: RevenueSummary;
  costs: CostBreakdown;
  profitability: ProfitabilitySummary;
  warnings: string[];
}
