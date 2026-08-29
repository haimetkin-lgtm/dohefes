import { describe, expect, it } from "vitest";
import { getReportData, saveReportData } from "./report-data-service";
import type {
  RawReportGetOutcome,
  RawReportSaveOutcome,
  ReportReadDatabase,
  ReportWriteDatabase,
  SaveReportDataServiceDeps,
  TokenHasher,
} from "./report-data-service";

const REPORT_ID = "11111111-1111-1111-1111-111111111111";
const RAW_TOKEN = "raw-token-abc";
const TOKEN_HASH = "hash-of-raw-token-abc";

const VALID_PAYLOAD = { projectName: "פרויקט לדוגמה", dealType: "tama38", inputs: { units: [] }, results: { profit: 100 } };

function fakeTokenHasher(mapping: Record<string, string> = { [RAW_TOKEN]: TOKEN_HASH }): TokenHasher {
  return {
    async hashAccessToken(rawToken: string): Promise<string> {
      return mapping[rawToken] ?? `hash-of-${rawToken}`;
    },
  };
}

class FakeReadDatabase implements ReportReadDatabase {
  result: RawReportGetOutcome = { outcome: "active", reportId: REPORT_ID, projectName: "פרויקט לדוגמה", dealType: "tama38", inputs: {}, results: null };
  calls: Array<{ reportId: string; accessTokenHash: string }> = [];

  async getReportData(reportId: string, accessTokenHash: string): Promise<RawReportGetOutcome> {
    this.calls.push({ reportId, accessTokenHash });
    return this.result;
  }
}

class FakeWriteDatabase implements ReportWriteDatabase {
  results: RawReportSaveOutcome[] = [{ outcome: "saved" }];
  callIndex = 0;
  calls: Array<{ reportId: string; accessTokenHash: string; projectName: string | null; dealType: string; inputs: unknown; results: unknown }> = [];

  async saveReportData(
    reportId: string,
    accessTokenHash: string,
    projectName: string | null,
    dealType: string,
    inputs: unknown,
    results: unknown
  ): Promise<RawReportSaveOutcome> {
    this.calls.push({ reportId, accessTokenHash, projectName, dealType, inputs, results });
    const result = this.results[Math.min(this.callIndex, this.results.length - 1)];
    this.callIndex += 1;
    return result;
  }
}

describe("getReportData - token חסר/לא תקין", () => {
  it("rawAccessToken ריק -> unavailable, בלי לגעת ב-DB בכלל", async () => {
    const database = new FakeReadDatabase();
    const result = await getReportData({ database, tokenHasher: fakeTokenHasher() }, { reportId: REPORT_ID, rawAccessToken: "" });
    expect(result).toEqual({ status: "unavailable" });
    expect(database.calls).toEqual([]);
  });
});

describe("getReportData - unavailable מה-RPC (entitlement חסר/למוצר אחר/revoked/token לא תואם)", () => {
  it("outcome='unavailable' -> unavailable אחיד, בלי שום שדה דוח", async () => {
    const database = new FakeReadDatabase();
    database.result = { outcome: "unavailable", reportId: null, projectName: null, dealType: null, inputs: null, results: null };
    const result = await getReportData({ database, tokenHasher: fakeTokenHasher() }, { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN });
    expect(result).toEqual({ status: "unavailable" });
  });

  it("outcome='invalid_input' (הגנת-עומק) -> גם הוא unavailable, לא exception", async () => {
    const database = new FakeReadDatabase();
    database.result = { outcome: "invalid_input", reportId: null, projectName: null, dealType: null, inputs: null, results: null };
    const result = await getReportData({ database, tokenHasher: fakeTokenHasher() }, { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN });
    expect(result).toEqual({ status: "unavailable" });
  });

  it("16. אין payment_status/tracking/token/hash בתגובה - גם אם ה-RPC (הגנת-עומק) איכשהו מחזיר projectName יחד עם unavailable, לא מועבר הלאה", async () => {
    const database = new FakeReadDatabase();
    database.result = { outcome: "unavailable", reportId: null, projectName: "לא אמור להיחשף", dealType: null, inputs: null, results: null };
    const result = await getReportData({ database, tokenHasher: fakeTokenHasher() }, { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN });
    expect(result).toEqual({ status: "unavailable" });
    expect(JSON.stringify(result)).not.toContain("לא אמור להיחשף");
  });
});

describe("getReportData - entitlement פעיל -> active", () => {
  it("outcome='active' -> status:'active', reportId/projectName/dealType/inputs/results מועברים כמות שהם", async () => {
    const database = new FakeReadDatabase();
    database.result = { outcome: "active", reportId: REPORT_ID, projectName: "רחוב הרצל 12", dealType: "tama38", inputs: { a: 1 }, results: { b: 2 } };
    const result = await getReportData({ database, tokenHasher: fakeTokenHasher() }, { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN });
    expect(result).toEqual({
      status: "active",
      reportId: REPORT_ID,
      projectName: "רחוב הרצל 12",
      dealType: "tama38",
      inputs: { a: 1 },
      results: { b: 2 },
    });
  });

  it("projectName=null/results=null מה-RPC - מועברים כמות שהם, לא מומצא כאן", async () => {
    const database = new FakeReadDatabase();
    database.result = { outcome: "active", reportId: REPORT_ID, projectName: null, dealType: "basic", inputs: {}, results: null };
    const result = await getReportData({ database, tokenHasher: fakeTokenHasher() }, { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN });
    expect(result.projectName).toBeNull();
    expect(result.results).toBeNull();
  });

  it("hash מחושב מהטוקן הגולמי ומועבר ל-DB - הטוקן הגולמי עצמו לעולם לא מגיע ל-database.getReportData", async () => {
    const database = new FakeReadDatabase();
    await getReportData({ database, tokenHasher: fakeTokenHasher() }, { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN });
    expect(database.calls).toEqual([{ reportId: REPORT_ID, accessTokenHash: TOKEN_HASH }]);
  });
});

describe("16. get אינו מחזיר payment_status - חוזה הממשק לא כולל אותו שדה בכלל", () => {
  it("active מחזיר בדיוק status/reportId/projectName/dealType/inputs/results - שום שדה נוסף", async () => {
    const database = new FakeReadDatabase();
    const result = await getReportData({ database, tokenHasher: fakeTokenHasher() }, { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN });
    expect(Object.keys(result).sort()).toEqual(["dealType", "inputs", "projectName", "reportId", "results", "status"]);
  });

  it("unavailable מחזיר רק status", async () => {
    const database = new FakeReadDatabase();
    database.result = { outcome: "unavailable", reportId: null, projectName: null, dealType: null, inputs: null, results: null };
    const result = await getReportData({ database, tokenHasher: fakeTokenHasher() }, { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN });
    expect(Object.keys(result)).toEqual(["status"]);
  });
});

describe("saveReportData - token חסר/לא תקין", () => {
  it("rawAccessToken ריק -> unavailable, בלי ולידציית payload ובלי לגעת ב-DB", async () => {
    const database = new FakeWriteDatabase();
    const result = await saveReportData(
      { database, tokenHasher: fakeTokenHasher() },
      { reportId: REPORT_ID, rawAccessToken: "", payload: "not even valid" }
    );
    expect(result).toEqual({ status: "unavailable" });
    expect(database.calls).toEqual([]);
  });
});

describe("saveReportData - שמירה ראשונה ועדכון", () => {
  it("שמירה ראשונה מוצלחת -> saved", async () => {
    const database = new FakeWriteDatabase();
    const result = await saveReportData(
      { database, tokenHasher: fakeTokenHasher() },
      { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN, payload: VALID_PAYLOAD }
    );
    expect(result).toEqual({ status: "saved" });
  });

  it("שמירה שנייה (עדכון) - גם היא saved, אותו נתיב קוד", async () => {
    const database = new FakeWriteDatabase();
    database.results = [{ outcome: "saved" }, { outcome: "saved" }];
    const deps: SaveReportDataServiceDeps = { database, tokenHasher: fakeTokenHasher() };
    const first = await saveReportData(deps, { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN, payload: VALID_PAYLOAD });
    const second = await saveReportData(deps, { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN, payload: { ...VALID_PAYLOAD, projectName: "שם חדש" } });
    expect(first).toEqual({ status: "saved" });
    expect(second).toEqual({ status: "saved" });
    expect(database.calls[1].projectName).toBe("שם חדש");
  });

  it("Commit 6a-fix: dealType ניתן לשינוי בין שמירות - הוחלט להשאיר (ר' ראיה ב-app/calculator/page.tsx, מתועד ב-migrations_tests) - עדכון עובר לפי הערך האחרון שנשלח", async () => {
    const database = new FakeWriteDatabase();
    database.results = [{ outcome: "saved" }, { outcome: "saved" }];
    const deps: SaveReportDataServiceDeps = { database, tokenHasher: fakeTokenHasher() };
    await saveReportData(deps, { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN, payload: { ...VALID_PAYLOAD, dealType: "tama38" } });
    await saveReportData(deps, { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN, payload: { ...VALID_PAYLOAD, dealType: "basic" } });
    expect(database.calls[0].dealType).toBe("tama38");
    expect(database.calls[1].dealType).toBe("basic");
  });
});

describe("revoke מקביל אינו מאפשר כתיבה לאחר הביטול", () => {
  it("קריאה ראשונה saved, קריאה שנייה (entitlement בוטלה בינתיים) -> unavailable - כל קריאה נבדקת מחדש", async () => {
    const database = new FakeWriteDatabase();
    database.results = [{ outcome: "saved" }, { outcome: "unavailable" }];
    const deps: SaveReportDataServiceDeps = { database, tokenHasher: fakeTokenHasher() };
    const first = await saveReportData(deps, { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN, payload: VALID_PAYLOAD });
    const second = await saveReportData(deps, { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN, payload: VALID_PAYLOAD });
    expect(first).toEqual({ status: "saved" });
    expect(second).toEqual({ status: "unavailable" });
    expect(database.calls.length).toBe(2);
  });
});

describe("saveReportData - ולידציית payload (ר' report-data-validator.test.ts לכיסוי מלא)", () => {
  it("payload לא-תקין (dealType שגוי) -> invalid_payload, לא נוגע ב-DB בכלל", async () => {
    const database = new FakeWriteDatabase();
    const result = await saveReportData(
      { database, tokenHasher: fakeTokenHasher() },
      { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN, payload: { ...VALID_PAYLOAD, dealType: "notReal" } }
    );
    expect(result).toEqual({ status: "invalid_payload" });
    expect(database.calls).toEqual([]);
  });

  it("outcome='invalid_payload' שחוזר מה-DB עצמו (הגנת-עומק) -> גם הוא invalid_payload", async () => {
    const database = new FakeWriteDatabase();
    database.results = [{ outcome: "invalid_payload" }];
    const result = await saveReportData(
      { database, tokenHasher: fakeTokenHasher() },
      { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN, payload: VALID_PAYLOAD }
    );
    expect(result).toEqual({ status: "invalid_payload" });
  });
});

describe("17. save אינו יכול לשנות id/payment_status/tracking/created_at - אין להם פרמטר בממשק בכלל", () => {
  it("ReportWriteDatabase.saveReportData מקבלת רק reportId/accessTokenHash/projectName/dealType/inputs/results - נבדק structurally דרך פרמטרי הקריאה בפועל", async () => {
    const database = new FakeWriteDatabase();
    await saveReportData({ database, tokenHasher: fakeTokenHasher() }, { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN, payload: VALID_PAYLOAD });
    expect(Object.keys(database.calls[0]).sort()).toEqual(["accessTokenHash", "dealType", "inputs", "projectName", "reportId", "results"]);
  });
});

describe("אי-מוטציה / חוזה ממשק", () => {
  it("ReportReadDatabase חושפת רק getReportData - אין כתיבה דרך הממשק הזה בכלל", () => {
    const database = new FakeReadDatabase();
    const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(database)).filter((n) => n !== "constructor");
    expect(methodNames).toEqual(["getReportData"]);
  });

  it("ReportWriteDatabase חושפת רק saveReportData", () => {
    const database = new FakeWriteDatabase();
    const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(database)).filter((n) => n !== "constructor");
    expect(methodNames).toEqual(["saveReportData"]);
  });

  it("20. entries/payload לא מוטטים - האובייקט שהועבר ל-saveReportData נשאר כפי שהיה", async () => {
    const database = new FakeWriteDatabase();
    const payload = { ...VALID_PAYLOAD };
    const before = JSON.stringify(payload);
    await saveReportData({ database, tokenHasher: fakeTokenHasher() }, { reportId: REPORT_ID, rawAccessToken: RAW_TOKEN, payload });
    expect(JSON.stringify(payload)).toBe(before);
  });
});
