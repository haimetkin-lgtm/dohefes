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

/**
 * residential=מגורים "רגיל" (בפינוי בינוי: דירות תמורה לדיירים קיימים), residentialPremium=מגורים
 * ברמת גימור/מחיר גבוהים יותר (בפינוי בינוי: דירות למכירה). שתיהן מגורים לצורך מע"מ, שונות רק
 * בעלות הבנייה למ"ר. commercial/office כרגיל. publicBuilding=מבנה ציבור (מב"צ) שהיזם בונה ומוסר
 * לרשות המקומית ללא תמורה (ר' 04-מעורב-מגורים-ותעסוקה.md) - יש לו עלות בנייה משלו אך המחיר
 * ליחידה תמיד 0, אין הכנסה כלל. קיים כאפשרות בכל סוג עסקה שתומך בפילוח קטגוריות, לא רק מעורב.
 */
export type UnitCategory = "residential" | "residentialPremium" | "commercial" | "office" | "publicBuilding";

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
  /**
   * יחידת תמורה: ניתנת בחינם לדייר קיים תמורת דירתו הישנה (תמ"א 38 הריסה ובנייה מחדש/פינוי בינוי
   * בלבד, ר' engine.ts landMechanism). ההכנסה ממנה לא נספרת כהכנסת היזם, גם שהמחיר מוזן לצורך
   * חישוב שווי הבניין הכולל. false/undefined = יחידה רגילה שהיזם מוכר.
   */
  isCompensationUnit?: boolean;
}

export interface CostInputs {
  /** מקדם משקל למרפסות בחישוב שטח לשיווק (ברירת מחדל 0.5, כמו בכל תחשיבי המקור) */
  balconyWeight: number;
  /** עלות בנייה למ"ר, שטח עיקרי מגורים. ברירת מחדל מאומדן הלשכה (מודול 02) */
  mainConstructionCostPerSqm: number;
  /** עלות בנייה למ"ר מגורים פרימיום (residentialPremium). אם 0, נופל חזרה למחיר המגורים הרגיל */
  premiumConstructionCostPerSqm: number;
  /** עלות בנייה למ"ר מסחר, רלוונטי רק ל-mixedUse. אם 0, נופל חזרה למחיר המגורים */
  commercialConstructionCostPerSqm: number;
  /** עלות בנייה למ"ר משרדים, רלוונטי רק ל-mixedUse. אם 0, נופל חזרה למחיר המגורים */
  officeConstructionCostPerSqm: number;
  /** עלות בנייה למ"ר מבנה ציבור (מב"צ). אם 0, נופל חזרה למחיר המגורים. אין ליחידות מב"צ הכנסה כלל */
  publicBuildingConstructionCostPerSqm: number;
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

  /** אגרות והיטלים עירוניים, מפורט לפי סעיף (ר' MunicipalFeeInputs) */
  municipalFees: MunicipalFeeInputs;

  // דמי שכירות לתקופת הבנייה לדיירים הקיימים (רלוונטי בעיקר לפינוי בינוי/תמ"א 38 עם דיירים
  // שמתפנים). מספר היחידות ומשך התקופה הם נתונים פיזיים שהסוכן החכם יכול להעריך מהתיאור/תוכניות,
  // הסכום החודשי ליחידה הוא ערך כספי שהמשתמש תמיד מזין בעצמו.
  /** מספר יחידות קיימות הזכאיות לדמי שכירות. 0 אם אין דיירים קיימים שמתפנים */
  relocationUnitsCount: number;
  /** משך תשלום דמי השכירות, חודשים */
  relocationMonths: number;
  /** דמי שכירות חודשיים ליחידה, ₪ */
  relocationRentPerUnitMonthlyNis: number;

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
  /** עמלת פתיחת תיק, % מהכנסות היזם כולל מע"מ (0.45% במקור, ר' 01-תמא-38.md ו"תרגיל בית - יזמות") */
  accountOpeningCommissionRate: number;

  // מימון
  annualInterestRate: number; // ריבית שנתית, %
  constructionMonths: number; // משך תקופת הבנייה, חודשים
  permitMonths: number; // משך התקופה עד היתר, חודשים
  equityNis: number; // הון עצמי מושקע
  presaleRate: number; // אחוז מכירה מוקדמת (פרי-סייל)

  /** שכר המארגן בקבוצת רכישה, סכום קבוע, ₪. נוסף לעלויות העקיפות, מוצג גם בנפרד. 0 בשאר סוגי העסקה */
  organizerFeeNis: number;
}

/**
 * אגרות והיטלי בנייה עירוניים, מפורט. מבוסס על מבנה גיליון "אגרות והיטלים" בקבצי המקור
 * (ר' 01/02-מפרט נוסחאות): שלוש אגרות שטוחות + שלוש קטגוריות "כביש/תיעול/מדרכות" לפי בסיס שטח.
 * פישוט מכוון: המקור מפצל חלק מהסעיפים גם לפי נפח (מ"ק, תלוי גובה קומה), לא רק שטח - המודל הזה
 * לא עוקב אחרי גובה בניין בנפרד, ולכן כל הסעיפים כאן מבוססי שטח (מ"ר) בלבד. הסכום הכולל מוכפל
 * ב-1.05 (מקדם קבוע שמופיע בכל קובצי המקור, ר' engine.ts).
 */
export interface MunicipalFeeInputs {
  /** אגרות בנייה, ₪ למ"ר שטח בנוי ברוטו */
  buildingFeeRatePerSqm: number;
  /** דמי הקמה מים, ₪ למ"ר שטח בנוי ברוטו */
  waterConnectionRatePerSqm: number;
  /** דמי הקמה ביוב, ₪ למ"ר שטח בנוי ברוטו */
  sewageConnectionRatePerSqm: number;
  /** כביש/תיעול/מדרכות לפי שטח המגרש, ₪ למ"ר */
  roadDrainagePlotRatePerSqm: number;
  /** כביש/תיעול/מדרכות לפי שטח הבנוי, ₪ למ"ר */
  roadDrainageBuildingRatePerSqm: number;
  /** כביש/תיעול/מדרכות לפי שטח המרתף/חניה, ₪ למ"ר */
  roadDrainageUndergroundRatePerSqm: number;
}

export interface LandInputs {
  /** תמ"א 38: רכישת קרקע במזומן, ₪. לא רלוונטי לקומבינציה */
  landPurchaseNis: number;
  /** היטל השבחה, ₪. רלוונטי בכל סוג עסקה (גם קרקע באחוזים), לא רק רכישה במזומן */
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

/** שורת פירוט עלות בנייה לקטגוריה אחת, לצורך תצוגה בדוח ("פירוט עלויות בנייה") */
export interface ConstructionCostRow {
  category: UnitCategory;
  /** שטח עיקרי (הדירות/היחידות עצמן), מ"ר */
  mainAreaSqm: number;
  mainCostNis: number;
  /** ממ"ד + מרפסת + מרפסת גג יחד, מ"ר */
  otherAreaSqm: number;
  otherCostNis: number;
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
  /** דמי שכירות לדיירים הקיימים, כבר כלול ב-indirectNis, מוצג כאן גם בנפרד לתצוגה */
  relocationRentNis: number;
  /** אגרות והיטלים עירוניים, כבר כלול ב-indirectNis, מוצג כאן גם בנפרד לתצוגה */
  municipalFeesNis: number;
  /** פירוט עלות הבנייה הישירה לפי קטגוריה, כבר כלול ב-directConstructionNis במלואו */
  constructionBreakdown: ConstructionCostRow[];
}

export interface ProfitabilitySummary {
  revenueNis: number;
  totalCostNis: number;
  currentProfitNis: number;
  /** רווח לעלות, % */
  profitToCostRatio: number;
  /** רווח למחזור (רווח/הכנסה), % - מדד שני, נפוץ בדוחות אמיתיים לצד רווח לעלות */
  profitToRevenueRatio: number;
  /**
   * תשואה על ההון העצמי לשנה (Cash on Cash), % - רווח חלקי הון עצמי, מחולק במשך הפרויקט בשנים
   * (תקופת היתר+בנייה). 0 אם לא הוזן הון עצמי (equityNis=0), אין על מה לחשב תשואה.
   */
  cashOnCashAnnualRatio: number;
}

export interface ProjectResult {
  areas: AreaSummary;
  revenue: RevenueSummary;
  costs: CostBreakdown;
  profitability: ProfitabilitySummary;
  warnings: string[];
}
