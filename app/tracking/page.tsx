"use client";

import { useEffect, useState } from "react";
import type { TrackingItem } from "@/lib/tracking/types";
import { computeTrackingTotals, itemBudgetNis } from "@/lib/tracking/types";
import { downloadTrackingWorkbook } from "@/lib/report/exportTrackingExcel";
import { supabase, supabaseConfigured } from "@/lib/supabase";

function emptyItem(): TrackingItem {
  return { id: crypto.randomUUID(), phase: "", description: "", quantity: 1, unitPriceNis: 0, actualNis: 0 };
}

function nis(n: number): string {
  return Math.round(n).toLocaleString("he-IL");
}

export default function TrackingPage() {
  const [reportId, setReportId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [items, setItems] = useState<TrackingItem[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "not_found">("loading");
  const [urlParsed, setUrlParsed] = useState(false);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id || !supabaseConfigured) {
      setStatus("not_found");
      setUrlParsed(true);
      return;
    }
    supabase
      .from("dohefes_reports")
      .select("project_name, tracking")
      .eq("id", id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          setStatus("not_found");
          setUrlParsed(true);
          return;
        }
        setReportId(id);
        setProjectName(data.project_name || "");
        setItems(((data.tracking as TrackingItem[] | null) || []) as TrackingItem[]);
        setStatus("ready");
        setUrlParsed(true);
      });
  }, []);

  // שמירה רציפה (debounced) של סעיפי המעקב בכל שינוי
  useEffect(() => {
    if (!urlParsed || !reportId || !supabaseConfigured) return;
    const timer = setTimeout(() => {
      supabase
        .from("dohefes_reports")
        .update({ tracking: items })
        .eq("id", reportId)
        .then(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [urlParsed, reportId, items]);

  function updateItem(id: string, patch: Partial<TrackingItem>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  if (status === "loading") {
    return <main className="max-w-4xl mx-auto px-4 py-16 text-center text-gray-500 text-sm">טוען את דוח המעקב...</main>;
  }

  if (status === "not_found" || !reportId) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-600 mb-4">דוח המעקב לא נמצא. ייתכן שהקישור שגוי, או שהדוח עדיין לא נשמר.</p>
        <a href="/dohefes/start/" className="text-[#1D6F42] underline text-sm">
          בניית דוח אפס חדש ←
        </a>
      </main>
    );
  }

  const totals = computeTrackingTotals(items);

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
        <h1 className="text-xl font-bold text-[#14502F] mb-1">דוח מעקב בנייה</h1>
        <p className="text-sm text-gray-500 mb-1">{projectName || "פרויקט ללא שם"}</p>
        <p className="text-xs text-gray-500 mb-6">
          תקציב מול ביצוע בפועל, לפי שלבי בנייה. הדוח נשמר אוטומטית עם כל שינוי.{" "}
          <a href={`/dohefes/calculator/?id=${reportId}`} className="text-[#1D6F42] underline">
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
                                onChange={(e) => updateItem(item.id, { description: e.target.value })}
                                className="w-full border border-gray-200 rounded px-1.5 py-1"
                                placeholder="למשל: כלונסאות"
                              />
                            </td>
                            <td className="px-2 py-1">
                              <input
                                type="text"
                                value={item.phase}
                                onChange={(e) => updateItem(item.id, { phase: e.target.value })}
                                className="w-full border border-gray-200 rounded px-1.5 py-1"
                                placeholder="למשל: ביסוס"
                              />
                            </td>
                            <td className="px-2 py-1">
                              <input
                                type="number"
                                value={item.quantity}
                                onChange={(e) => updateItem(item.id, { quantity: Number(e.target.value) })}
                                className="w-full border border-gray-200 rounded px-1.5 py-1"
                              />
                            </td>
                            <td className="px-2 py-1">
                              <input
                                type="number"
                                value={item.unitPriceNis}
                                onChange={(e) => updateItem(item.id, { unitPriceNis: Number(e.target.value) })}
                                className="w-full border border-gray-200 rounded px-1.5 py-1"
                              />
                            </td>
                            <td className="px-2 py-1 text-gray-600">{nis(budget)}</td>
                            <td className="px-2 py-1">
                              <input
                                type="number"
                                value={item.actualNis}
                                onChange={(e) => updateItem(item.id, { actualNis: Number(e.target.value) })}
                                className="w-full border border-gray-200 rounded px-1.5 py-1"
                              />
                            </td>
                            <td className="px-2 py-1 text-gray-600">{Math.round(percent * 100)}%</td>
                            <td className="px-2 py-1 text-gray-600">{nis(remaining)}</td>
                            <td className="px-2 py-1">
                              <button onClick={() => removeItem(item.id)} className="text-red-500 hover:text-red-700" aria-label="מחיקת סעיף">
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
          onClick={() => setItems((prev) => [...prev, emptyItem()])}
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

        <div className="flex flex-col sm:flex-row gap-2">
          <button
            onClick={() => downloadTrackingWorkbook(projectName, items)}
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

      <main className="hidden print:block max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-xl font-bold text-[#14502F] mb-1">דוח מעקב בנייה</h1>
        <p className="text-sm text-gray-600 mb-4">{projectName || "פרויקט ללא שם"}</p>
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
