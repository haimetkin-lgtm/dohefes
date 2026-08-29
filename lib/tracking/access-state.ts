// State machine טהור למסך /tracking (Commit 5b) - שום תלות ב-React/window/timers/Supabase,
// אותו עיקרון בדיוק כמו lib/payment/payment-return-state.ts: הרכיב React הוא רק "מנוע" -
// מדווח אירועים חיצוניים (reportId נפתר/entitlement נבדק/נתונים נטענו/נשמרו וכו') ומצייר לפי
// ה-state שחוזר. מאפשר לבדוק את כל לוגיקת המעברים ב-Vitest טהור, בלי jsdom.
//
// **עשרת המצבים המפורשים שהתבקשו, בדיוק** (לא פחות, לא יותר): invalidReportId, loading,
// purchaseRequired, checkoutPending, accessUnavailable, activeLoadingData, active,
// saveInProgress, saveError, loadError. עורך המעקב לא מוצג לפני "active" (ר' isEditorVisible
// למטה) - זה נאכף כאן ברמת הטיפוס/המעברים, לא רק כמוסכמת-רינדור ברכיב.

import type { TrackingItem } from "./types";

export type TrackingAccessState =
  /** reportId עוד לא נפתר סופית (עדיין null) - ברגע שנודע, state נשאר "loading" אך reportId
   *  מתמלא, עד שגם ה-entitlement נפתר. */
  | { kind: "loading"; reportId: string | null }
  | { kind: "invalidReportId" }
  /** אין entitlement פעילה, ואין pending purchase ניתן לחידוש - paywall: שם+מחיר מהקטלוג,
   *  כפתור רכישה יחיד. */
  | { kind: "purchaseRequired"; reportId: string }
  /** קיימת pending purchase תקינה (order נוצר) - "המשך לתשלום" במקום כפתור רכישה חדש.
   *  **paymentContextId, לא checkoutUrl** - חידוש עובר תמיד דרך resumePendingCheckout
   *  (payment-client.ts), שמאמתת מול השרת ומחזירה checkoutUrl מאומת-מחדש - לא פותחים את
   *  ה-checkoutUrl השמור מקומית ישירות/עיוור. */
  | { kind: "checkoutPending"; reportId: string; paymentContextId: string }
  /** entitlement נמצאה במצב שאינו active (revoked/refunded), או ש-dohefes-get-product-access
   *  החזירה unavailable כש-**היה** לנו רישום מקומי פעיל קודם - שונה מ-purchaseRequired (שם אין
   *  שום רישום מקומי קודם בכלל) - הודעה שונה, לא paywall גנרי. */
  | { kind: "accessUnavailable"; reportId: string }
  /** entitlement פעילה אומתה - טוענים נתוני מעקב דרך dohefes-get-tracking-data. */
  | { kind: "activeLoadingData"; reportId: string; accessToken: string }
  /** entitlement פעילה + נתונים נטענו - **המצב היחיד** שבו העורך (ולכן גם Excel/הדפסה) מוצג. */
  | { kind: "active"; reportId: string; accessToken: string; entries: readonly TrackingItem[] }
  /** שמירה פעילה כרגע - entries נשמרים (לא נמחקים) כדי שהעורך ימשיך להציג אותם. */
  | { kind: "saveInProgress"; reportId: string; accessToken: string; entries: readonly TrackingItem[] }
  /** שמירה נכשלה - entries **המקומיים נשמרים כמות שהם**, לא מוחלפים בנתונים ישנים מהשרת - ניתן
   *  לנסות שוב (RETRY_SAVE) או להמשיך לערוך (מוביל בחזרה ל-active). */
  | { kind: "saveError"; reportId: string; accessToken: string; entries: readonly TrackingItem[]; error: string }
  /** טעינת הנתונים הראשונית נכשלה - **אין** entries בכלל עדיין (לא מוצגים נתונים ישנים כאילו
   *  הם עדכניים) - ניתן לנסות שוב (RETRY_LOAD). */
  | { kind: "loadError"; reportId: string; accessToken: string };

export type TrackingAccessEvent =
  | { type: "REPORT_ID_RESOLVED"; reportId: string }
  | { type: "REPORT_ID_INVALID" }
  | { type: "ENTITLEMENT_ACTIVE"; accessToken: string }
  | { type: "ENTITLEMENT_PENDING"; paymentContextId: string }
  | { type: "ENTITLEMENT_NONE" }
  | { type: "ENTITLEMENT_UNAVAILABLE" }
  | { type: "DATA_LOAD_SUCCEEDED"; entries: readonly TrackingItem[] }
  | { type: "DATA_LOAD_FAILED" }
  | { type: "RETRY_LOAD" }
  /** עריכה מקומית (המשתמש הקליד) - מעדכנת entries בתוך active/saveInProgress/saveError; מ-
   *  saveError מחזירה ל-active (עריכה נוספת "מנקה" את מצב השגיאה, לא דורשת RETRY_SAVE מפורש -
   *  ה-autosave החיצוני יתזמן שמירה חדשה ממילא). */
  | { type: "EDIT_ENTRIES"; entries: readonly TrackingItem[] }
  | { type: "SAVE_STARTED" }
  | { type: "SAVE_SUCCEEDED" }
  | { type: "SAVE_FAILED"; error: string }
  | { type: "RETRY_SAVE" };

export const INITIAL_TRACKING_ACCESS_STATE: TrackingAccessState = { kind: "loading", reportId: null };

/**
 * מעבר מצב יחיד, טהור - ללא side effects. אירוע לא-רלוונטי למצב הנוכחי מוחזר כמו שהוא, ללא
 * שינוי - לא זורק (אותו עיקרון בדיוק כמו payment-return-state.ts - מגן מפני תשובת רשת מאוחרת
 * שמגיעה אחרי שהמשתמש כבר עבר הלאה).
 */
export function reduceTrackingAccessState(state: TrackingAccessState, event: TrackingAccessEvent): TrackingAccessState {
  switch (event.type) {
    case "REPORT_ID_RESOLVED":
      if (state.kind !== "loading" || state.reportId !== null) return state;
      return { kind: "loading", reportId: event.reportId };

    case "REPORT_ID_INVALID":
      if (state.kind !== "loading" || state.reportId !== null) return state;
      return { kind: "invalidReportId" };

    case "ENTITLEMENT_ACTIVE":
      if (state.kind !== "loading" || state.reportId === null) return state;
      return { kind: "activeLoadingData", reportId: state.reportId, accessToken: event.accessToken };

    case "ENTITLEMENT_PENDING":
      if (state.kind !== "loading" || state.reportId === null) return state;
      return { kind: "checkoutPending", reportId: state.reportId, paymentContextId: event.paymentContextId };

    case "ENTITLEMENT_NONE":
      if (state.kind !== "loading" || state.reportId === null) return state;
      return { kind: "purchaseRequired", reportId: state.reportId };

    case "ENTITLEMENT_UNAVAILABLE":
      if (state.kind !== "loading" || state.reportId === null) return state;
      return { kind: "accessUnavailable", reportId: state.reportId };

    case "DATA_LOAD_SUCCEEDED":
      if (state.kind !== "activeLoadingData") return state;
      return { kind: "active", reportId: state.reportId, accessToken: state.accessToken, entries: event.entries };

    case "DATA_LOAD_FAILED":
      if (state.kind !== "activeLoadingData") return state;
      return { kind: "loadError", reportId: state.reportId, accessToken: state.accessToken };

    case "RETRY_LOAD":
      if (state.kind !== "loadError") return state;
      return { kind: "activeLoadingData", reportId: state.reportId, accessToken: state.accessToken };

    case "EDIT_ENTRIES":
      if (state.kind === "active" || state.kind === "saveInProgress") {
        return { ...state, entries: event.entries };
      }
      if (state.kind === "saveError") {
        return { kind: "active", reportId: state.reportId, accessToken: state.accessToken, entries: event.entries };
      }
      return state;

    case "SAVE_STARTED":
      if (state.kind !== "active") return state;
      return { kind: "saveInProgress", reportId: state.reportId, accessToken: state.accessToken, entries: state.entries };

    case "SAVE_SUCCEEDED":
      if (state.kind !== "saveInProgress") return state;
      return { kind: "active", reportId: state.reportId, accessToken: state.accessToken, entries: state.entries };

    case "SAVE_FAILED":
      if (state.kind !== "saveInProgress") return state;
      return { kind: "saveError", reportId: state.reportId, accessToken: state.accessToken, entries: state.entries, error: event.error };

    case "RETRY_SAVE":
      if (state.kind !== "saveError") return state;
      return { kind: "saveInProgress", reportId: state.reportId, accessToken: state.accessToken, entries: state.entries };
  }
}

/** true רק ב-active/saveInProgress/saveError - "אין להציג את עורך המעקב לפני מצב active",
 *  ונשאר מוצג דרך תקלות שמירה חולפות (לא נעלם כשה-save נכשל - הנתונים המקומיים ממשיכים
 *  להיות ניתנים לעריכה). */
export function isEditorVisible(state: TrackingAccessState): boolean {
  return state.kind === "active" || state.kind === "saveInProgress" || state.kind === "saveError";
}

/** 16. Excel/הדפסה נעולים לפני active, פעילים רק אחריו - אותו תנאי בדיוק כמו isEditorVisible
 *  (אין entries אמיתיים מהשרת לפני שהגענו ל-active לפחות פעם אחת). */
export const isTrackingExportUnlocked = isEditorVisible;
