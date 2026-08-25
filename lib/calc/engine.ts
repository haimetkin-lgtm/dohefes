import type {
  ProjectInputs,
  AreaSummary,
  RevenueSummary,
  CostBreakdown,
  ConstructionCostRow,
  MunicipalFeeInputs,
  ProfitabilitySummary,
  ProjectResult,
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

const VAT_FACTOR = 1.17;

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

export function computeAreas(inputs: ProjectInputs): AreaSummary {
  const { units, costs } = inputs;
  let totalMainAreaSqm = 0;
  let totalMamadSqm = 0;
  let totalBalconySqm = 0;
  let totalRoofBalconySqm = 0;
  let unitCount = 0;

  const areaByCategory: AreaSummary["areaByCategory"] = {
    residential: { mainAreaSqm: 0, otherAreaSqm: 0 },
    residentialPremium: { mainAreaSqm: 0, otherAreaSqm: 0 },
    commercial: { mainAreaSqm: 0, otherAreaSqm: 0 },
    office: { mainAreaSqm: 0, otherAreaSqm: 0 },
    publicBuilding: { mainAreaSqm: 0, otherAreaSqm: 0 },
  };
  let existingStructureAreaSqm = 0;
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
      existingStructureOtherAreaSqm += otherArea;
    } else {
      areaByCategory[cat].mainAreaSqm += mainArea;
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
    existingStructureOtherAreaSqm,
  };
}

export function computeRevenue(inputs: ProjectInputs, areas: AreaSummary): RevenueSummary {
  let totalRevenueInclVatNis = 0;
  let totalRevenueExclVatNis = 0;
  // unitCompensation בלבד: סכום ההכנסה מהיחידות שאינן יחידות תמורה, נצבר תוך כדי הלולאה
  let nonCompensationRevenueExclVatNis = 0;

  const mechanism = landMechanism(inputs.dealType);

  for (const u of inputs.units) {
    const inclVat = u.count * u.priceNis;
    totalRevenueInclVatNis += inclVat;
    // מגורים (רגיל או פרימיום): המחיר שהוזן כולל מע"מ, מחולק ב-1.17. מסחר/משרדים: המחיר כבר נטו ממע"מ (04-מעורב-מגורים-ותעסוקה.md)
    const cat = unitCategory(u.category);
    const isResidential = cat === "residential" || cat === "residentialPremium";
    const exclVat = isResidential ? inclVat / VAT_FACTOR : inclVat;
    totalRevenueExclVatNis += exclVat;
    if (mechanism === "unitCompensation" && !u.isCompensationUnit) {
      nonCompensationRevenueExclVatNis += exclVat;
    }
  }

  // הכנסת היזם, לפי שיטת תשלום הקרקע/הזכויות (ר' landMechanism):
  // cash=100%, unitCompensation=הכנסה מהיחידות שאינן תמורה בלבד, percentageSplit=אחוז אחיד מהכל.
  const developerRevenueExclVatNis =
    mechanism === "cash"
      ? totalRevenueExclVatNis
      : mechanism === "unitCompensation"
        ? nonCompensationRevenueExclVatNis
        : totalRevenueExclVatNis * (1 - inputs.land.combinationOwnerShare);

  const averagePricePerSqmNis =
    areas.totalMarketableAreaSqm > 0 ? totalRevenueInclVatNis / areas.totalMarketableAreaSqm : 0;

  return { totalRevenueInclVatNis, totalRevenueExclVatNis, developerRevenueExclVatNis, averagePricePerSqmNis };
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
    const { mainAreaSqm, otherAreaSqm } = areas.areaByCategory[cat];
    if (mainAreaSqm === 0 && otherAreaSqm === 0) return;
    const cost = costPerSqmByCategory[cat];
    const balconyCostPerSqm = cost * costs.balconyConstructionCostRatio;
    const mainCostNis = mainAreaSqm * cost;
    const otherCostNis = otherAreaSqm * balconyCostPerSqm;
    categorizedConstructionNis += mainCostNis + otherCostNis;
    // הערה: otherAreaSqm כולל גם ממ"ד (לרוב רלוונטי רק למגורים, אבל אין נזק אם 0 בקטגוריות אחרות)
    constructionBreakdown.push({ category: cat, mainAreaSqm, mainCostNis, otherAreaSqm, otherCostNis });
  });

  // חיזוק שלד קיים (תמ"א 38 חיזוק ותוספת), עלות נפרדת לגמרי מהקטגוריות, ר' UnitType.isExistingStructure.
  // "פסאודו-קטגוריה" משלה בפירוט, לא מעורבבת עם עלות בנייה חדשה של אותה קטגוריה.
  if (areas.existingStructureAreaSqm > 0 || areas.existingStructureOtherAreaSqm > 0) {
    const reinforcementRate = costs.reinforcementCostPerSqm || costs.mainConstructionCostPerSqm;
    const reinforcementBalconyRate = reinforcementRate * costs.balconyConstructionCostRatio;
    const mainCostNis = areas.existingStructureAreaSqm * reinforcementRate;
    const otherCostNis = areas.existingStructureOtherAreaSqm * reinforcementBalconyRate;
    categorizedConstructionNis += mainCostNis + otherCostNis;
    constructionBreakdown.push({
      category: "existingStructure",
      mainAreaSqm: areas.existingStructureAreaSqm,
      mainCostNis,
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
  const brokerageNis = landNis > 0 ? landNis * costs.brokerageRate : 0;
  const purchaseTaxNis = purchaseTaxBasis * costs.purchaseTaxRate;
  const electricNis = areas.unitCount * costs.electricConnectionPerUnitNis;
  const planningConsultantsNis = directConstructionNis * costs.planningConsultantsRate;
  const engineeringInspectionNis = costs.engineeringInspectionFlatNis;
  const marketingNis = revenue.developerRevenueExclVatNis * costs.marketingRate;
  const legalNis = revenue.developerRevenueExclVatNis * VAT_FACTOR * costs.legalRate;
  const legalRefundNis = areas.unitCount * costs.legalRefundPerUnitNis;
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
  const guaranteeCommissionNis = revenue.totalRevenueInclVatNis * costs.guaranteeCommissionRate * 0.5;

  const totalDirectAndIndirect = directConstructionNis + indirectNis + landNis;
  const presaleInflowNis = revenue.developerRevenueExclVatNis * VAT_FACTOR * costs.presaleRate;
  const creditFacilityNis = Math.max(0, totalDirectAndIndirect - costs.equityNis - presaleInflowNis);
  const unusedCreditCommissionNis = creditFacilityNis * costs.unusedCreditCommissionRate * 0.5;
  // עמלת פתיחת תיק, % מהכנסות היזם כולל מע"מ (לא מהתזרים כמו שתי העמלות האחרות)
  const accountOpeningCommissionNis = revenue.developerRevenueExclVatNis * VAT_FACTOR * costs.accountOpeningCommissionRate;

  const commissionsNis = guaranteeCommissionNis + unusedCreditCommissionNis + accountOpeningCommissionNis;

  // F. מימון, מפושט: ריבית פשוטה על יתרת חוב ממוצעת (הנחת פריסה ליניארית).
  const avgOutstandingBalanceNis = creditFacilityNis / 2;
  const financingNis = avgOutstandingBalanceNis * costs.annualInterestRate * (costs.constructionMonths / 12);

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

export function computeProject(inputs: ProjectInputs): ProjectResult {
  const warnings: string[] = [];

  if (inputs.units.length === 0) {
    warnings.push("לא הוזנו יחידות דיור.");
  }
  const mechanism = landMechanism(inputs.dealType);
  if (mechanism === "percentageSplit" && inputs.land.combinationOwnerShare <= 0) {
    warnings.push("אחוז החלוקה לבעל הקרקע הוא 0 או לא הוזן, כדאי לבדוק.");
  }
  if (mechanism === "cash" && inputs.land.landPurchaseNis <= 0) {
    warnings.push("לא הוזנה עלות רכישת קרקע.");
  }
  if (mechanism === "unitCompensation" && !inputs.units.some((u) => u.isCompensationUnit)) {
    warnings.push('לא סומנה אף יחידת "תמורה" בטבלת התמהיל, כמעט תמיד יש דיירים קיימים שמקבלים דירת תמורה בסוג עסקה זה.');
  }
  if (inputs.dealType === "pinuyBinui" && inputs.costs.relocationUnitsCount <= 0) {
    warnings.push('לא הוזן מספר יחידות קיימות לדמי שכירות לתקופת הבנייה, כמעט תמיד רלוונטי בפינוי בינוי.');
  }

  const areas = computeAreas(inputs);
  const revenue = computeRevenue(inputs, areas);
  const costs = computeCosts(inputs, areas, revenue);
  const profitability = computeProfitability(revenue, costs, inputs.costs);

  return { areas, revenue, costs, profitability, warnings };
}
