"use client";

import { useEffect, useState } from "react";
import { computeProject } from "@/lib/calc/engine";
import type { ProjectInputs, ProjectResult } from "@/lib/calc/types";
import ReportView from "@/app/calculator/ReportView";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { CATALOG, formatPriceNis } from "@/lib/catalog";
import { resolveActiveAccess, revokeActiveAccess } from "@/lib/payment/payment-storage";
import { loadReport } from "@/lib/payment/report-client";

export default function SavedReportPage() {
  const [inputs, setInputs] = useState<ProjectInputs | null>(null);
  const [result, setResult] = useState<ProjectResult | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "not_found" | "error">("loading");
  const [reportId, setReportId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
    if (cancelled) return;
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id || !supabaseConfigured) {
      setStatus("not_found");
      return;
    }
    const active = resolveActiveAccess(window.localStorage, id, "baseReport");
    if (!active) {
      setStatus("not_found");
      return;
    }
    void loadReport(supabase.functions, { reportId: id, accessToken: active.accessToken }).then((loaded) => {
        if (cancelled) return;
        if (loaded.kind !== "active") {
          if (loaded.kind === "unavailable" || loaded.kind === "error") {
            revokeActiveAccess(window.localStorage, id, "baseReport");
          }
          setStatus("not_found");
          return;
        }
        setReportId(id);
        const loadedInputs = loaded.inputs as ProjectInputs;
        setInputs(loadedInputs);
        setResult(computeProject(loadedInputs));
        setStatus("ready");
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "loading") {
    return (
      <main className="max-w-3xl mx-auto px-4 py-16 text-center text-gray-500 text-sm">טוען את הדוח...</main>
    );
  }

  if (status === "not_found" || !inputs || !result) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-600 mb-4">הדוח לא נמצא. ייתכן שהקישור שגוי או שהדוח נמחק.</p>
        <a href="/dohefes/start/" className="text-[#1D6F42] underline text-sm">
          בניית דוח אפס חדש ←
        </a>
      </main>
    );
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <div className="print:hidden mb-5 text-center">
        <h1 className="text-lg font-bold text-[#14502F] mb-1">הדוח שלכם</h1>
        <p className="text-sm text-gray-500">
          זהו קישור לצפייה בלבד. להמשך עריכת הפרויקט,{" "}
          <a href={`/dohefes/calculator/?id=${reportId}`} className="text-[#1D6F42] underline">
            חזרה למחולל ←
          </a>
        </p>
        <p className="text-sm text-gray-500 mt-1">
          {CATALOG.trackingReports.displayName} - מוצר המשך אופציונלי לדוח זה,{" "}
          {formatPriceNis(CATALOG.trackingReports.priceAgorot)} נוספים.{" "}
          <a href={`/dohefes/tracking/?id=${reportId}`} className="text-[#1D6F42] underline">
            מעבר לדוח מעקב בנייה ←
          </a>
        </p>
      </div>

      {/* העמוד מגיע לכאן רק אחרי קריאה מאובטחת עם entitlement פעילה של baseReport. */}
      <ReportView inputs={inputs} result={result} outputAccess="full" />
    </main>
  );
}
