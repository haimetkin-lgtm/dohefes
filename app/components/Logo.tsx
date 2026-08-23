// לוגו "דוח אפס", ליטוש B שנבחר, שורת הנוסחה בלבד (בלי שורת הגריד, שמורה לבאנר).
// מקור: ארטיפקט הלוגו, https://claude.ai/code/artifact/13cc9205-8a07-4c98-a7ee-645d2426d922
// מלווה את כל דפי האתר (כותרת, layout.tsx) וגם את הדוחות (ReportView.tsx).

const C = {
  surface: "#FFFFFF",
  line: "#DCDFD6",
  xlgreenSoft: "#E3EFE7",
  xlgreenDeep: "#14502F",
  inkFaint: "#8C97A0",
  ink: "#1B232C",
};

export default function Logo({ height = 44 }: { height?: number }) {
  const width = (320 / 56) * height;
  return (
    <svg width={width} height={height} viewBox="0 0 320 56" role="img" aria-label="דוח אפס">
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
    </svg>
  );
}
