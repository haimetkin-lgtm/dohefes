"use client";

// דוחות מעקב בנייה (trackingReports) - שער רכישה + entitlement + עורך, מחובר למנגנון התשלום
// המאובטח ולתשתית dohefes_tracking_data (Commit 5b, מוקשח ב-Commit 5b-fix). כל לוגיקת
// המעברים חיה ב-state machine טהורה נפרדת (lib/tracking/access-state.ts, נבדקת בעצמה) -
// הקומפוננטה הזו רק מריצה side effects (storage/רשת/timers/ניווט/autosave) לפי ה-state הנוכחי.
//
// **מקור זרימת הרכישה/resume**: reconciliation מול ענף gen2-cashflow-ui-implementation - שער
// ה-cashFlowAnalysis שם (לא הובא/ממוזג, רק שימש כתבנית להעתקה, ר' דוח ה-commit). productType
// כאן קבוע ל-"trackingReports" בלבד.
//
// **ביטול הגישה הישירה הישנה, לגמרי (Commit 5b-fix)**: הקובץ הזה **אינו מייבא Supabase table
// client כלל** (לא `.from`, לא `.select`, לא `.update`) - רק `supabase.functions` (ל-Edge
// Functions). שם הפרויקט לתצוגה **לא** נטען בנפרד מ-dohefes_reports - הוא מגיע **בתוך** תגובת
// dohefes-get-tracking-data המאובטחת עצמה, רק אחרי entitlement פעיל (ר' _shared/
// tracking-data-service.ts, migrations/20260829081055_dohefes_tracking_data.sql). לפני
// entitlement פעיל (paywall/pending/unavailable) - ניסוח כללי בלבד, אין שום קריאה אנונימית.

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { CATALOG, formatPriceNis } from "@/lib/catalog";
import { SITE_PATHS } from "@/lib/site";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { generateIdempotencyKey, getProductAccess, purchaseProduct, resumePendingCheckout } from "@/lib/payment/payment-client";
import { resolveActiveAccess, resolvePendingByReportAndProduct, revokeActiveAccess, touchActiveAccess } from "@/lib/payment/payment-storage";
import { getTrackingData, saveTrackingData } from "@/lib/payment/tracking-client";
import { downloadTrackingWorkbook } from "@/lib/report/exportTrackingExcel";
import { computeTrackingTotals, itemBudgetNis } from "@/lib/tracking/types";
import type { TrackingItem } from "@/lib/tracking/types";
import { decideAutosaveAction } from "@/lib/tracking/autosave";
import {
  INITIAL_TRACKING_ACCESS_STATE,
  isEditorVisible,
  isTrackingExportUnlocked,
  reduceTrackingAccessState,
} from "@/lib/tracking/access-state";
import type { TrackingAccessState } from "@/lib/tracking/access-state";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCT_TYPE = "trackingReports";
const AUTOSAVE_DELAY_MS = 1500;
/** מגבלה על מספר נסיונות שקטים אם dohefes-get-product-access מחזירה 'retryable' בשלב הבדיקה
 *  הראשונית - **לא** revoke על תקלה חולפת (אותו עיקרון בדיוק כמו שער ה-cashFlowAnalysis הישן
 *  בענף gen2-cashflow-ui-implementation). אחרי התקרה, נשארים במצב 'loading' (בלי הודעת שגיאה
 *  ייעודית - אין state כזה בעשרת המצבים שהוגדרו) - רענון ידני פותר. */
const MAX_ENTITLEMENT_CHECK_RETRIES = 5;

function emptyItem(): TrackingItem {
  return { id: crypto.randomUUID(), phase: "", description: "", quantity: 1, unitPriceNis: 0, actualNis: 0 };
}

function nis(n: number): string {
  return Math.round(n).toLocaleString("he-IL");
}

export default function TrackingPage() {
  const [state, dispatch] = useReducer(reduceTrackingAccessState, INITIAL_TRACKING_ACCESS_STATE);
  const [actionUi, setActionUi] = useState<{ kind: "idle" } | { kind: "working" } | { kind: "error"; message: string }>({ kind: "idle" });
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  // ref בלבד (לא state) - בקרת מרוץ, לא רינדור. אף פעם לא מועבר ל-renderByState/callbacks -
  // רק נקרא/נכתב בתוך effects, כדי לא להפר react-hooks/refs.
  const lastSavedSnapshotRef = useRef<string | null>(null);
  const activeSaveTokenRef = useRef<object | null>(null);
  const entitlementRetryCountRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // שלב 1: פענוח reportId מה-URL - פעם אחת. **אין קריאת Supabase כלשהי כאן** - שם הפרויקט
  // מגיע רק דרך dohefes-get-tracking-data, אחרי entitlement (ר' שלב 3).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id || !UUID_PATTERN.test(id) || !supabaseConfigured) {
      dispatch({ type: "REPORT_ID_INVALID" });
      return;
    }
    dispatch({ type: "REPORT_ID_RESOLVED", reportId: id });
  }, []);

  // שלב 2: reportId נפתר - קביעת מצב ה-entitlement. מקומי (active/pending) נבדק תחילה, ורק אם
  // יש token מקומי פעיל - אימות רשת אמיתי מול dohefes-get-product-access (כלל: אין להסתמך על
  // עצם קיום token מקומי כהוכחת הרשאה). token לא-פעיל מקומית + pending -> checkoutPending
  // (ללא בדיקת רשת - "תקינה" נבדקת מבנית: TTL+host מהימן, ר' payment-storage.ts/payment-client.ts).
  useEffect(() => {
    if (state.kind !== "loading" || state.reportId === null) return;
    const reportId = state.reportId;

    const active = resolveActiveAccess(window.localStorage, reportId, PRODUCT_TYPE);
    if (active) {
      let cancelled = false;
      getProductAccess(supabase.functions, { reportId, productType: PRODUCT_TYPE, accessToken: active.accessToken }).then((result) => {
        if (cancelled || !mountedRef.current) return;
        if (result.kind === "active") {
          touchActiveAccess(window.localStorage, reportId, PRODUCT_TYPE, new Date());
          entitlementRetryCountRef.current = 0;
          dispatch({ type: "ENTITLEMENT_ACTIVE", accessToken: active.accessToken });
        } else if (result.kind === "retryable") {
          entitlementRetryCountRef.current += 1;
          if (entitlementRetryCountRef.current <= MAX_ENTITLEMENT_CHECK_RETRIES) {
            window.setTimeout(() => {
              if (!cancelled && mountedRef.current) dispatch({ type: "REPORT_ID_RESOLVED", reportId }); // no-op ל-state הנוכחי, רק מרענן את ה-effect הזה מחדש דרך dependency
            }, 2000);
          }
        } else {
          revokeActiveAccess(window.localStorage, reportId, PRODUCT_TYPE);
          dispatch({ type: "ENTITLEMENT_UNAVAILABLE" });
        }
      });
      return () => {
        cancelled = true;
      };
    }

    const pending = resolvePendingByReportAndProduct(window.localStorage, reportId, PRODUCT_TYPE, new Date());
    if (pending.ok) {
      dispatch({ type: "ENTITLEMENT_PENDING", paymentContextId: pending.paymentContextId });
      return;
    }

    dispatch({ type: "ENTITLEMENT_NONE" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind, state.kind === "loading" ? state.reportId : null]);

  // שלב 3: activeLoadingData - טעינת נתוני המעקב (כולל project_name) **רק** דרך
  // dohefes-get-tracking-data. lastSavedSnapshotRef נקבע **לפני** ה-dispatch, כך שהאפקט של
  // שלב 4 (autosave) לא רואה "שינוי" ברגע הראשון שמגיעים ל-active (7/8 - אין save אחרי load).
  useEffect(() => {
    if (state.kind !== "activeLoadingData") return;
    let cancelled = false;
    const { reportId, accessToken } = state;
    getTrackingData(supabase.functions, { reportId, accessToken }).then((result) => {
      if (cancelled || !mountedRef.current) return;
      if (result.kind === "active") {
        lastSavedSnapshotRef.current = JSON.stringify(result.entries);
        dispatch({ type: "DATA_LOAD_SUCCEEDED", projectName: result.projectName, entries: result.entries });
      } else {
        dispatch({ type: "DATA_LOAD_FAILED" });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [state]);

  // שלב 4: autosave - מתזמן שמירה **רק** לפי decideAutosaveAction (פונקציה טהורה, ר.
  // lib/tracking/autosave.ts) - לא השוואה מקומית inline. saveInFlight נגזר מ-activeSaveTokenRef
  // (לא מ-state.kind - מונע גם תזמון נוסף בזמן שיש כבר בקשה בטיסה, ר. שלב 5).
  useEffect(() => {
    if (state.kind !== "active") return;
    const currentEntriesSnapshot = JSON.stringify(state.entries);
    const decision = decideAutosaveAction({
      currentEntriesSnapshot,
      lastSavedSnapshot: lastSavedSnapshotRef.current,
      saveInFlight: activeSaveTokenRef.current !== null,
    });
    if (decision !== "scheduleSave") return;
    // 13. unmount מבטל timer ולא יוצר save מאוחר - ה-cleanup הבא (return) תמיד מנקה, כולל ב-unmount.
    const timer = window.setTimeout(() => {
      if (mountedRef.current) dispatch({ type: "SAVE_STARTED" });
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  // שלב 5: saveInProgress - שמירה **רק** דרך dohefes-save-tracking-data. 9. אין שתי שמירות
  // מקבילות - activeSaveTokenRef הוא guard יחיד: אם כבר יש token פעיל, ה-effect לא מתחיל בקשה
  // שנייה גם כשה-effect רץ מחדש (entries השתנו תוך כדי שמירה, ר. EDIT_ENTRIES ב-access-state.ts).
  // 10. debounce/תגובה לא שומרים closure ישן - ה-token עצמו (לא ה-entries שנתפסו ב-closure)
  // הוא מה שמושווה ב-.then() כדי להחליט אם התגובה עדיין רלוונטית.
  useEffect(() => {
    if (state.kind !== "saveInProgress") return;
    if (activeSaveTokenRef.current !== null) return; // כבר יש בקשה בטיסה לסבב הזה - לא מתחילים שנייה
    const token = {};
    activeSaveTokenRef.current = token;
    const { reportId, accessToken, entries } = state;

    saveTrackingData(supabase.functions, { reportId, accessToken, entries }).then((result) => {
      if (activeSaveTokenRef.current !== token) return; // תגובה ל-save שכבר "בוטל" (unmount/סבב חדש) - מתעלמים
      activeSaveTokenRef.current = null;
      if (!mountedRef.current) return;
      if (result.kind === "saved") {
        lastSavedSnapshotRef.current = JSON.stringify(entries);
        dispatch({ type: "SAVE_SUCCEEDED" });
      } else if (result.kind === "unavailable") {
        // 12. revoke/unavailable מבטל את ה-save ומסתיר את העורך - לא saveError.
        revokeActiveAccess(window.localStorage, reportId, PRODUCT_TYPE);
        dispatch({ type: "ENTITLEMENT_UNAVAILABLE" });
      } else if (result.kind === "invalid_payload") {
        dispatch({ type: "SAVE_FAILED", error: "הנתונים שהוזנו אינם תקינים." });
      } else {
        dispatch({ type: "SAVE_FAILED", error: "אירעה תקלה זמנית בשמירה. אפשר לנסות שוב." });
      }
    });
    // אין cleanup שמנקה activeSaveTokenRef כאן - ה-token-compare ב-.then() כבר מטפל ב"תגובה
    // מאוחרת שכבר לא רלוונטית", וניקוי כאן היה מריץ בטעות בכל שינוי entries תוך-כדי-שמירה
    // (ה-effect רץ מחדש, אך אנחנו רוצים להישאר עם אותה בקשה בטיסה, לא לבטל אותה).
  }, [state]);

  // ניווט בפועל ל-checkout - effect נפרד, לא מוטציה של window.location בזמן render/handler ישיר.
  useEffect(() => {
    if (!redirectUrl) return;
    window.location.href = redirectUrl;
  }, [redirectUrl]);

  const handlePurchase = useCallback(async () => {
    if (state.kind !== "purchaseRequired") return;
    const reportId = state.reportId;
    const key = idempotencyKey ?? generateIdempotencyKey();
    setIdempotencyKey(key);
    setActionUi({ kind: "working" });

    const result = await purchaseProduct(supabase.functions, window.localStorage, { reportId, productType: PRODUCT_TYPE, idempotencyKey: key }, new Date());

    if (result.kind === "redirect") {
      setRedirectUrl(result.checkoutUrl);
      return;
    }
    if (result.kind === "already_paid") {
      setActionUi({ kind: "error", message: "נראה שהמוצר כבר נרכש, אך אין לו גישה שמורה במכשיר הזה. אם רכשת ממכשיר אחר, יש להיעזר בקישור שקיבלת שם." });
      return;
    }
    if (result.kind === "storage_failed") {
      setIdempotencyKey(null);
      setActionUi({ kind: "error", message: "לא הצלחנו לשמור את פרטי הרכישה במכשיר הזה. נסה שוב, או נקה מקום אחסון בדפדפן." });
      return;
    }
    if (result.kind === "retryable") {
      setActionUi({ kind: "error", message: "אירעה תקלה זמנית. אפשר לנסות שוב." });
      return;
    }
    setIdempotencyKey(null);
    const friendly = result.reason === "report_not_eligible" ? "יש לרכוש קודם את דוח האפס הבסיסי לפרויקט הזה." : "לא ניתן להשלים את הרכישה כרגע.";
    setActionUi({ kind: "error", message: friendly });
  }, [state, idempotencyKey]);

  const handleResume = useCallback(async () => {
    if (state.kind !== "checkoutPending") return;
    setActionUi({ kind: "working" });
    const result = await resumePendingCheckout(supabase.functions, window.localStorage, state.paymentContextId, new Date());

    if (result.kind === "redirect") {
      setRedirectUrl(result.checkoutUrl);
      return;
    }
    if (result.kind === "already_active") {
      dispatch({ type: "REPORT_ID_RESOLVED", reportId: state.reportId }); // מרענן את שלב 2 מחדש - ימצא active מקומי הפעם
      return;
    }
    if (result.kind === "not_found") {
      dispatch({ type: "ENTITLEMENT_NONE" });
      return;
    }
    setActionUi({ kind: "error", message: "אירעה תקלה. אפשר לנסות שוב." });
  }, [state]);

  const updateItem = useCallback(
    (id: string, patch: Partial<TrackingItem>) => {
      if (!isEditorVisible(state) || !("entries" in state)) return;
      const nextEntries = state.entries.map((it) => (it.id === id ? { ...it, ...patch } : it));
      dispatch({ type: "EDIT_ENTRIES", entries: nextEntries });
    },
    [state]
  );

  const removeItem = useCallback(
    (id: string) => {
      if (!isEditorVisible(state) || !("entries" in state)) return;
      dispatch({ type: "EDIT_ENTRIES", entries: state.entries.filter((it) => it.id !== id) });
    },
    [state]
  );

  const addItem = useCallback(() => {
    if (!isEditorVisible(state) || !("entries" in state)) return;
    dispatch({ type: "EDIT_ENTRIES", entries: [...state.entries, emptyItem()] });
  }, [state]);

  return renderByState(state, {
    actionUi,
    onPurchase: handlePurchase,
    onResume: handleResume,
    onAdd: addItem,
    onUpdate: updateItem,
    onRemove: removeItem,
    onRetryLoad: () => dispatch({ type: "RETRY_LOAD" }),
    onRetrySave: () => dispatch({ type: "RETRY_SAVE" }),
  });
}

interface RenderCallbacks {
  actionUi: { kind: "idle" } | { kind: "working" } | { kind: "error"; message: string };
  onPurchase: () => void;
  onResume: () => void;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<TrackingItem>) => void;
  onRemove: (id: string) => void;
  onRetryLoad: () => void;
  onRetrySave: () => void;
}

function renderByState(state: TrackingAccessState, cb: RenderCallbacks) {
  const trackingProduct = CATALOG.trackingReports;

  switch (state.kind) {
    case "invalidReportId":
      return (
        <main className="max-w-lg mx-auto px-4 py-16 text-center">
          <p className="text-gray-600 mb-4">דוח המעקב לא נמצא. ייתכן שהקישור שגוי, או שהדוח עדיין לא נשמר.</p>
          <a href="/dohefes/start/" className="text-[#1D6F42] underline text-sm">
            בניית דוח אפס חדש ←
          </a>
        </main>
      );

    case "loading":
      return <main className="max-w-lg mx-auto px-4 py-16 text-center text-gray-500 text-sm">טוען...</main>;

    case "purchaseRequired":
      return (
        <main className="max-w-lg mx-auto px-4 py-16 text-center">
          <h1 className="text-lg font-bold text-[#14502F] mb-2">{trackingProduct.displayName}</h1>
          {/* ניסוח כללי בכוונה - אין שם פרויקט לפני entitlement פעיל (Commit 5b-fix). */}
          <p className="text-sm text-gray-500 mb-6">דוחות מעקב עבור הדוח הקיים - {formatPriceNis(trackingProduct.priceAgorot)}, תשלום חד פעמי, מוצר המשך לדוח קיים.</p>
          {cb.actionUi.kind === "error" && (
            <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm">{cb.actionUi.message}</p>
          )}
          <button
            type="button"
            onClick={cb.onPurchase}
            disabled={cb.actionUi.kind === "working"}
            className="bg-[#1D6F42] hover:bg-[#14502F] disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[#1D6F42] focus-visible:outline-none text-white font-bold px-6 py-3 rounded-lg transition-colors"
          >
            {cb.actionUi.kind === "working" ? "מעבירים אותך לתשלום..." : `לרכישה - ${formatPriceNis(trackingProduct.priceAgorot)}`}
          </button>
        </main>
      );

    case "checkoutPending":
      return (
        <main className="max-w-lg mx-auto px-4 py-16 text-center">
          <p className="text-[#14502F] font-bold mb-2">יש כבר רכישה בתהליך</p>
          <p className="text-sm text-gray-500 mb-4">אפשר להמשיך אותה במקום להתחיל רכישה חדשה.</p>
          {cb.actionUi.kind === "error" && (
            <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm">{cb.actionUi.message}</p>
          )}
          <button
            type="button"
            onClick={cb.onResume}
            disabled={cb.actionUi.kind === "working"}
            className="bg-[#1D6F42] hover:bg-[#14502F] disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[#1D6F42] focus-visible:outline-none text-white font-bold px-6 py-3 rounded-lg transition-colors"
          >
            {cb.actionUi.kind === "working" ? "בודקים..." : "המשך לתשלום"}
          </button>
        </main>
      );

    case "accessUnavailable":
      return (
        <main className="max-w-lg mx-auto px-4 py-16 text-center">
          <p className="text-gray-700 mb-4">אין כרגע גישה למוצר הזה.</p>
          <a href={SITE_PATHS.calculator} className="text-[#1D6F42] underline text-sm">
            חזרה לדוח ←
          </a>
        </main>
      );

    case "activeLoadingData":
      return <main className="max-w-lg mx-auto px-4 py-16 text-center text-gray-500 text-sm">טוען את דוח המעקב...</main>;

    case "loadError":
      return (
        <main className="max-w-lg mx-auto px-4 py-16 text-center">
          <p className="text-gray-700 mb-4">אירעה תקלה בטעינת דוח המעקב.</p>
          <button
            type="button"
            onClick={cb.onRetryLoad}
            className="bg-[#1D6F42] hover:bg-[#14502F] text-white font-medium text-sm px-5 py-2.5 rounded-lg transition-colors"
          >
            נסה שוב
          </button>
        </main>
      );

    case "active":
    case "saveInProgress":
    case "saveError":
      return renderEditor(state, cb);
  }
}

function renderEditor(state: Extract<TrackingAccessState, { kind: "active" | "saveInProgress" | "saveError" }>, cb: RenderCallbacks) {
  const items = state.entries;
  const projectName = state.projectName || "פרויקט ללא שם";
  const totals = computeTrackingTotals(items as TrackingItem[]);
  const exportUnlocked = isTrackingExportUnlocked(state);

  const phaseGroups: { phase: string; items: TrackingItem[] }[] = [];
  for (const item of items) {
    const phase = item.phase || "ללא שלב";
    let group = phaseGroups.find((g) => g.phase === phase);
    if (!group) {
      group = { phase, items: [] };
      phaseGroups.push(group);
    }
    group.items.push(item);
  }

  return (
    <>
      <main className="max-w-4xl mx-auto px-4 py-8 print:hidden">
        <h1 className="text-xl font-bold text-[#14502F] mb-1">{CATALOG.trackingReports.displayName}</h1>
        <p className="text-sm text-gray-500 mb-1">{projectName}</p>
        <p className="text-xs text-gray-500 mb-1">
          תקציב מול ביצוע בפועל, לפי שלבי בנייה.{" "}
          {state.kind === "saveInProgress" && "שומר..."}
          {state.kind === "active" && "הדוח נשמר אוטומטית עם כל שינוי."}
          {state.kind === "saveError" && <span className="text-amber-700">{state.error}</span>}
        </p>
        {state.kind === "saveError" && (
          <button type="button" onClick={cb.onRetrySave} className="text-xs text-[#1D6F42] underline mb-4">
            ניסיון שמירה חוזר ←
          </button>
        )}
        <p className="text-xs text-gray-500 mb-6">
          <a href={`/dohefes/calculator/?id=${state.reportId}`} className="text-[#1D6F42] underline">
            חזרה לדוח הכדאיות ←
          </a>
        </p>

        <div className="space-y-6 mb-6">
          {phaseGroups.length === 0 && (
            <p className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg px-4 py-6 text-center">
              עדיין אין סעיפים. יש להוסיף את סעיפי התקציב לפי שלבי הבנייה של הפרויקט (למשל: עבודות התארגנות, ביסוס, שלד, פיתוח).
            </p>
          )}
          {phaseGroups.map((group) => {
            const groupTotal = group.items.reduce(
              (acc, it) => {
                const budget = itemBudgetNis(it);
                acc.budgetNis += budget;
                acc.actualNis += it.actualNis;
                return acc;
              },
              { budgetNis: 0, actualNis: 0 }
            );
            return (
              <div key={group.phase} className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-[#EAF3EC] px-3 py-2 text-sm font-medium text-[#14502F] flex justify-between">
                  <span>{group.phase}</span>
                  <span className="text-xs text-gray-600">
                    תקציב {nis(groupTotal.budgetNis)} ₪ · בוצע {nis(groupTotal.actualNis)} ₪
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 text-gray-500">
                        <th className="px-2 py-1.5 text-right font-normal">תיאור</th>
                        <th className="px-2 py-1.5 text-right font-normal">שלב</th>
                        <th className="px-2 py-1.5 text-right font-normal w-16">כמות</th>
                        <th className="px-2 py-1.5 text-right font-normal w-24">מחיר יחידה (₪)</th>
                        <th className="px-2 py-1.5 text-right font-normal w-24">תקציב (₪)</th>
                        <th className="px-2 py-1.5 text-right font-normal w-24">בוצע (₪)</th>
                        <th className="px-2 py-1.5 text-right font-normal w-16">% ביצוע</th>
                        <th className="px-2 py-1.5 text-right font-normal w-24">יתרה (₪)</th>
                        <th className="px-2 py-1.5 w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((item) => {
                        const budget = itemBudgetNis(item);
                        const remaining = budget - item.actualNis;
                        const percent = budget !== 0 ? item.actualNis / budget : 0;
                        return (
                          <tr key={item.id} className="border-t border-gray-100">
                            <td className="px-2 py-1">
                              <input
                                type="text"
                                value={item.description}
                                onChange={(e) => cb.onUpdate(item.id, { description: e.target.value })}
                                className="w-full border border-gray-200 rounded px-1.5 py-1"
                                placeholder="למשל: כלונסאות"
                              />
                            </td>
                            <td className="px-2 py-1">
                              <input
                                type="text"
                                value={item.phase}
                                onChange={(e) => cb.onUpdate(item.id, { phase: e.target.value })}
                                className="w-full border border-gray-200 rounded px-1.5 py-1"
                                placeholder="למשל: ביסוס"
                              />
                            </td>
                            <td className="px-2 py-1">
                              <input
                                type="number"
                                value={item.quantity}
                                onChange={(e) => cb.onUpdate(item.id, { quantity: Number(e.target.value) })}
                                className="w-full border border-gray-200 rounded px-1.5 py-1"
                              />
                            </td>
                            <td className="px-2 py-1">
                              <input
                                type="number"
                                value={item.unitPriceNis}
                                onChange={(e) => cb.onUpdate(item.id, { unitPriceNis: Number(e.target.value) })}
                                className="w-full border border-gray-200 rounded px-1.5 py-1"
                              />
                            </td>
                            <td className="px-2 py-1 text-gray-600">{nis(budget)}</td>
                            <td className="px-2 py-1">
                              <input
                                type="number"
                                value={item.actualNis}
                                onChange={(e) => cb.onUpdate(item.id, { actualNis: Number(e.target.value) })}
                                className="w-full border border-gray-200 rounded px-1.5 py-1"
                              />
                            </td>
                            <td className="px-2 py-1 text-gray-600">{Math.round(percent * 100)}%</td>
                            <td className="px-2 py-1 text-gray-600">{nis(remaining)}</td>
                            <td className="px-2 py-1">
                              <button onClick={() => cb.onRemove(item.id)} className="text-red-500 hover:text-red-700" aria-label="מחיקת סעיף">
                                ✕
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>

        <button
          onClick={cb.onAdd}
          className="w-full border border-dashed border-[#1D6F42] text-[#1D6F42] text-sm font-medium py-2 rounded-lg hover:bg-[#EAF3EC] transition-colors mb-6"
        >
          + הוספת סעיף
        </button>

        <div className="bg-[#14502F] text-white rounded-lg px-4 py-3 mb-6 text-sm">
          <div className="flex justify-between mb-1">
            <span>סה&quot;כ תקציב</span>
            <span>{nis(totals.budgetNis)} ₪</span>
          </div>
          <div className="flex justify-between mb-1">
            <span>סה&quot;כ בוצע</span>
            <span>{nis(totals.actualNis)} ₪</span>
          </div>
          <div className="flex justify-between mb-1">
            <span>יתרה לביצוע</span>
            <span>{nis(totals.remainingNis)} ₪</span>
          </div>
          <div className="flex justify-between font-medium">
            <span>% ביצוע כולל</span>
            <span>{Math.round(totals.percentComplete * 100)}%</span>
          </div>
        </div>

        {/* Excel/הדפסה - נעולים לפני active, פעילים רק אחריו (16). exportUnlocked===true בכל
            שלושת המצבים כאן (active/saveInProgress/saveError) - אין entries אמיתיים לפני זה. */}
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            onClick={() => downloadTrackingWorkbook(projectName, items as TrackingItem[])}
            disabled={!exportUnlocked}
            aria-disabled={!exportUnlocked}
            className={`flex-1 font-medium text-sm px-4 py-2.5 rounded-lg transition-colors ${
              exportUnlocked ? "bg-[#1D6F42] hover:bg-[#14502F] text-white" : "bg-gray-200 text-gray-400 cursor-not-allowed"
            }`}
          >
            הורדת קובץ Excel
          </button>
          <button
            onClick={() => window.print()}
            disabled={!exportUnlocked}
            aria-disabled={!exportUnlocked}
            className={`flex-1 font-medium text-sm px-4 py-2.5 rounded-lg transition-colors ${
              exportUnlocked ? "bg-white border border-[#1D6F42] text-[#1D6F42] hover:bg-[#EAF3EC]" : "bg-gray-100 border border-gray-200 text-gray-400 cursor-not-allowed"
            }`}
          >
            הדפסה / שמירה כ-PDF
          </button>
        </div>
      </main>

      <main className="hidden print:block max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-xl font-bold text-[#14502F] mb-1">{CATALOG.trackingReports.displayName}</h1>
        <p className="text-sm text-gray-600 mb-4">{projectName}</p>
        {phaseGroups.map((group) => (
          <div key={group.phase} className="mb-4">
            <h2 className="text-sm font-bold text-[#14502F] mb-1">{group.phase}</h2>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 px-2 py-1 text-right">תיאור</th>
                  <th className="border border-gray-300 px-2 py-1 text-right">כמות</th>
                  <th className="border border-gray-300 px-2 py-1 text-right">מחיר יחידה</th>
                  <th className="border border-gray-300 px-2 py-1 text-right">תקציב</th>
                  <th className="border border-gray-300 px-2 py-1 text-right">בוצע</th>
                  <th className="border border-gray-300 px-2 py-1 text-right">% ביצוע</th>
                  <th className="border border-gray-300 px-2 py-1 text-right">יתרה</th>
                </tr>
              </thead>
              <tbody>
                {group.items.map((item) => {
                  const budget = itemBudgetNis(item);
                  const remaining = budget - item.actualNis;
                  const percent = budget !== 0 ? item.actualNis / budget : 0;
                  return (
                    <tr key={item.id}>
                      <td className="border border-gray-300 px-2 py-1">{item.description}</td>
                      <td className="border border-gray-300 px-2 py-1">{item.quantity}</td>
                      <td className="border border-gray-300 px-2 py-1">{nis(item.unitPriceNis)}</td>
                      <td className="border border-gray-300 px-2 py-1">{nis(budget)}</td>
                      <td className="border border-gray-300 px-2 py-1">{nis(item.actualNis)}</td>
                      <td className="border border-gray-300 px-2 py-1">{Math.round(percent * 100)}%</td>
                      <td className="border border-gray-300 px-2 py-1">{nis(remaining)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
        <table className="w-full text-xs border-collapse mt-2">
          <tbody>
            <tr>
              <td className="border border-gray-300 px-2 py-1 font-medium">סה&quot;כ תקציב</td>
              <td className="border border-gray-300 px-2 py-1">{nis(totals.budgetNis)} ₪</td>
            </tr>
            <tr>
              <td className="border border-gray-300 px-2 py-1 font-medium">סה&quot;כ בוצע</td>
              <td className="border border-gray-300 px-2 py-1">{nis(totals.actualNis)} ₪</td>
            </tr>
            <tr>
              <td className="border border-gray-300 px-2 py-1 font-medium">יתרה לביצוע</td>
              <td className="border border-gray-300 px-2 py-1">{nis(totals.remainingNis)} ₪</td>
            </tr>
            <tr>
              <td className="border border-gray-300 px-2 py-1 font-medium">% ביצוע כולל</td>
              <td className="border border-gray-300 px-2 py-1">{Math.round(totals.percentComplete * 100)}%</td>
            </tr>
          </tbody>
        </table>
      </main>
    </>
  );
}
