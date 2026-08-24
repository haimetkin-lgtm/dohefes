import type {
  ProjectInputs,
  AreaSummary,
  RevenueSummary,
  CostBreakdown,
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

// tama38/basic/purchaseGroup: קרקע נרכשת/משולמת במזומן, קלט ישיר.
// kombinatsia/pinuyBinui/kombinatsiaTemurot/mixedUse: קרקע "משולמת" באחוז חלוקה מהשטח הבנוי
// (לבעלי הקרקע/דיירים הקיימים), בלי תשלום כספי נפרד.
export function isCashLandDeal(dealType: DealType): boolean {
  return dealType === "tama38" || dealType === "basic" || dealType === "purchaseGroup";
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
    commercial: { mainAreaSqm: 0, otherAreaSqm: 0 },
    office: { mainAreaSqm: 0, otherAreaSqm: 0 },
  };

  for (const u of units) {
    const cat = unitCategory(u.category);
    const mainArea = u.count * u.areaSqm;
    const otherArea = u.count * (u.mamadSqm + u.balconySqm + u.roofBalconySqm);
    totalMainAreaSqm += mainArea;
    totalMamadSqm += u.count * u.mamadSqm;
    totalBalconySqm += u.count * u.balconySqm;
    totalRoofBalconySqm += u.count * u.roofBalconySqm;
    unitCount += u.count;
    areaByCategory[cat].mainAreaSqm += mainArea;
    areaByCategory[cat].otherAreaSqm += otherArea;
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
  };
}

export function computeRevenue(inputs: ProjectInputs, areas: AreaSummary): RevenueSummary {
  let totalRevenueInclVatNis = 0;
  let totalRevenueExclVatNis = 0;

  for (const u of inputs.units) {
    const inclVat = u.count * u.priceNis;
    totalRevenueInclVatNis += inclVat;
    // מגורים: המחיר שהוזן כולל מע"מ, מחולק ב-1.17. מסחר/משרדים: המחיר כבר נטו ממע"מ (04-מעורב-מגורים-ותעסוקה.md)
    totalRevenueExclVatNis += unitCategory(u.category) === "residential" ? inclVat / VAT_FACTOR : inclVat;
  }

  const developerShare = isCashLandDeal(inputs.dealType) ? 1 : 1 - inputs.land.combinationOwnerShare;
  const developerRevenueExclVatNis = totalRevenueExclVatNis * developerShare;

  const averagePricePerSqmNis =
    areas.totalMarketableAreaSqm > 0 ? totalRevenueInclVatNis / areas.totalMarketableAreaSqm : 0;

  return { totalRevenueInclVatNis, totalRevenueExclVatNis, developerRevenueExclVatNis, averagePricePerSqmNis };
}

export function computeCosts(inputs: ProjectInputs, areas: AreaSummary, revenue: RevenueSummary): CostBreakdown {
  const { costs, land, dealType } = inputs;

  // A. קרקע.
  const landNis = isCashLandDeal(dealType) ? land.landPurchaseNis + land.bettermentLevyNis : 0;

  // D. בנייה ישירה, תמיד על 100% מהבניין, ללא קשר לחלוקת קומבינציה. לכל קטגוריה עלות מ"ר משלה
  // (mixedUse בלבד, שאר סוגי העסקה משתמשים כולם ב-residential ולכן בעלות המגורים הרגילה).
  const costPerSqmByCategory: Record<UnitCategory, number> = {
    residential: costs.mainConstructionCostPerSqm,
    commercial: costs.commercialConstructionCostPerSqm || costs.mainConstructionCostPerSqm,
    office: costs.officeConstructionCostPerSqm || costs.mainConstructionCostPerSqm,
  };
  let categorizedConstructionNis = 0;
  (Object.keys(areas.areaByCategory) as UnitCategory[]).forEach((cat) => {
    const cost = costPerSqmByCategory[cat];
    const balconyCostPerSqm = cost * costs.balconyConstructionCostRatio;
    categorizedConstructionNis +=
      areas.areaByCategory[cat].mainAreaSqm * cost + areas.areaByCategory[cat].otherAreaSqm * balconyCostPerSqm;
    // הערה: otherAreaSqm כולל גם ממ"ד (לרוב רלוונטי רק למגורים, אבל אין נזק אם 0 בקטגוריות אחרות)
  });

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

  const indirectNis =
    costs.municipalFeesNis +
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

  const commissionsNis = guaranteeCommissionNis + unusedCreditCommissionNis;

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
  };
}

export function computeProfitability(revenue: RevenueSummary, costs: CostBreakdown): ProfitabilitySummary {
  const revenueNis = revenue.developerRevenueExclVatNis;
  const totalCostNis = costs.totalInclFinancingNis;
  const currentProfitNis = revenueNis - totalCostNis;
  const profitToCostRatio = totalCostNis !== 0 ? currentProfitNis / totalCostNis : 0;
  return { revenueNis, totalCostNis, currentProfitNis, profitToCostRatio };
}

export function computeProject(inputs: ProjectInputs): ProjectResult {
  const warnings: string[] = [];

  if (inputs.units.length === 0) {
    warnings.push("לא הוזנו יחידות דיור.");
  }
  if (!isCashLandDeal(inputs.dealType) && inputs.land.combinationOwnerShare <= 0) {
    warnings.push("אחוז החלוקה לבעלי הקרקע/הדיירים הקיימים הוא 0 או לא הוזן, כדאי לבדוק.");
  }
  if (isCashLandDeal(inputs.dealType) && inputs.land.landPurchaseNis <= 0) {
    warnings.push("לא הוזנה עלות רכישת קרקע.");
  }
  if (inputs.dealType === "pinuyBinui" && inputs.costs.relocationUnitsCount <= 0) {
    warnings.push('לא הוזן מספר יחידות קיימות לדמי שכירות לתקופת הבנייה, כמעט תמיד רלוונטי בפינוי בינוי.');
  }

  const areas = computeAreas(inputs);
  const revenue = computeRevenue(inputs, areas);
  const costs = computeCosts(inputs, areas, revenue);
  const profitability = computeProfitability(revenue, costs);

  return { areas, revenue, costs, profitability, warnings };
}
