// באנר "מהחישוב לבניין": דמות מחשבת מול מחשב, לוגו הדוח, בנק שמאשר, ואתר בנייה עם מנוף.
// מקור: ארטיפקט הלוגו, https://claude.ai/code/artifact/13cc9205-8a07-4c98-a7ee-645d2426d922
// (סקשן "רעיון נלווה, באנר לעמוד הבית"), מועתק כאן בדיוק.

const C = {
  ink: "#1B232C",
  inkFaint: "#8C97A0",
  line: "#DCDFD6",
  surface: "#FFFFFF",
  surface2: "#EBEDE7",
  xlgreenSoft: "#E3EFE7",
  xlgreen: "#1D6F42",
  xlgreenDeep: "#14502F",
  brass: "#A9782F",
};

export default function Banner() {
  return (
    <div>
      <svg viewBox="0 0 880 200" className="w-full h-auto">
        <line x1="20" y1="170" x2="860" y2="170" stroke={C.line} strokeWidth="1.5" />

        {/* בניין בבנייה */}
        <g>
          <rect x="50" y="146" width="110" height="24" fill={C.xlgreenSoft} stroke={C.line} strokeWidth="1.2" />
          <rect x="50" y="122" width="110" height="24" fill={C.xlgreenSoft} stroke={C.line} strokeWidth="1.2" />
          <rect x="50" y="98" width="110" height="24" fill="none" stroke={C.line} strokeWidth="1.2" />
          <rect x="50" y="74" width="110" height="24" fill="none" stroke={C.inkFaint} strokeWidth="1.2" strokeDasharray="3 3" />
          <g stroke={C.inkFaint} strokeWidth="1.4">
            <line x1="60" y1="74" x2="60" y2="62" />
            <line x1="105" y1="74" x2="105" y2="62" />
            <line x1="150" y1="74" x2="150" y2="62" />
          </g>
        </g>

        {/* מנוף */}
        <g stroke={C.ink} strokeLinecap="round">
          <line x1="195" y1="170" x2="195" y2="26" strokeWidth="3" />
          <line x1="195" y1="26" x2="45" y2="26" strokeWidth="3" />
          <line x1="195" y1="26" x2="228" y2="26" strokeWidth="3" />
          <line x1="195" y1="10" x2="90" y2="26" strokeWidth="1.2" />
          <line x1="90" y1="26" x2="90" y2="54" strokeWidth="1.5" />
        </g>
        <rect x="218" y="21" width="14" height="11" fill={C.ink} rx="1.5" />
        <rect x="186" y="26" width="18" height="14" fill={C.ink} rx="2" />
        <path d="M84,54 a6,6 0 1 0 12,0" fill="none" stroke={C.ink} strokeWidth="2" />

        {/* בנק */}
        <g>
          <rect x="252" y="168" width="80" height="4" fill={C.inkFaint} />
          <path d="M255,130 L330,130 L292.5,98 Z" fill={C.brass} />
          <rect x="258" y="130" width="68" height="10" fill={C.surface} stroke={C.ink} strokeWidth="1.2" />
          <text x="292" y="138.5" fontFamily="Heebo, sans-serif" fontSize="11" fontWeight="700" fill={C.ink} textAnchor="middle">
            בנק
          </text>
          <g stroke={C.ink} strokeWidth="2.5" strokeLinecap="round">
            <line x1="270" y1="141" x2="270" y2="167" />
            <line x1="292" y1="141" x2="292" y2="167" />
            <line x1="314" y1="141" x2="314" y2="167" />
          </g>
        </g>

        {/* לוגו, ליטוש B */}
        <g transform="translate(360,66)">
          <rect x="0" y="0" width="320" height="56" rx="12" fill={C.surface} stroke={C.line} strokeWidth="1.5" />
          <path d="M266,0 L308,0 A12,12 0 0 1 320,12 L320,44 A12,12 0 0 1 308,56 L266,56 Z" fill={C.xlgreenSoft} />
          <text x="293" y="35" fontFamily="Frank Ruhl Libre, serif" fontSize="19" fontWeight="800" fill={C.xlgreenDeep} textAnchor="middle">
            0
          </text>
          <line x1="266" y1="11" x2="266" y2="45" stroke={C.line} strokeWidth="1.4" />
          <text x="246" y="34" fontFamily="ui-monospace, Consolas, monospace" fontStyle="italic" fontSize="14" fontWeight="600" fill={C.inkFaint} textAnchor="middle">
            fx
          </text>
          <line x1="226" y1="11" x2="226" y2="45" stroke={C.line} strokeWidth="1.4" />
          <text x="113" y="35" fontFamily="Frank Ruhl Libre, serif" fontSize="25" fontWeight="700" fill={C.ink} textAnchor="middle">
            דוח אפס
          </text>
        </g>

        {/* שולחן ומחשב */}
        <g>
          <line x1="722" y1="148" x2="722" y2="170" stroke={C.ink} strokeWidth="3" strokeLinecap="round" />
          <line x1="828" y1="148" x2="828" y2="170" stroke={C.ink} strokeWidth="3" strokeLinecap="round" />
          <rect x="710" y="140" width="130" height="8" fill={C.ink} rx="2" />
          <rect x="745" y="132" width="40" height="8" fill={C.surface2} stroke={C.line} strokeWidth="1.2" rx="2" />
          <rect x="745" y="96" width="40" height="36" fill={C.surface} stroke={C.ink} strokeWidth="2" rx="3" />
          <rect x="749" y="100" width="32" height="28" fill={C.xlgreenSoft} />
          <rect x="754" y="118" width="5" height="8" fill={C.xlgreen} />
          <rect x="762" y="112" width="5" height="14" fill={C.xlgreen} />
          <rect x="770" y="106" width="5" height="20" fill={C.xlgreen} />
        </g>

        {/* דמות יושבת */}
        <g>
          <line x1="802" y1="150" x2="802" y2="170" stroke={C.inkFaint} strokeWidth="2.5" strokeLinecap="round" />
          <line x1="822" y1="150" x2="822" y2="170" stroke={C.inkFaint} strokeWidth="2.5" strokeLinecap="round" />
          <rect x="798" y="142" width="28" height="8" fill={C.inkFaint} rx="3" />
          <rect x="796" y="106" width="24" height="36" fill={C.ink} rx="11" />
          <line x1="798" y1="122" x2="780" y2="126" stroke={C.ink} strokeWidth="4" strokeLinecap="round" />
          <circle cx="808" cy="94" r="12" fill={C.ink} />
        </g>
      </svg>
    </div>
  );
}
