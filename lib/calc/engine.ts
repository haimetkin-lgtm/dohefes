import type {
  ProjectInputs,
  AreaSummary,
  RevenueSummary,
  CostBreakdown,
  ConstructionCostRow,
  MunicipalFeeInputs,
  ProfitabilitySummary,
  ProjectResult,
  UnitAllocationRow,
  BreakEvenResult,
  SensitivityMatrixCell,
  FeasibilityMetrics,
  UnitCategory,
  DealType,
} from "./types";

// מנוע החישוב המשותף. מבוסס על שרשרת הליבה שתועדה בשישה מפרטי הנוסחאות
// (Dropbox/2026/קלוד קוד - מיזמים/דוחות אפס/מפרט נוסחאות/), ומאמת שהיא זהה
// בין כל סוגי העסקה למעט שלוש נקודות: תמורת הקרקע, בסיס מס הרכישה,
// וחלק היזם בהכנסות. הנוסחאות המדויקות (עלויות עקיפות, עמלות, בנייה ישירה) מתועדות
// שם בפירוט מלא, כולל דוגמאות מספריות מהאקסל המקורי לאימות.
//
// פישוט מכוון ל-MVP (שלב 1): מודל המימון והעמלות (ערבות חוק מכר, אי ניצול אשראי)
// מוחלף כאן בקירוב סטטי במקום סימולציית תזרים רבעונית מלאה. ראו הערה ליד financing.
// זו לא טעות, זו החלטת היקף מתועדת ב-01-תמא-38.md: "אפשר וכדאי להתחיל MVP עם גרסה
// מפושטת... ולשדרג לגרסה המדויקת בשלב מאוחר יותר".

export const VAT_FACTOR = 1.17;

/**
 * תבנית חוזרת בתוך computeCosts: סכום מבוסס הכנסת יזם לא-כולל-מע"מ, מוכפל במע"מ ואז בשיעור
 * (legalNis, presaleInflowNis, accountOpeningCommissionNis - שלושתם באותה צורה בדיוק). מיוצא
 * כ-helper טהור כדי שאפשר יהיה לחשב את אותם סכומים גם מחוץ ל-computeCosts (ר' commit 8c,
 * cashflow-project-adapter.ts) בלי לשכפל את הנוסחה/את VAT_FACTOR במקום שני.
 */
export function computeVatInclusiveRevenueBasedAmount(developerRevenueExclVatNis: number, rate: number): number {
  return developerRevenueExclVatNis * VAT_FACTOR * rate;
}

// basic/purchaseGroup: קרקע נרכשת/משולמת במזומן, קלט ישיר (היזם רוכש/כבר בעלים).
// שאר סוגי העסקה: קרקע "משולמת" בעין, בלי תשלום כספי נפרד, בשתי שיטות שונות (ר' landMechanism):
// tama38/pinuyBinui מחזירים דירות תמורה ספציפיות לדיירים הקיימים (מסומן בטבלת התמהיל), בעוד
// kombinatsia/kombinatsiaTemurot/mixedUse מחלקים אחוז אחיד מכל שטחי הפרויקט לבעל הקרקע.
export function isCashLandDeal(dealType: DealType): boolean {
  return dealType === "basic" || dealType === "purchaseGroup";
}

export type LandMechanism = "cash" | "unitCompensation" | "percentageSplit";

/**
 * שלוש שיטות "תשלום" עבור הקרקע/הזכויות, קובעות איך מחושבת הכנסת היזם:
 * - cash: היזם רוכש את הקרקע/הזכויות במזומן, כל היחידות שלו, 100% מההכנסה שלו.
 * - unitCompensation: דיירים קיימים מקבלים יחידות תמורה ספציפיות בחינם (מסומנות
 *   ב-UnitType.isCompensationUnit), הכנסת היזם = הכנסה מכל היחידות האחרות בלבד. תמ"א 38 הריסה
 *   ובנייה מחדש ופינוי בינוי, שבהם דייר ספציפי מקבל דירה ספציפית תמורת דירתו הישנה, לא אחוז מהפרויקט.
 * - percentageSplit: בעל הקרקע מקבל אחוז אחיד (combinationOwnerShare) מכל שטחי הפרויקט (מגורים+
 *   מסחר+משרדים יחד), הכנסת היזם = סה"כ ההכנסה × (1-האחוז). קומבינציה/קומבינצית תמורות/מעורב
 *   שימושים, לפי 05-קומבינציה-בעין.md: "כל שלושת הרכיבים מפוצלים לפי אותו יחס".
 */
export function landMechanism(dealType: DealType): LandMechanism {
  if (isCashLandDeal(dealType)) return "cash";
  if (dealType === "tama38" || dealType === "pinuyBinui") return "unitCompensation";
  return "percentageSplit";
}

function unitCategory(category: UnitCategory | undefined): UnitCategory {
  return category ?? "residential";
}

/** במעורב שימושים אחוז הקומבינציה אינו אחיד: המקור מחזיק אחוז נפרד למגורים, למסחר
 * ולמשרדים (04-מעורב-מגורים-ותעסוקה.md §1.3). דוחות ישנים נשארים בני-קריאה באמצעות fallback
 * מפורש לשדה האחיד הישן; אין שינוי בשאר סוגי העסקאות. */
function ownerShareForCategory(inputs: ProjectInputs, category: UnitCategory): number {
  if (inputs.dealType !== "mixedUse") return inputs.land.combinationOwnerShare;
  if (category === "commercial") {
    return inputs.land.mixedUseCommercialOwnerShare ?? inputs.land.combinationOwnerShare;
  }
  if (category === "office") {
    return inputs.land.mixedUseOfficeOwnerShare ?? inputs.land.combinationOwnerShare;
  }
  return inputs.land.mixedUseResidentialOwnerShare ?? inputs.land.combinationOwnerShare;
}

/**
 * בנצ'מרק "רווח לעלות" מקובל לתצוגה בדוח, לצורך השוואה בלבד (לא אכיפה). פינוי בינוי: מעל 25%,
 * מאומת מ-Calculator-Pinui-Binui.xlsm (כלי שיווקי מהשוק). שאר סוגי העסקה: 20%, כלל אצבע מקובל
 * לסף התכנות פרויקט התחדשות עירונית. null בקבוצת רכישה - שם המדד מייצג חיסכון לחברי הקבוצה,
 * לא רווח יזמי, ולא ניתן להשוואה ישירה לאותו סף.
 */
export function profitToCostBenchmark(dealType: DealType): number | null {
  if (dealType === "purchaseGroup") return null;
  if (dealType === "pinuyBinui") return 0.25;
  return 0.2;
}

export function computeAreas(inputs: ProjectInputs): AreaSummary {
  const { units, costs } = inputs;
  let totalMainAreaSqm = 0;
  let totalMamadSqm = 0;
  let totalBalconySqm = 0;
  let totalRoofBalconySqm = 0;
  let unitCount = 0;

  const areaByCategory: AreaSummary["areaByCategory"] = {
    residential: { mainAreaSqm: 0, mamadAreaSqm: 0, balconyAreaSqm: 0, otherAreaSqm: 0 },
    residentialPremium: { mainAreaSqm: 0, mamadAreaSqm: 0, balconyAreaSqm: 0, otherAreaSqm: 0 },
    commercial: { mainAreaSqm: 0, mamadAreaSqm: 0, balconyAreaSqm: 0, otherAreaSqm: 0 },
    office: { mainAreaSqm: 0, mamadAreaSqm: 0, balconyAreaSqm: 0, otherAreaSqm: 0 },
    publicBuilding: { mainAreaSqm: 0, mamadAreaSqm: 0, balconyAreaSqm: 0, otherAreaSqm: 0 },
  };
  let existingStructureAreaSqm = 0;
  let existingStructureMamadAreaSqm = 0;
  let existingStructureBalconyAreaSqm = 0;
  let existingStructureOtherAreaSqm = 0;

  for (const u of units) {
    const cat = unitCategory(u.category);
    const mainArea = u.count * u.areaSqm;
    const otherArea = u.count * (u.mamadSqm + u.balconySqm + u.roofBalconySqm);
    totalMainAreaSqm += mainArea;
    totalMamadSqm += u.count * u.mamadSqm;
    totalBalconySqm += u.count * u.balconySqm;
    totalRoofBalconySqm += u.count * u.roofBalconySqm;
    unitCount += u.count;
    // מבנה קיים המחוזק (תמ"א 38 חיזוק ותוספת): עלות בנייה בנפרד (reinforcementCostPerSqm),
    // לא לפי הקטגוריה שלו. השטח הפיזי עצמו עדיין נספר בסיכומים הכוללים למעלה כרגיל.
    if (u.isExistingStructure) {
      existingStructureAreaSqm += mainArea;
      existingStructureMamadAreaSqm += u.count * u.mamadSqm;
      existingStructureBalconyAreaSqm += u.count * (u.balconySqm + u.roofBalconySqm);
      existingStructureOtherAreaSqm += otherArea;
    } else {
      areaByCategory[cat].mainAreaSqm += mainArea;
      areaByCategory[cat].mamadAreaSqm += u.count * u.mamadSqm;
      areaByCategory[cat].balconyAreaSqm += u.count * (u.balconySqm + u.roofBalconySqm);
      areaByCategory[cat].otherAreaSqm += otherArea;
    }
  }

  const totalMarketableAreaSqm =
    totalMainAreaSqm +
    totalMamadSqm +
    (totalBalconySqm + totalRoofBalconySqm) * costs.balconyWeight;

  return {
    totalMainAreaSqm,
    totalMamadSqm,
    totalBalconySqm,
    totalRoofBalconySqm,
    totalMarketableAreaSqm,
    unitCount,
    areaByCategory,
    existingStructureAreaSqm,
    existingStructureMamadAreaSqm,
    existingStructureBalconyAreaSqm,
    existingStructureOtherAreaSqm,
  };
}

export function computeRevenue(inputs: ProjectInputs, areas: AreaSummary): RevenueSummary {
  let totalRevenueInclVatNis = 0;
  let totalRevenueExclVatNis = 0;
  // unitCompensation בלבד: סכום ההכנסה מהיחידות שאינן יחידות תמורה, נצבר תוך כדי הלולאה
  let nonCompensationRevenueExclVatNis = 0;
  let percentageSplitDeveloperRevenueExclVatNis = 0;
  const byCategory: RevenueSummary["byCategory"] = {
    residential: { totalRevenueExclVatNis: 0, developerRevenueExclVatNis: 0 },
    residentialPremium: { totalRevenueExclVatNis: 0, developerRevenueExclVatNis: 0 },
    commercial: { totalRevenueExclVatNis: 0, developerRevenueExclVatNis: 0 },
    office: { totalRevenueExclVatNis: 0, developerRevenueExclVatNis: 0 },
    publicBuilding: { totalRevenueExclVatNis: 0, developerRevenueExclVatNis: 0 },
  };

  const mechanism = landMechanism(inputs.dealType);

  for (const u of inputs.units) {
    const enteredAmount = u.count * u.priceNis;
    // מגורים (רגיל או פרימיום): המחיר שהוזן כולל מע"מ, מחולק ב-1.17. מסחר/משרדים: המחיר כבר נטו ממע"מ (04-מעורב-מגורים-ותעסוקה.md)
    const cat = unitCategory(u.category);
    const isResidential = cat === "residential" || cat === "residentialPremium";
    const inclVat = isResidential ? enteredAmount : enteredAmount * VAT_FACTOR;
    const exclVat = isResidential ? enteredAmount / VAT_FACTOR : enteredAmount;
    totalRevenueInclVatNis += inclVat;
    totalRevenueExclVatNis += exclVat;
    byCategory[cat].totalRevenueExclVatNis += exclVat;
    // בתמ"א 38 "חיזוק ותוספת" הדיירים הקיימים משמרים את הדירה המחוזקת שלהם בלי תמורה חדשה,
    // בדיוק כמו יחידת תמורה: אין ליזם הכנסה משורה זו, ר' isExistingStructure ב-computeAreas.
    if (mechanism === "unitCompensation" && !u.isCompensationUnit && !u.isExistingStructure) {
      nonCompensationRevenueExclVatNis += exclVat;
    }
    if (mechanism === "percentageSplit") {
      const developerAmount = exclVat * (1 - ownerShareForCategory(inputs, cat));
      percentageSplitDeveloperRevenueExclVatNis += developerAmount;
      byCategory[cat].developerRevenueExclVatNis += developerAmount;
    } else if (mechanism === "cash") {
      byCategory[cat].developerRevenueExclVatNis += exclVat;
    } else if (!u.isCompensationUnit && !u.isExistingStructure) {
      byCategory[cat].developerRevenueExclVatNis += exclVat;
    }
  }

  // הכנסת היזם, לפי שיטת תשלום הקרקע/הזכויות (ר' landMechanism):
  // cash=100%, unitCompensation=הכנסה מהיחידות שאינן תמורה בלבד, percentageSplit=אחוז אחיד מהכל.
  const developerRevenueExclVatNis =
    mechanism === "cash"
      ? totalRevenueExclVatNis
      : mechanism === "unitCompensation"
        ? nonCompensationRevenueExclVatNis
        : percentageSplitDeveloperRevenueExclVatNis;

  const averagePricePerSqmNis =
    areas.totalMarketableAreaSqm > 0 ? totalRevenueInclVatNis / areas.totalMarketableAreaSqm : 0;

  return { totalRevenueInclVatNis, totalRevenueExclVatNis, developerRevenueExclVatNis, averagePricePerSqmNis, byCategory };
}

// אגרות והיטלים עירוניים מפורטים, ר' MunicipalFeeInputs ב-types.ts. מקדם 1.05 קבוע בכל קבצי המקור.
const MUNICIPAL_FEE_MARKUP = 1.05;

export function computeMunicipalFees(fees: MunicipalFeeInputs, areas: AreaSummary, costs: { netPlotAreaSqm: number; undergroundAreaSqm: number }): number {
  const grossBuiltAreaSqm = areas.totalMainAreaSqm + areas.totalMamadSqm + areas.totalBalconySqm + areas.totalRoofBalconySqm;
  const raw =
    fees.buildingFeeRatePerSqm * grossBuiltAreaSqm +
    fees.waterConnectionRatePerSqm * grossBuiltAreaSqm +
    fees.sewageConnectionRatePerSqm * grossBuiltAreaSqm +
    fees.roadDrainagePlotRatePerSqm * costs.netPlotAreaSqm +
    fees.roadDrainageBuildingRatePerSqm * grossBuiltAreaSqm +
    fees.roadDrainageUndergroundRatePerSqm * costs.undergroundAreaSqm;
  return raw * MUNICIPAL_FEE_MARKUP;
}

export function computeCosts(inputs: ProjectInputs, areas: AreaSummary, revenue: RevenueSummary): CostBreakdown {
  const { costs, land, dealType } = inputs;

  // A. קרקע. היטל השבחה רלוונטי בכל סוג עסקה (גם קרקע באחוזים), רכישת קרקע במזומן רק בעסקאות מזומן.
  const landNis = (isCashLandDeal(dealType) ? land.landPurchaseNis : 0) + land.bettermentLevyNis;

  // D. בנייה ישירה, תמיד על 100% מהבניין, ללא קשר לחלוקת קומבינציה. לכל קטגוריה עלות מ"ר משלה:
  // residentialPremium/commercial/office/publicBuilding נופלים חזרה לעלות המגורים הרגילה אם לא הוזנו (0).
  const costPerSqmByCategory: Record<UnitCategory, number> = {
    residential: costs.mainConstructionCostPerSqm,
    residentialPremium: costs.premiumConstructionCostPerSqm || costs.mainConstructionCostPerSqm,
    commercial: costs.commercialConstructionCostPerSqm || costs.mainConstructionCostPerSqm,
    office: costs.officeConstructionCostPerSqm || costs.mainConstructionCostPerSqm,
    publicBuilding: costs.publicBuildingConstructionCostPerSqm || costs.mainConstructionCostPerSqm,
  };
  let categorizedConstructionNis = 0;
  const constructionBreakdown: ConstructionCostRow[] = [];
  (Object.keys(areas.areaByCategory) as UnitCategory[]).forEach((cat) => {
    const { mainAreaSqm, mamadAreaSqm, balconyAreaSqm, otherAreaSqm } = areas.areaByCategory[cat];
    if (mainAreaSqm === 0 && otherAreaSqm === 0) return;
    const cost = costPerSqmByCategory[cat];
    const balconyCostPerSqm = cost * costs.balconyConstructionCostRatio;
    const mainCostNis = mainAreaSqm * cost;
    const mamadCostNis = mamadAreaSqm * cost;
    const balconyCostNis = balconyAreaSqm * balconyCostPerSqm;
    const otherCostNis = mamadCostNis + balconyCostNis;
    categorizedConstructionNis += mainCostNis + otherCostNis;
    constructionBreakdown.push({
      category: cat,
      mainAreaSqm,
      mainCostNis,
      mamadAreaSqm,
      mamadCostNis,
      balconyAreaSqm,
      balconyCostNis,
      otherAreaSqm,
      otherCostNis,
    });
  });

  // חיזוק שלד קיים (תמ"א 38 חיזוק ותוספת), עלות נפרדת לגמרי מהקטגוריות, ר' UnitType.isExistingStructure.
  // "פסאודו-קטגוריה" משלה בפירוט, לא מעורבבת עם עלות בנייה חדשה של אותה קטגוריה.
  if (areas.existingStructureAreaSqm > 0 || areas.existingStructureOtherAreaSqm > 0) {
    const reinforcementRate = costs.reinforcementCostPerSqm || costs.mainConstructionCostPerSqm;
    const mainCostNis = areas.existingStructureAreaSqm * reinforcementRate;
    const mamadCostNis = areas.existingStructureMamadAreaSqm * reinforcementRate;
    const balconyCostNis =
      areas.existingStructureBalconyAreaSqm * reinforcementRate * costs.balconyConstructionCostRatio;
    const otherCostNis = mamadCostNis + balconyCostNis;
    categorizedConstructionNis += mainCostNis + otherCostNis;
    constructionBreakdown.push({
      category: "existingStructure",
      mainAreaSqm: areas.existingStructureAreaSqm,
      mainCostNis,
      mamadAreaSqm: areas.existingStructureMamadAreaSqm,
      mamadCostNis,
      balconyAreaSqm: areas.existingStructureBalconyAreaSqm,
      balconyCostNis,
      otherAreaSqm: areas.existingStructureOtherAreaSqm,
      otherCostNis,
    });
  }

  const directConstructionNis =
    categorizedConstructionNis +
    costs.undergroundAreaSqm * costs.undergroundConstructionCostPerSqm +
    (costs.netPlotAreaSqm / 2) * costs.developmentCostPerSqm +
    costs.demolitionFlatNis;

  // B. עלויות עקיפות. בסיס הכנסות = חלק היזם בלבד (developerRevenueExclVatNis).
  const purchaseTaxBasis = isCashLandDeal(dealType) ? land.landPurchaseNis : land.combinationLandValueForTaxNis;
  // יזמות/קבוצת רכישה: תיווך חל על מחיר רכישת הקרקע בלבד, לא על היטל ההשבחה. בעסקאות
  // קומבינציה אין רכישת קרקע במזומן ושורת השיווק כוללת גם תיווך, ולכן אין להוסיף כאן תיווך
  // נוסף על ההיטל (01/02/03 וכן 05/06 במפרטי המקור).
  const brokerageNis = isCashLandDeal(dealType) ? land.landPurchaseNis * costs.brokerageRate : 0;
  const purchaseTaxNis = purchaseTaxBasis * costs.purchaseTaxRate;
  const residentialUnitCount = inputs.units
    .filter((unit) => {
      const category = unitCategory(unit.category);
      return category === "residential" || category === "residentialPremium";
    })
    .reduce((sum, unit) => sum + unit.count, 0);
  // תעריף "ליח"ד" חל על יחידות מגורים בלבד. חיבורי תעסוקה במקורות מבוססי-שטח דורשים
  // קלט נפרד שטרם קיים במודל; לפחות אין לחייב בטעות כל חנות/משרד כאילו היו דירה.
  const electricNis = residentialUnitCount * costs.electricConnectionPerUnitNis;
  const planningConsultantsNis = directConstructionNis * costs.planningConsultantsRate;
  const engineeringInspectionNis = costs.engineeringInspectionFlatNis;
  // בקבוצת רכישה הוצאות השיווק/משפטיות מוטלות ישירות על חברי הקבוצה ואינן חלק מתקציב
  // הפרויקט (03-קבוצת-רכישה.md, סעיף 2.2). בקומבינציית תמורות היזם משווק את *כל* הפרויקט,
  // לרבות החלק שמועבר לבעלי הקרקע, ולכן בסיס השיווק הוא ההכנסה הכוללת ולא רק חלק היזם
  // (06-קומבינצית-תמורות.md, סעיף 2).
  const marketingBasisNis =
    dealType === "kombinatsiaTemurot" ? revenue.totalRevenueExclVatNis : revenue.developerRevenueExclVatNis;
  const marketingNis = dealType === "purchaseGroup" ? 0 : marketingBasisNis * costs.marketingRate;
  const developerResidentialRevenueExclVatNis =
    revenue.byCategory.residential.developerRevenueExclVatNis +
    revenue.byCategory.residentialPremium.developerRevenueExclVatNis;
  const totalResidentialRevenueExclVatNis =
    revenue.byCategory.residential.totalRevenueExclVatNis +
    revenue.byCategory.residentialPremium.totalRevenueExclVatNis;
  const legalRevenueBasisExclVatNis =
    dealType === "kombinatsiaTemurot" ? totalResidentialRevenueExclVatNis : developerResidentialRevenueExclVatNis;
  const legalNis =
    dealType === "purchaseGroup"
      ? 0
      : computeVatInclusiveRevenueBasedAmount(legalRevenueBasisExclVatNis, costs.legalRate);
  const legalRefundNis = dealType === "purchaseGroup" ? 0 : residentialUnitCount * costs.legalRefundPerUnitNis;
  const overheadNis = directConstructionNis * costs.overheadRate;
  const managementFeeNis = directConstructionNis * costs.managementFeeRate;
  const contingencyNis = directConstructionNis * costs.contingencyRate;
  // שכר מארגן, רלוונטי רק לקבוצת רכישה (0 בשאר סוגי העסקה)
  const organizerFeeNis = dealType === "purchaseGroup" ? costs.organizerFeeNis : 0;
  // דמי שכירות לדיירים קיימים לתקופת הבנייה, 0 אם אין דיירים קיימים שמתפנים
  const relocationRentNis = costs.relocationUnitsCount * costs.relocationMonths * costs.relocationRentPerUnitMonthlyNis;
  const municipalFeesNis = computeMunicipalFees(costs.municipalFees, areas, costs);

  const indirectNis =
    municipalFeesNis +
    brokerageNis +
    purchaseTaxNis +
    electricNis +
    costs.planningFlatNis +
    planningConsultantsNis +
    engineeringInspectionNis +
    marketingNis +
    legalNis +
    legalRefundNis +
    costs.financialSupervisionFlatNis +
    overheadNis +
    managementFeeNis +
    contingencyNis +
    organizerFeeNis +
    relocationRentNis;

  // C. עמלות מימון, מפושט. במקור מחושבות מתוך סימולציית תזרים רבעונית מלאה
  // (ר' 01-תמא-38.md סעיף 5). כאן: אחוז מהכנסה/ממסגרת, כפול 0.5 כקירוב לבסיס
  // מצטבר ממוצע לאורך תקופת הבנייה, במקום אינטגרציה רבעונית מדויקת.
  //
  // התנהגות קיימת במודל המימון: בסיס עמלת הערבות כולל את שווי כלל היחידות, לרבות יחידות
  // תמורה. ההתנהגות נשמרה בשלב זה כדי לא לשנות את תרחיש הבסיס, ותיבחן בנפרד בעת בניית
  // מודל התזרים והמימון.
  // TODO (משימת תזרים/מימון עתידית): לא לגעת בנוסחה הזו כרגע, רק לתעד:
  //   - להפריד ערבות חוק מכר לרוכשים מערבויות לדיירים.
  //   - לבדוק בסיס עמלה, שיעור עמלה, מועד תחילה ומשך החשיפה לכל סוג בנפרד.
  //   - לא להניח ששני סוגי הערבות מחושבים באותו שיעור או על אותו בסיס.
  const guaranteeCommissionNis =
    dealType === "purchaseGroup" ? 0 : revenue.totalRevenueInclVatNis * costs.guaranteeCommissionRate * 0.5;

  const totalDirectAndIndirect = directConstructionNis + indirectNis + landNis;
  const presaleInflowNis = computeVatInclusiveRevenueBasedAmount(revenue.developerRevenueExclVatNis, costs.presaleRate);
  const creditFacilityNis = Math.max(0, totalDirectAndIndirect - costs.equityNis - presaleInflowNis);
  const unusedCreditCommissionNis =
    dealType === "purchaseGroup" ? 0 : creditFacilityNis * costs.unusedCreditCommissionRate * 0.5;
  // עמלת פתיחת תיק, % מהכנסות היזם כולל מע"מ (לא מהתזרים כמו שתי העמלות האחרות)
  const accountOpeningCommissionNis =
    dealType === "purchaseGroup"
      ? 0
      : computeVatInclusiveRevenueBasedAmount(revenue.developerRevenueExclVatNis, costs.accountOpeningCommissionRate);

  const commissionsNis = guaranteeCommissionNis + unusedCreditCommissionNis + accountOpeningCommissionNis;

  // F. מימון, מפושט: ריבית פשוטה על יתרת חוב ממוצעת (הנחת פריסה ליניארית).
  const avgOutstandingBalanceNis = creditFacilityNis / 2;
  // בקבוצת רכישה תרחיש הבסיס ממומן מתשלומי החברים; גיליון המימון הוא חלופת השוואה בלבד ואינו
  // זורם לרווחיות. לכן המימון בתוצאת הבסיס חייב להיות 0 גם אם נשמרו הנחות ריבית ישנות בדוח.
  const financingNis =
    dealType === "purchaseGroup"
      ? 0
      : avgOutstandingBalanceNis * costs.annualInterestRate * (costs.constructionMonths / 12);

  const totalExclFinancingNis = landNis + indirectNis + commissionsNis + directConstructionNis;
  const totalInclFinancingNis = totalExclFinancingNis + financingNis;

  return {
    landNis,
    indirectNis,
    commissionsNis,
    directConstructionNis,
    financingNis,
    totalExclFinancingNis,
    totalInclFinancingNis,
    organizerFeeNis,
    relocationRentNis,
    municipalFeesNis,
    constructionBreakdown,
  };
}

export function computeProfitability(revenue: RevenueSummary, costs: CostBreakdown, rawCosts: ProjectInputs["costs"]): ProfitabilitySummary {
  const revenueNis = revenue.developerRevenueExclVatNis;
  const totalCostNis = costs.totalInclFinancingNis;
  const currentProfitNis = revenueNis - totalCostNis;
  const profitToCostRatio = totalCostNis !== 0 ? currentProfitNis / totalCostNis : 0;
  const profitToRevenueRatio = revenueNis !== 0 ? currentProfitNis / revenueNis : 0;
  // תשואה שנתית על ההון העצמי (Cash on Cash), ר' "דוגמא לדוח כלכלי.xls". 0 אם לא הוזן הון עצמי.
  const projectYears = (rawCosts.constructionMonths + rawCosts.permitMonths) / 12;
  const cashOnCashAnnualRatio =
    rawCosts.equityNis > 0 && projectYears > 0 ? currentProfitNis / rawCosts.equityNis / projectYears : 0;
  return { revenueNis, totalCostNis, currentProfitNis, profitToCostRatio, profitToRevenueRatio, cashOnCashAnnualRatio };
}

/**
 * בדיקת הקצאה והוגנות ליחידה (נספח א.xlsx): מחלקת את שווי הקרקע ועלות ההקמה+כלליות בין כל
 * היחידות (יזם+דיירים קיימים גם יחד, יחד באותה טבלה) לפי שטח משוקלל יחסי, ומשווה לשווי השוק
 * שלהן - בודקת שהפער (רווח גלום) דומה בין כל סוגי היחידות, לא רק בממוצע. מוציאה יחידות מבנה
 * קיים (isExistingStructure, לא חלק מהבניין החדש שמחולק) ומב"צ (אין להן שווי שוק להשוואה).
 * לא רלוונטי בעסקת מזומן טהורה (אין חלוקת קרקע/תמורה בכלל, ר' landMechanism).
 */
export function computeUnitAllocation(inputs: ProjectInputs, costs: CostBreakdown): UnitAllocationRow[] {
  if (landMechanism(inputs.dealType) === "cash") return [];

  const eligible = inputs.units.filter((u) => !u.isExistingStructure && unitCategory(u.category) !== "publicBuilding");
  if (eligible.length < 2) return [];

  const { balconyWeight } = inputs.costs;
  const weightedAreaByUnit = eligible.map(
    (u) => u.areaSqm + u.mamadSqm + (u.balconySqm + u.roofBalconySqm) * balconyWeight
  );
  const totalWeightedAreaSqm = eligible.reduce((sum, u, i) => sum + u.count * weightedAreaByUnit[i], 0);
  if (totalWeightedAreaSqm === 0) return [];

  const landTotal = costs.landNis;
  const constructionTotal = costs.totalExclFinancingNis - costs.landNis;

  return eligible.map((u, i) => {
    const rowWeightedTotal = u.count * weightedAreaByUnit[i];
    const sharePercent = rowWeightedTotal / totalWeightedAreaSqm;
    const landShareNis = sharePercent * landTotal;
    const constructionShareNis = sharePercent * constructionTotal;
    const costBasisPerUnitNis = (landShareNis + constructionShareNis) / u.count;
    const cat = unitCategory(u.category);
    const isResidential = cat === "residential" || cat === "residentialPremium";
    const marketValuePerUnitNis = isResidential ? u.priceNis / VAT_FACTOR : u.priceNis;
    const gapPerUnitNis = marketValuePerUnitNis - costBasisPerUnitNis;
    const gapRatio = costBasisPerUnitNis !== 0 ? gapPerUnitNis / costBasisPerUnitNis : 0;
    return {
      name: u.name,
      count: u.count,
      weightedAreaSqm: weightedAreaByUnit[i],
      sharePercent,
      landShareNis,
      constructionShareNis,
      costBasisPerUnitNis,
      marketValuePerUnitNis,
      gapPerUnitNis,
      gapRatio,
    };
  });
}

// --- מדדי היתכנות (דור 2): נקודת איזון, שווי קרקע שיורי, מטריצת רגישות ---
// כל השלושה תלויים בהרצה חוזרת ומלאה של שרשרת areas->revenue->costs->profitability על עותק
// מוזז של הקלט, ולא בנוסחה סגורה - כי עמלות המימון והמכירה מחושבות כאחוז מההכנסה/מהאשראי,
// ולכן "עלות" ו"הכנסה" לא נעות בבידוד זו מזו. הפונקציה profitAt/ratioAt בכל אחד מהם היא
// מונוטונית (רווח עולה עם המחיר, רווח יורד עם מחיר הקרקע), אבל לא בהכרח ליניארית לגמרי
// (יש נקודת שבירה כשמסגרת האשראי הנדרשת יורדת ל-0), ולכן פתרון בחיפוש בינארי (bisection)
// עמיד יותר מנוסחה אלגברית או משיטת ניוטון.

const BISECTION_ITERATIONS = 60;
const BISECTION_TOLERANCE_NIS = 1;

/**
 * חיפוש בינארי לשורש של fn בטווח [lo, hi]. דורש שינוי סימן בין הקצוות (fn(lo) ו-fn(hi) בסימנים
 * הפוכים) - אם אין, אין שורש בר-מציאה בטווח הזה ומוחזר null (למשל: פרויקט לא-כדאי גם במחיר קרקע
 * אפס, או פרויקט שלא מגיע לאיזון גם בפי 5 ממחירי הבסיס). עוצר אחרי BISECTION_ITERATIONS
 * איטרציות לכל היותר (יציאה מוגבלת, לא לולאה אינסופית) או כשהפער בין lo/hi קטן מהסף.
 */
function bisectRoot(fn: (x: number) => number, lo: number, hi: number): number | null {
  let fLo = fn(lo);
  const fHi = fn(hi);
  // הגנה: fn יכולה לצאת NaN/Infinity בקצה טווח קיצוני (חלוקה ב-0 בנוסחה כלשהי בהמשך). במקום
  // לתת לזה לזהם את lo/hi ולקרוס בלי לזרוק, יוצאים בבטחה עם null.
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) return null;
  if (Math.abs(fLo) < BISECTION_TOLERANCE_NIS) return lo;
  if (Math.abs(fHi) < BISECTION_TOLERANCE_NIS) return hi;
  if ((fLo < 0) === (fHi < 0)) return null;

  for (let i = 0; i < BISECTION_ITERATIONS && hi - lo > 1e-9; i++) {
    const mid = (lo + hi) / 2;
    const fMid = fn(mid);
    if (!Number.isFinite(fMid)) return null;
    if (Math.abs(fMid) < BISECTION_TOLERANCE_NIS) return mid;
    if ((fMid < 0) === (fLo < 0)) {
      lo = mid;
      fLo = fMid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

/** מכפיל k על כל מחירי היחידות, בלי לגעת באובייקט המקורי - יחידות תמורה/מבנה קיים נשארות 0*k=0 */
function scaleUnitPrices(units: ProjectInputs["units"], factor: number): ProjectInputs["units"] {
  return units.map((u) => ({ ...u, priceNis: u.priceNis * factor }));
}

/** מכפיל factor על תעריפי הבנייה למ"ר בלבד (לא על עלויות פיתוח/הריסה, שאינן "תעריף בנייה") */
function scaleConstructionRates(costs: ProjectInputs["costs"], factor: number): ProjectInputs["costs"] {
  return {
    ...costs,
    mainConstructionCostPerSqm: costs.mainConstructionCostPerSqm * factor,
    premiumConstructionCostPerSqm: costs.premiumConstructionCostPerSqm * factor,
    commercialConstructionCostPerSqm: costs.commercialConstructionCostPerSqm * factor,
    officeConstructionCostPerSqm: costs.officeConstructionCostPerSqm * factor,
    publicBuildingConstructionCostPerSqm: costs.publicBuildingConstructionCostPerSqm * factor,
    reinforcementCostPerSqm: costs.reinforcementCostPerSqm * factor,
    undergroundConstructionCostPerSqm: costs.undergroundConstructionCostPerSqm * factor,
  };
}

/** יחידות שהיזם בפועל מוכר בשוק: לא תמורה (isCompensationUnit), לא מבנה קיים מחוזק
 *  (isExistingStructure, אף פעם לא נמכר), ולא מב"צ (publicBuilding, תמיד הכנסה 0 במוסכמה) */
function marketSaleUnits(units: ProjectInputs["units"]): ProjectInputs["units"] {
  return units.filter((u) => !u.isCompensationUnit && !u.isExistingStructure && unitCategory(u.category) !== "publicBuilding");
}

/**
 * מחיר מכירה ממוצע למ"ר, לפי יחידות הנמכרות בשוק בלבד (ר' marketSaleUnits) - לא לפי כלל שטחי
 * הפרויקט. חשוב במיוחד ב-unitCompensation: יחידות תמורה תורמות שטח לפרויקט אבל אינן נמכרות
 * ואינן צריכות לדלל את המחיר הממוצע שמוצג ליזם. null אם אין יחידה נמכרת עם שטח.
 */
function averageSalePricePerSqm(units: ProjectInputs["units"], balconyWeight: number): number | null {
  let areaSqm = 0;
  let revenueInclVatNis = 0;
  for (const u of marketSaleUnits(units)) {
    areaSqm += u.count * (u.areaSqm + u.mamadSqm + (u.balconySqm + u.roofBalconySqm) * balconyWeight);
    revenueInclVatNis += u.count * u.priceNis;
  }
  return areaSqm > 0 ? revenueInclVatNis / areaSqm : null;
}

function profitAtPriceMultiplier(inputs: ProjectInputs, multiplier: number): number {
  const scaled: ProjectInputs = { ...inputs, units: scaleUnitPrices(inputs.units, multiplier) };
  const areas = computeAreas(scaled);
  const revenue = computeRevenue(scaled, areas);
  const costs = computeCosts(scaled, areas, revenue);
  return computeProfitability(revenue, costs, scaled.costs).currentProfitNis;
}

/**
 * נקודת איזון בהכנסות: החיפוש נע בטווח מכפיל 0 (כל המחירים 0, רווח תמיד שלילי - יש עלויות
 * קבועות) עד 5 (פי 5 ממחירי הבסיס, גבול עליון סביר). אם גם בפי 5 הרווח עדיין שלילי, אין
 * נקודת איזון בת-מציאה בטווח סביר ומוחזר null בכל השדות.
 */
export function computeBreakEven(inputs: ProjectInputs, baseRevenueNis: number): BreakEvenResult {
  if (baseRevenueNis <= 0) {
    return { priceMultiplier: null, averagePricePerSqmNis: null, marginOfSafetyRatio: null };
  }
  const multiplier = bisectRoot((k) => profitAtPriceMultiplier(inputs, k), 0, 5);
  if (multiplier === null) {
    return { priceMultiplier: null, averagePricePerSqmNis: null, marginOfSafetyRatio: null };
  }
  const scaledUnits = scaleUnitPrices(inputs.units, multiplier);
  return {
    priceMultiplier: multiplier,
    averagePricePerSqmNis: averageSalePricePerSqm(scaledUnits, inputs.costs.balconyWeight),
    marginOfSafetyRatio: 1 - multiplier,
  };
}

/**
 * שווי קרקע שיורי (שיטת החילוץ): מחיר הקרקע המרבי שעדיין מאפשר לעמוד ביעד הרווח-לעלות המקובל
 * לסוג העסקה (profitToCostBenchmark). רלוונטי רק בעסקאות מזומן - בעסקאות תמורה/אחוזים אין
 * "מחיר קרקע" בודד לפתור עבורו (התמורה היא בעין, לא בכסף). טווח החיפוש: 0 עד פי 3 מהכנסת
 * היזם הנוכחית, גבול עליון סביר. אם הפרויקט לא עומד ביעד גם במחיר קרקע 0 (כשל כלכלי בפני
 * עצמו, לא קשור למחיר הקרקע), מוחזר null.
 */
export function computeResidualLandValue(inputs: ProjectInputs): number | null {
  if (!isCashLandDeal(inputs.dealType)) return null;
  const targetRatio = profitToCostBenchmark(inputs.dealType);
  if (targetRatio === null) return null;

  // הפונקציה חייבת להיות בסקאלת ₪ (לא יחס גולמי), כי bisectRoot עובד עם סף התכנסות אחיד
  // (BISECTION_TOLERANCE_NIS) שנועד לכמויות בשקלים - יחס גולמי (למשל 0.05) תמיד קטן מהסף וגורם
  // "התכנסות" מיידית ושגויה בלי חיפוש אמיתי. profit - target*totalCost = 0 בדיוק כש-profitToCostRatio=target.
  const profitGapAtLandPrice = (landPriceNis: number): number => {
    const scaled: ProjectInputs = { ...inputs, land: { ...inputs.land, landPurchaseNis: landPriceNis } };
    const areas = computeAreas(scaled);
    const revenue = computeRevenue(scaled, areas);
    const costs = computeCosts(scaled, areas, revenue);
    const profitability = computeProfitability(revenue, costs, scaled.costs);
    return profitability.currentProfitNis - targetRatio * profitability.totalCostNis;
  };

  const areas = computeAreas(inputs);
  const revenue = computeRevenue(inputs, areas);
  const hi = Math.max(revenue.developerRevenueExclVatNis * 3, 1);
  return bisectRoot(profitGapAtLandPrice, 0, hi);
}

const SENSITIVITY_FACTORS = [0.9, 0.95, 1, 1.05, 1.1];

/** מטריצת רגישות 5x5: הכנסות (מחירי מכירה) × עלויות בנייה, כל תא מריץ את שרשרת המנוע במלואה */
export function computeSensitivityMatrix(inputs: ProjectInputs): SensitivityMatrixCell[] {
  const cells: SensitivityMatrixCell[] = [];
  for (const revenueFactor of SENSITIVITY_FACTORS) {
    for (const costFactor of SENSITIVITY_FACTORS) {
      const scaled: ProjectInputs = {
        ...inputs,
        units: scaleUnitPrices(inputs.units, revenueFactor),
        costs: scaleConstructionRates(inputs.costs, costFactor),
      };
      const areas = computeAreas(scaled);
      const revenue = computeRevenue(scaled, areas);
      const costs = computeCosts(scaled, areas, revenue);
      const profitability = computeProfitability(revenue, costs, scaled.costs);
      cells.push({ revenueFactor, costFactor, profitNis: profitability.currentProfitNis, profitToCostRatio: profitability.profitToCostRatio });
    }
  }
  return cells;
}

export function computeProject(inputs: ProjectInputs): ProjectResult {
  const warnings: string[] = [];

  if (inputs.units.length === 0) {
    warnings.push("לא הוזנו יחידות דיור.");
  }
  const mechanism = landMechanism(inputs.dealType);
  if (mechanism === "percentageSplit" && inputs.land.combinationOwnerShare <= 0) {
    warnings.push("אחוז החלוקה לבעל הקרקע הוא 0 או לא הוזן, כדאי לבדוק.");
  }
  const percentageShares =
    inputs.dealType === "mixedUse"
      ? [
          ["מגורים", inputs.land.mixedUseResidentialOwnerShare ?? inputs.land.combinationOwnerShare],
          ["מסחר", inputs.land.mixedUseCommercialOwnerShare ?? inputs.land.combinationOwnerShare],
          ["משרדים", inputs.land.mixedUseOfficeOwnerShare ?? inputs.land.combinationOwnerShare],
        ] as const
      : mechanism === "percentageSplit"
        ? [["הפרויקט", inputs.land.combinationOwnerShare] as const]
        : [];
  for (const [label, share] of percentageShares) {
    if (!Number.isFinite(share) || share < 0 || share > 1) {
      warnings.push(`אחוז הבעלים עבור ${label} חייב להיות בין 0 ל-1; הוזן ${share}.`);
    }
  }
  if (mechanism === "cash" && inputs.land.landPurchaseNis <= 0) {
    warnings.push("לא הוזנה עלות רכישת קרקע.");
  }
  if (mechanism === "unitCompensation" && !inputs.units.some((u) => u.isCompensationUnit || u.isExistingStructure)) {
    warnings.push('לא סומנה אף יחידת "תמורה" או "מבנה קיים" בטבלת התמהיל, כמעט תמיד יש דיירים קיימים שמקבלים תמורה בסוג עסקה זה.');
  }
  if ((inputs.dealType === "pinuyBinui" || inputs.dealType === "tama38") && inputs.costs.relocationUnitsCount <= 0) {
    warnings.push('לא הוזן מספר יחידות קיימות לדמי שכירות לתקופת הבנייה, כמעט תמיד רלוונטי בפינוי בינוי ובתמ"א 38.');
  }

  const areas = computeAreas(inputs);
  const revenue = computeRevenue(inputs, areas);
  const costs = computeCosts(inputs, areas, revenue);
  const profitability = computeProfitability(revenue, costs, inputs.costs);
  const unitAllocation = computeUnitAllocation(inputs, costs);

  const feasibility: FeasibilityMetrics = {
    breakEven: computeBreakEven(inputs, revenue.developerRevenueExclVatNis),
    residualLandValueNis: computeResidualLandValue(inputs),
    sensitivityMatrix: computeSensitivityMatrix(inputs),
  };

  return { areas, revenue, costs, profitability, unitAllocation, feasibility, warnings };
}
