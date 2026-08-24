"use client";

import { useState } from "react";

export default function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        aria-label="מידע נוסף"
        aria-expanded={open}
        className="w-4 h-4 rounded-full bg-gray-200 text-gray-500 text-xs flex items-center justify-center cursor-help leading-none shrink-0"
      >
        ?
      </button>
      {open && (
        <span className="absolute top-full inset-x-0 mt-1.5 bg-gray-800 text-white text-xs rounded-lg px-3 py-2 z-10 shadow-lg leading-relaxed">
          {text}
        </span>
      )}
    </>
  );
}
