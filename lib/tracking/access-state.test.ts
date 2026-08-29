import { describe, expect, it } from "vitest";
import {
  INITIAL_TRACKING_ACCESS_STATE,
  isEditorVisible,
  isTrackingExportUnlocked,
  reduceTrackingAccessState,
} from "./access-state";
import type { TrackingAccessEvent, TrackingAccessState } from "./access-state";
import type { TrackingItem } from "./types";

const REPORT_ID = "11111111-1111-1111-1111-111111111111";
const ACCESS_TOKEN = "tok-abc";
const SAMPLE_ENTRIES: readonly TrackingItem[] = [{ id: "i1", phase: "ביסוס", description: "כלונסאות", quantity: 10, unitPriceNis: 5000, actualNis: 3000 }];

describe("1. reportId לא תקין -> invalidReportId, לא loading", () => {
  it("REPORT_ID_INVALID מתוך loading(null) -> invalidReportId", () => {
    const next = reduceTrackingAccessState(INITIAL_TRACKING_ACCESS_STATE, { type: "REPORT_ID_INVALID" });
    expect(next).toEqual({ kind: "invalidReportId" });
  });

  it("invalidReportId לא מתקדם לשום מקום עם עוד אירועים (למשל entitlement)", () => {
    const state: TrackingAccessState = { kind: "invalidReportId" };
    expect(reduceTrackingAccessState(state, { type: "ENTITLEMENT_ACTIVE", accessToken: ACCESS_TOKEN })).toBe(state);
  });
});

describe("loading -> reportId מתמלא, ואז entitlement", () => {
  it("REPORT_ID_RESOLVED ממלא reportId, נשאר loading", () => {
    const next = reduceTrackingAccessState(INITIAL_TRACKING_ACCESS_STATE, { type: "REPORT_ID_RESOLVED", reportId: REPORT_ID });
    expect(next).toEqual({ kind: "loading", reportId: REPORT_ID });
  });

  it("ENTITLEMENT_ACTIVE לפני שreportId נפתר - מתעלם (אין reportId עדיין)", () => {
    expect(reduceTrackingAccessState(INITIAL_TRACKING_ACCESS_STATE, { type: "ENTITLEMENT_ACTIVE", accessToken: ACCESS_TOKEN })).toBe(
      INITIAL_TRACKING_ACCESS_STATE
    );
  });
});

describe("2. ללא productAccess -> purchaseRequired (paywall), לא activeLoadingData", () => {
  it("ENTITLEMENT_NONE -> purchaseRequired", () => {
    const loadingWithId: TrackingAccessState = { kind: "loading", reportId: REPORT_ID };
    const next = reduceTrackingAccessState(loadingWithId, { type: "ENTITLEMENT_NONE" });
    expect(next).toEqual({ kind: "purchaseRequired", reportId: REPORT_ID });
  });

  it("purchaseRequired אינו active - isEditorVisible false", () => {
    expect(isEditorVisible({ kind: "purchaseRequired", reportId: REPORT_ID })).toBe(false);
  });
});

describe("6. pending purchase קיים -> checkoutPending, ולא order כפול (אין אירוע ליצירת order כאן בכלל)", () => {
  it("ENTITLEMENT_PENDING -> checkoutPending עם paymentContextId (לא checkoutUrl - חידוש עובר תמיד דרך resumePendingCheckout)", () => {
    const loadingWithId: TrackingAccessState = { kind: "loading", reportId: REPORT_ID };
    const next = reduceTrackingAccessState(loadingWithId, { type: "ENTITLEMENT_PENDING", paymentContextId: "po_abc" });
    expect(next).toEqual({ kind: "checkoutPending", reportId: REPORT_ID, paymentContextId: "po_abc" });
  });
});

describe("13. entitlement revoked/refunded/unavailable -> accessUnavailable, מסתיר את העורך", () => {
  it("ENTITLEMENT_UNAVAILABLE -> accessUnavailable, שונה מ-purchaseRequired", () => {
    const loadingWithId: TrackingAccessState = { kind: "loading", reportId: REPORT_ID };
    const next = reduceTrackingAccessState(loadingWithId, { type: "ENTITLEMENT_UNAVAILABLE" });
    expect(next).toEqual({ kind: "accessUnavailable", reportId: REPORT_ID });
  });

  it("accessUnavailable - isEditorVisible/isTrackingExportUnlocked false", () => {
    const state: TrackingAccessState = { kind: "accessUnavailable", reportId: REPORT_ID };
    expect(isEditorVisible(state)).toBe(false);
    expect(isTrackingExportUnlocked(state)).toBe(false);
  });
});

describe("12. entitlement למוצר אחר אינו פותח tracking - נדחה כ-ENTITLEMENT_NONE/UNAVAILABLE ברמת ה-orchestration, לא כאן", () => {
  it("state machine עצמו לא מבחין 'איזה מוצר' - זו אחריות ה-service layer (dohefes-get-tracking-data RPC); כאן רק מוודאים שאין מעבר ל-active בלי ENTITLEMENT_ACTIVE מפורש", () => {
    const loadingWithId: TrackingAccessState = { kind: "loading", reportId: REPORT_ID };
    // אף אירוע אחר לא מוביל ל-activeLoadingData/active
    for (const event of [{ type: "ENTITLEMENT_NONE" as const }, { type: "ENTITLEMENT_UNAVAILABLE" as const }]) {
      const next = reduceTrackingAccessState(loadingWithId, event);
      expect(next.kind).not.toBe("active");
      expect(next.kind).not.toBe("activeLoadingData");
    }
  });
});

describe("activeLoadingData -> active/loadError (7/8. active קורא רק ל-Function החדשה - ר' wiring tests)", () => {
  const loadingData: TrackingAccessState = { kind: "activeLoadingData", reportId: REPORT_ID, accessToken: ACCESS_TOKEN };

  it("DATA_LOAD_SUCCEEDED -> active עם entries", () => {
    const next = reduceTrackingAccessState(loadingData, { type: "DATA_LOAD_SUCCEEDED", entries: SAMPLE_ENTRIES });
    expect(next).toEqual({ kind: "active", reportId: REPORT_ID, accessToken: ACCESS_TOKEN, entries: SAMPLE_ENTRIES });
  });

  it("8. קריאה ללא נתונים (מערך ריק) עדיין מובילה ל-active תקין - מצב ריק תקף, לא שגיאה", () => {
    const next = reduceTrackingAccessState(loadingData, { type: "DATA_LOAD_SUCCEEDED", entries: [] });
    expect(next).toEqual({ kind: "active", reportId: REPORT_ID, accessToken: ACCESS_TOKEN, entries: [] });
  });

  it("14. DATA_LOAD_FAILED -> loadError, בלי entries בכלל (לא מציג נתונים ישנים כאילו עדכניים)", () => {
    const next = reduceTrackingAccessState(loadingData, { type: "DATA_LOAD_FAILED" });
    expect(next).toEqual({ kind: "loadError", reportId: REPORT_ID, accessToken: ACCESS_TOKEN });
    expect(next).not.toHaveProperty("entries");
  });

  it("loadError - isEditorVisible false (אין עורך בלי נתונים אמיתיים)", () => {
    expect(isEditorVisible({ kind: "loadError", reportId: REPORT_ID, accessToken: ACCESS_TOKEN })).toBe(false);
  });

  it("RETRY_LOAD מ-loadError -> activeLoadingData מחדש", () => {
    const loadError: TrackingAccessState = { kind: "loadError", reportId: REPORT_ID, accessToken: ACCESS_TOKEN };
    expect(reduceTrackingAccessState(loadError, { type: "RETRY_LOAD" })).toEqual({ kind: "activeLoadingData", reportId: REPORT_ID, accessToken: ACCESS_TOKEN });
  });
});

describe("active -> saveInProgress -> active/saveError (15. שמירה נכשלת לא מוחקת נתונים מקומיים)", () => {
  const active: TrackingAccessState = { kind: "active", reportId: REPORT_ID, accessToken: ACCESS_TOKEN, entries: SAMPLE_ENTRIES };

  it("SAVE_STARTED -> saveInProgress, entries נשמרים כמות שהם", () => {
    const next = reduceTrackingAccessState(active, { type: "SAVE_STARTED" });
    expect(next).toEqual({ kind: "saveInProgress", reportId: REPORT_ID, accessToken: ACCESS_TOKEN, entries: SAMPLE_ENTRIES });
  });

  it("SAVE_SUCCEEDED -> active שוב, אותם entries", () => {
    const saving: TrackingAccessState = { kind: "saveInProgress", reportId: REPORT_ID, accessToken: ACCESS_TOKEN, entries: SAMPLE_ENTRIES };
    const next = reduceTrackingAccessState(saving, { type: "SAVE_SUCCEEDED" });
    expect(next).toEqual({ kind: "active", reportId: REPORT_ID, accessToken: ACCESS_TOKEN, entries: SAMPLE_ENTRIES });
  });

  it("15. SAVE_FAILED -> saveError, ה-entries המקומיים **זהים**, לא מוחלפים/מאופסים", () => {
    const saving: TrackingAccessState = { kind: "saveInProgress", reportId: REPORT_ID, accessToken: ACCESS_TOKEN, entries: SAMPLE_ENTRIES };
    const next = reduceTrackingAccessState(saving, { type: "SAVE_FAILED", error: "network_error" });
    expect(next).toEqual({ kind: "saveError", reportId: REPORT_ID, accessToken: ACCESS_TOKEN, entries: SAMPLE_ENTRIES, error: "network_error" });
  });

  it("15. saveError - isEditorVisible עדיין true (העורך ממשיך להיות מוצג, ניתן לנסות שוב)", () => {
    const errState: TrackingAccessState = { kind: "saveError", reportId: REPORT_ID, accessToken: ACCESS_TOKEN, entries: SAMPLE_ENTRIES, error: "x" };
    expect(isEditorVisible(errState)).toBe(true);
  });

  it("15. RETRY_SAVE מ-saveError -> saveInProgress מחדש, ניסיון חוזר ידני", () => {
    const errState: TrackingAccessState = { kind: "saveError", reportId: REPORT_ID, accessToken: ACCESS_TOKEN, entries: SAMPLE_ENTRIES, error: "x" };
    const next = reduceTrackingAccessState(errState, { type: "RETRY_SAVE" });
    expect(next).toEqual({ kind: "saveInProgress", reportId: REPORT_ID, accessToken: ACCESS_TOKEN, entries: SAMPLE_ENTRIES });
  });

  it("עריכה נוספת אחרי saveError (EDIT_ENTRIES) מחזירה ל-active עם הערכים החדשים, מנקה את השגיאה", () => {
    const errState: TrackingAccessState = { kind: "saveError", reportId: REPORT_ID, accessToken: ACCESS_TOKEN, entries: SAMPLE_ENTRIES, error: "x" };
    const editedEntries: readonly TrackingItem[] = [...SAMPLE_ENTRIES, { id: "i2", phase: "שלד", description: "יציקה", quantity: 1, unitPriceNis: 100000, actualNis: 0 }];
    const next = reduceTrackingAccessState(errState, { type: "EDIT_ENTRIES", entries: editedEntries });
    expect(next).toEqual({ kind: "active", reportId: REPORT_ID, accessToken: ACCESS_TOKEN, entries: editedEntries });
  });

  it("EDIT_ENTRIES מתוך active מעדכן entries, נשאר active", () => {
    const edited: readonly TrackingItem[] = [];
    const next = reduceTrackingAccessState(active, { type: "EDIT_ENTRIES", entries: edited });
    expect(next).toEqual({ kind: "active", reportId: REPORT_ID, accessToken: ACCESS_TOKEN, entries: edited });
  });
});

describe("16. Excel/print נעולים לפני active, פעילים רק אחרי active", () => {
  it.each([
    { kind: "loading", reportId: null },
    { kind: "invalidReportId" },
    { kind: "purchaseRequired", reportId: REPORT_ID },
    { kind: "checkoutPending", reportId: REPORT_ID, paymentContextId: "po_x" },
    { kind: "accessUnavailable", reportId: REPORT_ID },
    { kind: "activeLoadingData", reportId: REPORT_ID, accessToken: ACCESS_TOKEN },
    { kind: "loadError", reportId: REPORT_ID, accessToken: ACCESS_TOKEN },
  ] as TrackingAccessState[])("$kind -> נעול (isTrackingExportUnlocked false)", (state) => {
    expect(isTrackingExportUnlocked(state)).toBe(false);
  });

  it.each([
    { kind: "active", reportId: REPORT_ID, accessToken: ACCESS_TOKEN, entries: SAMPLE_ENTRIES },
    { kind: "saveInProgress", reportId: REPORT_ID, accessToken: ACCESS_TOKEN, entries: SAMPLE_ENTRIES },
    { kind: "saveError", reportId: REPORT_ID, accessToken: ACCESS_TOKEN, entries: SAMPLE_ENTRIES, error: "x" },
  ] as TrackingAccessState[])("$kind -> פעיל (isTrackingExportUnlocked true)", (state) => {
    expect(isTrackingExportUnlocked(state)).toBe(true);
  });
});

describe("22. אין mutation - reduceTrackingAccessState לא משנה את state/event שהועברו", () => {
  it("state המקורי לא משתנה אחרי הקריאה", () => {
    const state: TrackingAccessState = { kind: "active", reportId: REPORT_ID, accessToken: ACCESS_TOKEN, entries: SAMPLE_ENTRIES };
    const snapshot = JSON.parse(JSON.stringify(state));
    reduceTrackingAccessState(state, { type: "SAVE_STARTED" });
    expect(state).toEqual(snapshot);
  });

  it("אירועים לא-רלוונטיים לא זורקים, לא רק לא-משתנים - בדיקת יציבות רחבה", () => {
    const allStates: TrackingAccessState[] = [
      { kind: "loading", reportId: null },
      { kind: "invalidReportId" },
      { kind: "purchaseRequired", reportId: REPORT_ID },
      { kind: "checkoutPending", reportId: REPORT_ID, paymentContextId: "po_x" },
      { kind: "accessUnavailable", reportId: REPORT_ID },
      { kind: "activeLoadingData", reportId: REPORT_ID, accessToken: ACCESS_TOKEN },
      { kind: "active", reportId: REPORT_ID, accessToken: ACCESS_TOKEN, entries: SAMPLE_ENTRIES },
      { kind: "saveInProgress", reportId: REPORT_ID, accessToken: ACCESS_TOKEN, entries: SAMPLE_ENTRIES },
      { kind: "saveError", reportId: REPORT_ID, accessToken: ACCESS_TOKEN, entries: SAMPLE_ENTRIES, error: "x" },
      { kind: "loadError", reportId: REPORT_ID, accessToken: ACCESS_TOKEN },
    ];
    const allEvents: TrackingAccessEvent[] = [
      { type: "REPORT_ID_RESOLVED", reportId: REPORT_ID },
      { type: "REPORT_ID_INVALID" },
      { type: "ENTITLEMENT_ACTIVE", accessToken: ACCESS_TOKEN },
      { type: "ENTITLEMENT_PENDING", paymentContextId: "po_x" },
      { type: "ENTITLEMENT_NONE" },
      { type: "ENTITLEMENT_UNAVAILABLE" },
      { type: "DATA_LOAD_SUCCEEDED", entries: SAMPLE_ENTRIES },
      { type: "DATA_LOAD_FAILED" },
      { type: "RETRY_LOAD" },
      { type: "EDIT_ENTRIES", entries: SAMPLE_ENTRIES },
      { type: "SAVE_STARTED" },
      { type: "SAVE_SUCCEEDED" },
      { type: "SAVE_FAILED", error: "x" },
      { type: "RETRY_SAVE" },
    ];
    for (const state of allStates) {
      for (const event of allEvents) {
        expect(() => reduceTrackingAccessState(state, event)).not.toThrow();
      }
    }
  });
});
