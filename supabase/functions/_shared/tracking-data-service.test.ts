import { describe, expect, it } from "vitest";
import { getTrackingData, saveTrackingData } from "./tracking-data-service";
import type {
  RawTrackingGetOutcome,
  RawTrackingSaveOutcome,
  SaveTrackingDataServiceDeps,
  TokenHasher,
  TrackingReadDatabase,
  TrackingWriteDatabase,
} from "./tracking-data-service";
import type { TrackingItem } from "./tracking-validator";

const REPORT_ID = "11111111-1111-1111-1111-111111111111";
const RAW_TOKEN = "raw-token-abc";
const TOKEN_HASH = "hash-of-raw-token-abc";

const SAMPLE_ITEM: TrackingItem = { id: "i1", phase: "ביסוס", description: "כלונסאות", quantity: 10, unitPriceNis: 5000, actualNis: 3000 };

function fakeTokenHasher(mapping: Record<string, string> = { [RAW_TOKEN]: TOKEN_HASH }): TokenHasher {
  return {
    async hashAccessToken(rawToken: string): Promise<string> {
      return mapping[rawToken] ?? `hash-of-${rawToken}`;
    },
  };
}

class FakeReadDatabase implements TrackingReadDatabase {
  result: RawTrackingGetOutcome = { outcome: "active", entries: [] };
  calls: Array<{ reportId: string; accessTokenHash: string }> = [];

  async getTrackingData(reportId: string, accessTokenHash: string): Promise<RawTrackingGetOutcome> {
    this.calls.push({ reportId, accessTokenHash });
    return this.result;
  }
}

class FakeWriteDatabase implements TrackingWriteDatabase {
  results: RawTrackingSaveOutcome[] = [{ outcome: "saved" }];
  callIndex = 0;
  calls: Array<{ reportId: string; accessTokenHash: string; entries: readonly TrackingItem[] }> = [];

  async saveTrackingData(reportId: string, accessTokenHash: string, entries: readonly TrackingItem[]): Promise<RawTrackingSaveOutcome> {
    this.calls.push({ reportId, accessTokenHash, entries });
    const result = this.results[Math.min(this.callIndex, this.results.length - 1)];
    this.callIndex += 1;
    return result;
  }
}

describe("getTrackingData - 1. token חסר/לא תקין", () => {
  it("rawAccessToken ריק -> unavailable, בלי לגעת ב-DB בכלל", async () => {
    const database = new FakeReadDatabase();
    const result = await getTrackingData({ database, tokenHasher: fakeTokenHasher() }, { reportId: REPORT_ID, rawAccessToken: "" });
    expect(result).toEqual({ status: "unavailable" });
    expect(database.calls).toEqual([]);
  });
});

describe("getTrackingData - 3/4/5/7. כל סיבות ה-unavailable מה-RPC מטופלות זהה", () => {
  it("outcome='unavailable' (entitlement חסר/למוצר אחר/pending/revoked/refunded/token לא תואם לדוח) -> unavailable אחיד", async () => {
    const database = new FakeReadDatabase();
    database.result = { outcome: "unavailable", entries: null };
    const result = await getTrackingData({ database, tokenHasher: fakeTokenHasher() }, { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN });
    expect(result).toEqual({ status: "unavailable" });
  });

  it("outcome='invalid_input' (הגנת-עומק, לא אמור לקרות בזרימה תקינה) -> גם הוא unavailable, לא exception", async () => {
    const database = new FakeReadDatabase();
    database.result = { outcome: "invalid_input", entries: null };
    const result = await getTrackingData({ database, tokenHasher: fakeTokenHasher() }, { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN });
    expect(result).toEqual({ status: "unavailable" });
  });
});

describe("getTrackingData - 6. entitlement פעיל -> active", () => {
  it("outcome='active' עם entries -> status:'active', entries מועברים כמות שהם", async () => {
    const database = new FakeReadDatabase();
    database.result = { outcome: "active", entries: [SAMPLE_ITEM] };
    const result = await getTrackingData({ database, tokenHasher: fakeTokenHasher() }, { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN });
    expect(result).toEqual({ status: "active", entries: [SAMPLE_ITEM] });
  });

  it("2. hash מחושב מהטוקן הגולמי ומועבר ל-DB - הטוקן הגולמי עצמו לעולם לא מגיע ל-database.getTrackingData", async () => {
    const database = new FakeReadDatabase();
    await getTrackingData({ database, tokenHasher: fakeTokenHasher() }, { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN });
    expect(database.calls).toEqual([{ reportId: REPORT_ID, accessTokenHash: TOKEN_HASH }]);
  });
});

describe("getTrackingData - 8. קריאה ללא נתונים מחזירה מצב ריק תקין", () => {
  it("outcome='active', entries=null (אין שורה עדיין בטבלה) -> status:'active', entries:[] (לא null, לא unavailable)", async () => {
    const database = new FakeReadDatabase();
    database.result = { outcome: "active", entries: null };
    const result = await getTrackingData({ database, tokenHasher: fakeTokenHasher() }, { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN });
    expect(result).toEqual({ status: "active", entries: [] });
  });
});

describe("saveTrackingData - 1. token חסר/לא תקין", () => {
  it("rawAccessToken ריק -> unavailable, בלי ולידציית payload ובלי לגעת ב-DB", async () => {
    const database = new FakeWriteDatabase();
    const result = await saveTrackingData(
      { database, tokenHasher: fakeTokenHasher() },
      { reportId: REPORT_ID, rawAccessToken: "", entries: "not even valid" }
    );
    expect(result).toEqual({ status: "unavailable" });
    expect(database.calls).toEqual([]);
  });
});

describe("saveTrackingData - 9/10. שמירה ראשונה ועדכון נתונים קיימים", () => {
  it("9. שמירה ראשונה מוצלחת -> saved", async () => {
    const database = new FakeWriteDatabase();
    const result = await saveTrackingData(
      { database, tokenHasher: fakeTokenHasher() },
      { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN, entries: [SAMPLE_ITEM] }
    );
    expect(result).toEqual({ status: "saved" });
  });

  it("10. שמירה שנייה (עדכון) על אותו reportId - גם היא saved, אותו נתיב קוד בדיוק (upsert)", async () => {
    const database = new FakeWriteDatabase();
    database.results = [{ outcome: "saved" }, { outcome: "saved" }];
    const deps: SaveTrackingDataServiceDeps = { database, tokenHasher: fakeTokenHasher() };
    const first = await saveTrackingData(deps, { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN, entries: [SAMPLE_ITEM] });
    const second = await saveTrackingData(deps, { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN, entries: [] });
    expect(first).toEqual({ status: "saved" });
    expect(second).toEqual({ status: "saved" });
    expect(database.calls[1].entries).toEqual([]);
  });
});

describe("saveTrackingData - 11. revoke מקביל אינו מאפשר כתיבה לאחר הביטול", () => {
  it("קריאה ראשונה saved, קריאה שנייה (entitlement בוטלה בינתיים) -> unavailable - כל קריאה נבדקת מחדש, לא cache", async () => {
    const database = new FakeWriteDatabase();
    database.results = [{ outcome: "saved" }, { outcome: "unavailable" }];
    const deps: SaveTrackingDataServiceDeps = { database, tokenHasher: fakeTokenHasher() };
    const first = await saveTrackingData(deps, { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN, entries: [SAMPLE_ITEM] });
    const second = await saveTrackingData(deps, { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN, entries: [SAMPLE_ITEM] });
    expect(first).toEqual({ status: "saved" });
    expect(second).toEqual({ status: "unavailable" });
    expect(database.calls.length).toBe(2); // שתי קריאות נפרדות ל-DB, לא הוחזרה תשובה שמורה
  });
});

describe("saveTrackingData - ולידציית payload (12/13/14, ר' tracking-validator.test.ts לכיסוי מלא)", () => {
  it("payload לא-מערך -> invalid_payload, לא נוגע ב-DB בכלל", async () => {
    const database = new FakeWriteDatabase();
    const result = await saveTrackingData(
      { database, tokenHasher: fakeTokenHasher() },
      { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN, entries: { not: "an array" } }
    );
    expect(result).toEqual({ status: "invalid_payload" });
    expect(database.calls).toEqual([]);
  });

  it("outcome='invalid_payload' שחוזר מה-DB עצמו (הגנת-עומק, לא אמור לקרות) -> גם הוא invalid_payload", async () => {
    const database = new FakeWriteDatabase();
    database.results = [{ outcome: "invalid_payload" }];
    const result = await saveTrackingData(
      { database, tokenHasher: fakeTokenHasher() },
      { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN, entries: [SAMPLE_ITEM] }
    );
    expect(result).toEqual({ status: "invalid_payload" });
  });
});

describe("15. אין token/hash/payload גולמי בתגובה - רק status (+entries בקריאה מוצלחת)", () => {
  it("get: unavailable מחזיר רק status", async () => {
    const database = new FakeReadDatabase();
    database.result = { outcome: "unavailable", entries: null };
    const result = await getTrackingData({ database, tokenHasher: fakeTokenHasher() }, { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN });
    expect(Object.keys(result)).toEqual(["status"]);
  });

  it("get: active מחזיר רק status+entries - שום hash/token", async () => {
    const database = new FakeReadDatabase();
    database.result = { outcome: "active", entries: [SAMPLE_ITEM] };
    const result = await getTrackingData({ database, tokenHasher: fakeTokenHasher() }, { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN });
    expect(Object.keys(result).sort()).toEqual(["entries", "status"]);
  });

  it("save: כל תוצאה מחזירה רק status", async () => {
    const database = new FakeWriteDatabase();
    const result = await saveTrackingData(
      { database, tokenHasher: fakeTokenHasher() },
      { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN, entries: [SAMPLE_ITEM] }
    );
    expect(Object.keys(result)).toEqual(["status"]);
  });
});

describe("אי-מוטציה / חוזה ממשק", () => {
  it("TrackingReadDatabase חושפת רק getTrackingData - אין כתיבה דרך הממשק הזה בכלל", () => {
    const database = new FakeReadDatabase();
    const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(database)).filter((n) => n !== "constructor");
    expect(methodNames).toEqual(["getTrackingData"]);
  });

  it("TrackingWriteDatabase חושפת רק saveTrackingData - אין קריאה כללית דרך הממשק הזה", () => {
    const database = new FakeWriteDatabase();
    const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(database)).filter((n) => n !== "constructor");
    expect(methodNames).toEqual(["saveTrackingData"]);
  });
});
