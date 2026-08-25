"use client";

import { useEffect, useState } from "react";
import { computeProject } from "@/lib/calc/engine";
import type { ProjectInputs, ProjectResult } from "@/lib/calc/types";
import ReportView from "@/app/calculator/ReportView";
import { downloadWorkbook } from "@/lib/report/exportExcel";
import { supabase, supabaseConfigured } from "@/lib/supabase";

export default function SavedReportPage() {
  const [inputs, setInputs] = useState<ProjectInputs | null>(null);
  const [result, setResult] = useState<ProjectResult | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "not_found" | "error">("loading");
  const [reportId, setReportId] = useState<string | null>(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id || !supabaseConfigured) {
      setStatus("not_found");
      return;
    }
    setReportId(id);
    supabase
      .from("dohefes_reports")
      .select("inputs")
      .eq("id", id)
      .single()
      .then(({ data, error }) => {
        if (error || !data?.inputs) {
          setStatus("not_found");
          return;
        }
        const loadedInputs = data.inputs as ProjectInputs;
        setInputs(loadedInputs);
        setResult(computeProject(loadedInputs));
        setStatus("ready");
      });
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
          <a href={`/dohefes/tracking/?id=${reportId}`} className="text-[#1D6F42] underline">
            מעבר לדוח מעקב בנייה ←
          </a>
        </p>
      </div>

      <ReportView inputs={inputs} result={result} />

      <div className="print:hidden flex flex-col sm:flex-row gap-2 mt-4">
        <button
          onClick={() => downloadWorkbook(inputs, result)}
          className="flex-1 bg-[#1D6F42] hover:bg-[#14502F] text-white font-medium text-sm px-4 py-2.5 rounded-lg transition-colors"
        >
          הורדת קובץ Excel
        </button>
        <button
          onClick={() => window.print()}
          className="flex-1 bg-white border border-[#1D6F42] text-[#1D6F42] hover:bg-[#EAF3EC] font-medium text-sm px-4 py-2.5 rounded-lg transition-colors"
        >
          הדפסה / שמירה כ-PDF
        </button>
      </div>
    </main>
  );
}
