import * as XLSX from "xlsx";
import { isCashLandDeal, profitToCostBenchmark } from "../calc/engine";
import type { ProjectInputs, ProjectResult, UnitCategory } from "../calc/types";

const DEAL_TYPE_LABEL: Record<ProjectInputs["dealType"], string> = {
  basic: "דוח אפס בסיסי",
  tama38: 'תמ"א 38',
  pinuyBinui: "פינוי בינוי",
  kombinatsia: "קומבינציה בעין",
  kombinatsiaTemurot: "קומבינצית תמורות",
  purchaseGroup: "קבוצת רכישה",
  mixedUse: "מעורב מגורים ותעסוקה",
};

const CATEGORY_LABEL: Record<UnitCategory, string> = {
  residential: "מגורים",
  residentialPremium: "מגורים פרימיום",
  commercial: "מסחר",
  office: "משרדים",
  publicBuilding: 'מב"צ',
};

function priceVatBasis(category: UnitCategory | undefined): string {
  const resolved = category ?? "residential";
  return resolved === "residential" || resolved === "residentialPremium" ? "כולל מע\"מ" : "ללא מע\"מ";
}

function round(n: number): number {
  return Math.round(n);
}

export function buildWorkbook(inputs: ProjectInputs, result: ProjectResult): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // גיליון 1: פרטי פרויקט
  const overviewRows: (string | number)[][] = [
    ["דוח אפס, טיוטת חישוב"],
    [],
    ["שם הפרויקט", inputs.projectName],
    ["סוג עסקה", DEAL_TYPE_LABEL[inputs.dealType]],
    ...(inputs.dealType === "mixedUse"
      ? [
          ["אחוז בעלים במגורים", inputs.land.mixedUseResidentialOwnerShare ?? inputs.land.combinationOwnerShare],
          ["אחוז בעלים במסחר", inputs.land.mixedUseCommercialOwnerShare ?? inputs.land.combinationOwnerShare],
          ["אחוז בעלים במשרדים", inputs.land.mixedUseOfficeOwnerShare ?? inputs.land.combinationOwnerShare],
        ]
      : []),
    ["תאריך הפקה", new Date().toLocaleDateString("he-IL")],
    [],
    ["כלי חישוב עזר בלבד. כל נתון שהוזן הוא באחריות המזין. אינו מהווה חוות דעת שמאית ואינו תחליף לבדיקת שמאי מקרקעין מוסמך."],
    ["ההכנסות והעלויות בדוח, לרבות ברווח לעלות, מוצגות לא כולל מע\"מ. מחיר קלט למגורים כולל מע\"מ; מחיר קלט למסחר ולמשרדים אינו כולל מע\"מ."],
  ];
  const wsOverview = XLSX.utils.aoa_to_sheet(overviewRows);
  wsOverview["!cols"] = [{ wch: 24 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, wsOverview, "פרטי פרויקט");

  // גיליון 2: תמהיל דירות
  const unitRows: (string | number)[][] = [
    ["טיפוס", "קטגוריה", "בסיס מע\"מ במחיר", "יחידת תמורה", "מבנה קיים", "כמות", "שטח עיקרי (מ\"ר)", "ממ\"ד (מ\"ר)", "מרפסת (מ\"ר)", "מרפסת גג (מ\"ר)", "מחיר ליחידה (₪)"],
    ...inputs.units.map((u) => [
      u.name,
      CATEGORY_LABEL[u.category ?? "residential"],
      priceVatBasis(u.category),
      u.isCompensationUnit ? "כן" : "",
      u.isExistingStructure ? "כן" : "",
      u.count,
      u.areaSqm,
      u.mamadSqm,
      u.balconySqm,
      u.roofBalconySqm,
      u.priceNis,
    ]),
  ];
  const wsUnits = XLSX.utils.aoa_to_sheet(unitRows);
  wsUnits["!cols"] = [{ wch: 24 }, { wch: 16 }, { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsUnits, "תמהיל דירות");

  // גיליון 3: כל הנחות הקלט שהובילו לתוצאה. בלי גיליון זה הקובץ אינו ניתן לשחזור/ביקורת:
  // התמהיל לבדו אינו מסביר עלויות בנייה, קרקע, אגרות או מימון.
  const assumptionRows: (string | number)[][] = [
    ["הנחות ועלויות קלט"],
    [],
    ["קרקע"],
    ["רכישת קרקע (₪)", inputs.land.landPurchaseNis],
    ["היטל השבחה (₪)", inputs.land.bettermentLevyNis],
    ["אחוז קומבינציה/בעלים (%)", inputs.land.combinationOwnerShare * 100],
    ...(inputs.dealType === "mixedUse"
      ? [
          ["אחוז בעלים במגורים (%)", (inputs.land.mixedUseResidentialOwnerShare ?? inputs.land.combinationOwnerShare) * 100],
          ["אחוז בעלים במסחר (%)", (inputs.land.mixedUseCommercialOwnerShare ?? inputs.land.combinationOwnerShare) * 100],
          ["אחוז בעלים במשרדים (%)", (inputs.land.mixedUseOfficeOwnerShare ?? inputs.land.combinationOwnerShare) * 100],
        ]
      : []),
    ["שווי קרקע לצורך מס רכישה (₪)", inputs.land.combinationLandValueForTaxNis],
    [],
    ["בנייה"],
    ["עלות מגורים למ״ר (₪)", inputs.costs.mainConstructionCostPerSqm],
    ["עלות מגורים פרימיום למ״ר (₪)", inputs.costs.premiumConstructionCostPerSqm],
    ["עלות מסחר למ״ר (₪)", inputs.costs.commercialConstructionCostPerSqm],
    ["עלות משרדים למ״ר (₪)", inputs.costs.officeConstructionCostPerSqm],
    ["עלות מב״צ למ״ר (₪)", inputs.costs.publicBuildingConstructionCostPerSqm],
    ["עלות חיזוק מבנה קיים למ״ר (₪)", inputs.costs.reinforcementCostPerSqm],
    ["עלות מרתף למ״ר (₪)", inputs.costs.undergroundConstructionCostPerSqm],
    ["שטח מרתף (מ״ר)", inputs.costs.undergroundAreaSqm],
    ["שטח מגרש נטו (מ״ר)", inputs.costs.netPlotAreaSqm],
    ["עלות פיתוח למ״ר (₪)", inputs.costs.developmentCostPerSqm],
    ["הריסה ופינוי, סכום קבוע (₪)", inputs.costs.demolitionFlatNis],
    ["מקדם עלות מרפסות (%)", inputs.costs.balconyConstructionCostRatio * 100],
    ["מקדם שטח שיווק למרפסות (%)", inputs.costs.balconyWeight * 100],
    [],
    ["עלויות עקיפות ועמלות"],
    ["תיווך (%)", inputs.costs.brokerageRate * 100],
    ["מס רכישה (%)", inputs.costs.purchaseTaxRate * 100],
    ["חיבור חשמל ליח״ד (₪)", inputs.costs.electricConnectionPerUnitNis],
    ["תכנון קבוע (₪)", inputs.costs.planningFlatNis],
    ["תכנון ויועצים מעלות בנייה (%)", inputs.costs.planningConsultantsRate * 100],
    ["פיקוח הנדסי קבוע (₪)", inputs.costs.engineeringInspectionFlatNis],
    ["שיווק (%)", inputs.costs.marketingRate * 100],
    ["משפטי (%)", inputs.costs.legalRate * 100],
    ["החזר שכ״ט עו״ד ליח״ד (₪)", inputs.costs.legalRefundPerUnitNis],
    ["פיקוח פיננסי קבוע (₪)", inputs.costs.financialSupervisionFlatNis],
    ["תקורות (%)", inputs.costs.overheadRate * 100],
    ["דמי ניהול אופציונליים (%)", inputs.costs.managementFeeRate * 100],
    ["בצ״מ (%)", inputs.costs.contingencyRate * 100],
    ["עמלת ערבות (%)", inputs.costs.guaranteeCommissionRate * 100],
    ["עמלת אי ניצול אשראי (%)", inputs.costs.unusedCreditCommissionRate * 100],
    ["עמלת פתיחת תיק (%)", inputs.costs.accountOpeningCommissionRate * 100],
    [],
    ["מימון ולוחות זמנים"],
    ["ריבית שנתית (%)", inputs.costs.annualInterestRate * 100],
    ["תקופה עד היתר (חודשים)", inputs.costs.permitMonths],
    ["תקופת בנייה (חודשים)", inputs.costs.constructionMonths],
    ["הון עצמי (₪)", inputs.costs.equityNis],
    ["מכירה מוקדמת (%)", inputs.costs.presaleRate * 100],
    ["שכר מארגן (₪)", inputs.costs.organizerFeeNis],
    ...(inputs.dealType === "purchaseGroup"
      ? [
          ["הכנסת מארגן מסיחור אופציה (₪)", inputs.costs.organizerOptionTradingNis ?? 0],
          ["שיווק המארגן משווי הפרויקט (%)", (inputs.costs.organizerMarketingRate ?? 0.025) * 100],
          ["תקורות המארגן מהבנייה הישירה (%)", (inputs.costs.organizerOverheadRate ?? 0.025) * 100],
        ]
      : []),
    [],
    ["דיור חלופי"],
    ["יחידות זכאיות", inputs.costs.relocationUnitsCount],
    ["משך תשלום (חודשים)", inputs.costs.relocationMonths],
    ["שכירות חודשית ליחידה (₪)", inputs.costs.relocationRentPerUnitMonthlyNis],
    [],
    ["אגרות והיטלים עירוניים, תעריפים"],
    ["אגרת בנייה למ״ר (₪)", inputs.costs.municipalFees.buildingFeeRatePerSqm],
    ["מים למ״ר (₪)", inputs.costs.municipalFees.waterConnectionRatePerSqm],
    ["ביוב למ״ר (₪)", inputs.costs.municipalFees.sewageConnectionRatePerSqm],
    ["כביש/תיעול לפי מגרש למ״ר (₪)", inputs.costs.municipalFees.roadDrainagePlotRatePerSqm],
    ["כביש/תיעול לפי בנייה למ״ר (₪)", inputs.costs.municipalFees.roadDrainageBuildingRatePerSqm],
    ["כביש/תיעול לפי מרתף למ״ר (₪)", inputs.costs.municipalFees.roadDrainageUndergroundRatePerSqm],
  ];
  const wsAssumptions = XLSX.utils.aoa_to_sheet(assumptionRows);
  wsAssumptions["!cols"] = [{ wch: 38 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, wsAssumptions, "הנחות ועלויות");

  // גיליון 4: תוצאות
  const resultRows: (string | number)[][] = [
    ["שטחים"],
    ["שטח עיקרי (מ\"ר)", round(result.areas.totalMainAreaSqm)],
    ["ממ\"ד (מ\"ר)", round(result.areas.totalMamadSqm)],
    ["מרפסות (מ\"ר)", round(result.areas.totalBalconySqm)],
    ["מרפסות גג (מ\"ר)", round(result.areas.totalRoofBalconySqm)],
    ["שטח לשיווק (מ\"ר)", round(result.areas.totalMarketableAreaSqm)],
    ["יחידות דיור", result.areas.unitCount],
    [],
    ["הכנסות"],
    ["סה\"כ הכנסה כולל מע\"מ (₪)", round(result.revenue.totalRevenueInclVatNis)],
    ["סה\"כ הכנסה לא כולל מע\"מ (₪)", round(result.revenue.totalRevenueExclVatNis)],
    ["הכנסת היזם, לא כולל מע\"מ (₪)", round(result.revenue.developerRevenueExclVatNis)],
    ["מחיר ממוצע למ\"ר (₪)", round(result.revenue.averagePricePerSqmNis)],
    [],
    ["עלויות (לא כולל מע\"מ)"],
    [isCashLandDeal(inputs.dealType) ? "קרקע (₪)" : "היטל השבחה (₪)", round(result.costs.landNis)],
    ["עקיפות (₪)", round(result.costs.indirectNis)],
    ["עמלות מימון (₪)", round(result.costs.commissionsNis)],
    ["בנייה ישירה (₪)", round(result.costs.directConstructionNis)],
    ["מימון (₪)", round(result.costs.financingNis)],
    ["סה\"כ עלויות (₪)", round(result.costs.totalInclFinancingNis)],
    [],
    ["רווחיות"],
    ["רווח שוטף (₪)", round(result.profitability.currentProfitNis)],
    ["רווח לעלות (%)", Number((result.profitability.profitToCostRatio * 100).toFixed(1))],
    ...(profitToCostBenchmark(inputs.dealType) !== null
      ? [["סף מקובל בשוק, להשוואה (%)", Number((profitToCostBenchmark(inputs.dealType)! * 100).toFixed(1))]]
      : []),
    ["רווח למחזור (%)", Number((result.profitability.profitToRevenueRatio * 100).toFixed(1))],
    ...(result.profitability.cashOnCashAnnualRatio !== 0
      ? [["תשואה על ההון העצמי לשנה (%)", Number((result.profitability.cashOnCashAnnualRatio * 100).toFixed(1))]]
      : []),
    ...(() => {
      const showResidualLandValue = isCashLandDeal(inputs.dealType) && profitToCostBenchmark(inputs.dealType) !== null;
      if (result.feasibility.breakEven.averagePricePerSqmNis === null && !showResidualLandValue) return [];
      return [
        [],
        ["מדדי היתכנות (מדדי עזר, לא שומה)"],
        ...(result.feasibility.breakEven.averagePricePerSqmNis !== null
          ? [
              ["מחיר ממוצע למ\"ר בנקודת האיזון (₪)", round(result.feasibility.breakEven.averagePricePerSqmNis)],
              ["מרווח ביטחון בהכנסות (%)", Number((result.feasibility.breakEven.marginOfSafetyRatio! * 100).toFixed(1))],
            ]
          : []),
        ...(showResidualLandValue
          ? [["שווי קרקע שיורי, ליעד רווח-לעלות מקובל (₪)", result.feasibility.residualLandValueNis !== null ? round(result.feasibility.residualLandValueNis) : "לא מושג בטווח שנבדק"]]
          : []),
      ];
    })(),
    [],
    ["ניתוח רגישות"],
    ["תרחיש", "רווח (₪)", "רווח לעלות (%)"],
    ...[
      { label: "לפי התחזית", revenueFactor: 1, costFactor: 1 },
      { label: "עלויות בנייה +10%", revenueFactor: 1, costFactor: 1.1 },
      { label: "הכנסות -10%", revenueFactor: 0.9, costFactor: 1 },
      { label: "עלויות בנייה +10%, הכנסות -10%", revenueFactor: 0.9, costFactor: 1.1 },
    ].map((scenario) => {
      const cell = result.feasibility.sensitivityMatrix.find(
        (c) => c.revenueFactor === scenario.revenueFactor && c.costFactor === scenario.costFactor
      )!;
      return [scenario.label, round(cell.profitNis), Number((cell.profitToCostRatio * 100).toFixed(1))];
    }),
    ...(result.unitAllocation.length > 0
      ? [
          [],
          ["בדיקת הקצאה והוגנות בין דיירים/שותפים"],
          ["טיפוס", "אחוז יחסי (%)", "עלות ליחידה (₪)", "שווי שוק ליחידה (₪)", "פער ליחידה (₪)", "יחס פער-לעלות (%)"],
          ...result.unitAllocation.map((row) => [
            row.name,
            Number((row.sharePercent * 100).toFixed(1)),
            round(row.costBasisPerUnitNis),
            round(row.marketValuePerUnitNis),
            round(row.gapPerUnitNis),
            Number((row.gapRatio * 100).toFixed(1)),
          ]),
        ]
      : []),
  ];
  const wsResults = XLSX.utils.aoa_to_sheet(resultRows);
  wsResults["!cols"] = [{ wch: 30 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsResults, "תוצאות");

  if (result.organizerProfitability) {
    const organizer = result.organizerProfitability;
    const wsOrganizer = XLSX.utils.aoa_to_sheet([
      ["תחשיב פנימי נפרד, מארגן קבוצת הרכישה"],
      ["הכנסה ממכירת הקרקע לקבוצה (₪)", round(organizer.landRevenueNis)],
      ["הכנסה מסיחור אופציה (₪)", round(organizer.optionTradingRevenueNis)],
      ["הכנסה מדמי ניהול/ארגון (₪)", round(organizer.managementRevenueNis)],
      ["סה״כ הכנסות המארגן (₪)", round(organizer.totalRevenueNis)],
      [],
      ["רכישת הקרקע (₪)", round(organizer.landAcquisitionNis)],
      ["מס רכישה (₪)", round(organizer.purchaseTaxNis)],
      ["תיווך (₪)", round(organizer.brokerageNis)],
      ["שיווק ופרסום (₪)", round(organizer.marketingNis)],
      ["תקורות וניהול (₪)", round(organizer.overheadNis)],
      ["סה״כ הוצאות המארגן (₪)", round(organizer.totalCostsNis)],
      [],
      ["רווח המארגן (₪)", round(organizer.profitNis)],
      ["רווח / הכנסות המארגן (%)", Number((organizer.profitToOrganizerRevenueRatio * 100).toFixed(1))],
    ]);
    wsOrganizer["!cols"] = [{ wch: 38 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, wsOrganizer, "תחשיב מארגן");
  }

  if (result.purchaseGroupAllocation) {
    const appendAllocationSheet = (
      sheetName: string,
      title: string,
      basisLabel: string,
      rows: typeof result.purchaseGroupAllocation.byMarketValue
    ) => {
      const sheet = XLSX.utils.aoa_to_sheet([
        [title],
        ["טיפוס", "כמות", "שווי שוק ליחידה (₪)", basisLabel, "חלק יחסי (%)", "קרקע ליחידה (₪)", "יתר העלויות ליחידה (₪)", "עלות כוללת ליחידה (₪)", "חיסכון גלום ליחידה (₪)", "חיסכון לעלות (%)"],
        ...rows.map((row) => [
          row.name,
          row.count,
          round(row.marketValuePerUnitNis),
          Number(row.allocationBasisPerUnit.toFixed(2)),
          Number((row.allocationShare * 100).toFixed(3)),
          round(row.landSharePerUnitNis),
          round(row.otherCostsSharePerUnitNis),
          round(row.totalCostPerUnitNis),
          round(row.embeddedSavingsPerUnitNis),
          Number((row.savingsToCostRatio * 100).toFixed(2)),
        ]),
      ]);
      sheet["!cols"] = [{ wch: 24 }, { wch: 8 }, ...Array.from({ length: 8 }, () => ({ wch: 20 }))];
      XLSX.utils.book_append_sheet(wb, sheet, sheetName);
    };
    appendAllocationSheet("חלוקה לפי שווי", "חלופה א׳, חלוקת עלויות לפי שווי", "שווי כבסיס חלוקה (₪)", result.purchaseGroupAllocation.byMarketValue);
    appendAllocationSheet("חלוקה לפי שטח", "חלופה ב׳, חלוקת עלויות לפי מ״ר אקוויוולנטי", "מ״ר אקוויוולנטי לעלות", result.purchaseGroupAllocation.byEquivalentArea);
  }

  return wb;
}

export function downloadWorkbook(inputs: ProjectInputs, result: ProjectResult) {
  const wb = buildWorkbook(inputs, result);
  const fileName = `דוח-אפס-${inputs.projectName || "פרויקט"}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, fileName);
}
