// לוגו "דוח אפס", ליטוש B שנבחר במלואו: שורת הנוסחה + שורת הגריד A-D מתחת.
// מקור: ארטיפקט הלוגו, https://claude.ai/code/artifact/13cc9205-8a07-4c98-a7ee-645d2426d922
// מלווה את כל דפי האתר (כותרת, layout.tsx) וגם את הדוחות (ReportView.tsx).

const C = {
  surface: "#FFFFFF",
  line: "#DCDFD6",
  xlgreenSoft: "#E3EFE7",
  xlgreenDeep: "#14502F",
  xlgreen: "#1D6F42",
  inkFaint: "#8C97A0",
  ink: "#1B232C",
};

export default function Logo({ height = 60 }: { height?: number }) {
  const width = (320 / 112) * height;
  return (
    <svg width={width} height={height} viewBox="0 0 320 112" role="img" aria-label="דוח אפס">
      <rect x="0" y="0" width="320" height="56" rx="12" fill={C.surface} stroke={C.line} strokeWidth="1.5" />
      <path d="M266,0 L308,0 A12,12 0 0 1 320,12 L320,44 A12,12 0 0 1 308,56 L266,56 Z" fill={C.xlgreenSoft} />
      <text x="293" y="35" fontFamily="'Frank Ruhl Libre', serif" fontSize="19" fontWeight="800" fill={C.xlgreenDeep} textAnchor="middle">
        0
      </text>
      <line x1="266" y1="11" x2="266" y2="45" stroke={C.line} strokeWidth="1.4" />
      <text x="246" y="34" fontFamily="ui-monospace, Consolas, monospace" fontStyle="italic" fontSize="14" fontWeight="600" fill={C.inkFaint} textAnchor="middle">
        fx
      </text>
      <line x1="226" y1="11" x2="226" y2="45" stroke={C.line} strokeWidth="1.4" />
      <text x="113" y="35" fontFamily="'Frank Ruhl Libre', serif" fontSize="25" fontWeight="700" fill={C.ink} textAnchor="middle">
        דוח אפס
      </text>

      <g transform="translate(0,68)">
        <text x="304" y="10" fontFamily="ui-monospace, Consolas, monospace" fontSize="9.5" fill={C.inkFaint} textAnchor="middle">
          A
        </text>
        <text x="228" y="10" fontFamily="ui-monospace, Consolas, monospace" fontSize="9.5" fill={C.inkFaint} textAnchor="middle">
          B
        </text>
        <text x="152" y="10" fontFamily="ui-monospace, Consolas, monospace" fontSize="9.5" fill={C.inkFaint} textAnchor="middle">
          C
        </text>
        <text x="76" y="10" fontFamily="ui-monospace, Consolas, monospace" fontSize="9.5" fill={C.inkFaint} textAnchor="middle">
          D
        </text>
        <g stroke={C.line} strokeWidth="1.2" fill="none">
          <rect x="0" y="16" width="320" height="26" />
          <line x1="76" y1="16" x2="76" y2="42" />
          <line x1="152" y1="16" x2="152" y2="42" />
          <line x1="228" y1="16" x2="228" y2="42" />
        </g>
        <rect x="190" y="16" width="38" height="26" fill={C.xlgreen} />
        <text x="209" y="34" fontFamily="ui-monospace, Consolas, monospace" fontSize="13" fontWeight="700" fill="#FFFFFF" textAnchor="middle">
          0
        </text>
      </g>
    </svg>
  );
}
