// טיפוסי הליבה של מנוע החישוב.
// מבוסס על מפרט הנוסחאות ב-Dropbox/2026/קלוד קוד - מיזמים/דוחות אפס/מפרט נוסחאות/
// ארבעה מסלולים בשלב זה: כולם חולקים את אותה שרשרת ליבה (שטחים -> עלויות -> הכנסות -> מימון
// -> רווחיות), ונבדלים באופן חישוב תמורת הקרקע וההכנסות. שני זוגות תאומים מבחינת הנוסחה:
// tama38/basic (קרקע במזומן, קלט ישיר) ו-kombinatsia/pinuyBinui (קרקע באחוז חלוקה, ר' engine.ts).

export type DealType = "tama38" | "basic" | "kombinatsia" | "pinuyBinui";

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
  /** מחיר ליחידה, כולל מע"מ, ₪. המשתמש מזין ישירות (מודול 03: הכנסות מוזנות ידנית) */
  priceNis: number;
}

export interface CostInputs {
  /** מקדם משקל למרפסות בחישוב שטח לשיווק (ברירת מחדל 0.5, כמו בכל תחשיבי המקור) */
  balconyWeight: number;
  /** עלות בנייה למ"ר, שטח עיקרי. ברירת מחדל מאומדן הלשכה (מודול 02) */
  mainConstructionCostPerSqm: number;
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
  engineeringSupervisionRate: number; // פיקוח הנדסי, % מעלות בנייה ישירה
  marketingRate: number; // שיווק ופרסום, % מהכנסות
  legalRate: number; // משפטי, % מהכנסות כולל מע"מ
  legalRefundPerUnitNis: number; // החזר שכ"ט עו"ד ליח"ד (שלילי בדרך כלל)
  financialSupervisionFlatNis: number; // פיקוח פיננסי, סכום קבוע
  overheadRate: number; // תקורות הנהלה, % מעלות בנייה
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
