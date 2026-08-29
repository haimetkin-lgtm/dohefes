import { describe, expect, it } from "vitest";
import { loadReport, saveReport } from "./report-client";
import type { FunctionsInvoker } from "./payment-client";
import type { ProjectInputs, ProjectResult } from "../calc/types";

const REPORT_ID = "11111111-1111-1111-1111-111111111111";

function invokerWith(data: unknown): { invoker: FunctionsInvoker; calls: Array<{ name: string; options?: { headers?: Record<string, string>; body?: unknown } }> } {
  const calls: Array<{ name: string; options?: { headers?: Record<string, string>; body?: unknown } }> = [];
  return {
    calls,
    invoker: {
      async invoke<T>(name: string, options?: { headers?: Record<string, string>; body?: unknown }) {
        calls.push({ name, options });
        return { data: data as T, error: null };
      },
    },
  };
}

describe("report-client", () => {
  it("טוען דרך Function עם token בכותרת ו-reportId בלבד בגוף", async () => {
    const inputs = { projectName: "בדיקה" } as ProjectInputs;
    const fake = invokerWith({ status: "active", reportId: REPORT_ID, inputs });
    await expect(loadReport(fake.invoker, { reportId: REPORT_ID, accessToken: "secret" })).resolves.toEqual({ kind: "active", inputs });
    expect(fake.calls[0]).toEqual({
      name: "dohefes-get-report-data",
      options: { headers: { "X-Access-Token": "secret" }, body: { reportId: REPORT_ID } },
    });
  });

  it("דוחה תשובת active של reportId אחר", async () => {
    const fake = invokerWith({ status: "active", reportId: "other", inputs: {} });
    await expect(loadReport(fake.invoker, { reportId: REPORT_ID, accessToken: "secret" })).resolves.toEqual({ kind: "error", reason: "invalid_response_shape" });
  });

  it("שומר payload בלבד דרך Function ללא payment_status", async () => {
    const inputs = { projectName: "פרויקט", dealType: "basic" } as ProjectInputs;
    const results = {} as ProjectResult;
    const fake = invokerWith({ status: "saved" });
    await expect(saveReport(fake.invoker, { reportId: REPORT_ID, accessToken: "secret", inputs, results })).resolves.toEqual({ kind: "saved" });
    expect(fake.calls[0].options?.body).toEqual({ reportId: REPORT_ID, projectName: "פרויקט", dealType: "basic", inputs, results });
    expect(JSON.stringify(fake.calls[0])).not.toContain("payment_status");
  });
});
