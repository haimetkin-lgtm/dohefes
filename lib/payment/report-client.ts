import type { ProjectInputs, ProjectResult } from "../calc/types";
import type { FunctionsInvoker } from "./payment-client";
import { errorReasonFromBody, isRetryableHttpStatus, readHttpErrorBody } from "./payment-client";

export type LoadReportResult =
  | { kind: "active"; inputs: ProjectInputs }
  | { kind: "unavailable" }
  | { kind: "retryable" }
  | { kind: "error"; reason: string };

export async function loadReport(
  invoker: FunctionsInvoker,
  input: { reportId: string; accessToken: string }
): Promise<LoadReportResult> {
  const { data, error } = await invoker.invoke<{
    status?: unknown;
    reportId?: unknown;
    inputs?: unknown;
  }>("dohefes-get-report-data", {
    headers: { "X-Access-Token": input.accessToken },
    body: { reportId: input.reportId },
  });
  if (error) {
    const http = await readHttpErrorBody(error);
    if (isRetryableHttpStatus(http.status)) return { kind: "retryable" };
    return { kind: "error", reason: errorReasonFromBody(http.body, `http_${http.status}`) };
  }
  if (data?.status === "unavailable") return { kind: "unavailable" };
  if (data?.status !== "active" || data.reportId !== input.reportId || typeof data.inputs !== "object" || data.inputs === null) {
    return { kind: "error", reason: "invalid_response_shape" };
  }
  return { kind: "active", inputs: data.inputs as ProjectInputs };
}

export type SaveReportResult = { kind: "saved" } | { kind: "unavailable" } | { kind: "retryable" } | { kind: "error"; reason: string };

export async function saveReport(
  invoker: FunctionsInvoker,
  input: { reportId: string; accessToken: string; inputs: ProjectInputs; results: ProjectResult }
): Promise<SaveReportResult> {
  const { data, error } = await invoker.invoke<{ status?: unknown }>("dohefes-save-report-data", {
    headers: { "X-Access-Token": input.accessToken },
    body: {
      reportId: input.reportId,
      projectName: input.inputs.projectName || null,
      dealType: input.inputs.dealType,
      inputs: input.inputs,
      results: input.results,
    },
  });
  if (error) {
    const http = await readHttpErrorBody(error);
    if (isRetryableHttpStatus(http.status)) return { kind: "retryable" };
    return { kind: "error", reason: errorReasonFromBody(http.body, `http_${http.status}`) };
  }
  if (data?.status === "saved" || data?.status === "unavailable") return { kind: data.status };
  return { kind: "error", reason: data?.status === "invalid_payload" ? "invalid_payload" : "invalid_response_shape" };
}
