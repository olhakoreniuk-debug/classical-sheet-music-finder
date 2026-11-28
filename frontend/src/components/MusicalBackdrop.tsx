// Decorative corner backdrop: a pale blue glow with a flowing staff, a treble
// clef, notes, a sharp and a flat, fading diagonally. Purely presentational:
// hidden from assistive technology, never focusable, behind all content.
import { useId } from 'react';
import styles from './MusicalBackdrop.module.css';

/** Stylised treble clef, drawn as one stroke (viewBox 0 0 40 100). */
export const TREBLE_CLEF_PATH =
  'M20 96 C 26 98 30 92 26 88 M24 92 L 25 10 C 25 2 34 4 33 14 C 32 26 20 34 13 42 C 5 52 6 70 22 72 C 36 72 37 54 24 52 C 15 51 14 62 22 64';

const STAFF_PATH = 'M800 76 C 640 114, 560 220, 420 276 S 170 380, -20 520';
const STAFF_LINE_OFFSETS = [0, 10, 20, 30, 40];

function Note({ x, y, angle, hollow = false, flag = false }: { x: number; y: number; angle: number; hollow?: boolean; flag?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`}>
      <ellipse
        rx="6.4"
        ry="4.4"
        transform="rotate(-22)"
        className={hollow ? styles.hollow : styles.filled}
      />
      <path d={flag ? 'M5.6 -2 V -30 C 8 -22 16 -20 14 -8' : 'M5.6 -2 V -30'} />
    </g>
  );
}

function Sharp({ x, y, angle }: { x: number; y: number; angle: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`}>
      <path d="M-3 -12 V 13 M3 -14 V 11" />
      <path className={styles.heavy} d="M-7 -2 L 7 -6 M-7 6 L 7 2" />
    </g>
  );
}

export function MusicalBackdrop() {
  const id = useId().replace(/:/g, '');
  const glow = `${id}-glow`;
  const fade = `${id}-fade`;
  const mask = `${id}-mask`;

  return (
    <div className={styles.backdrop} aria-hidden="true">
      <svg viewBox="0 0 760 600" preserveAspectRatio="xMaxYMin slice" focusable="false">
        <defs>
          <radialGradient id={glow} cx="88%" cy="6%" r="78%">
            <stop offset="0" stopColor="#dce6ff" stopOpacity="0.95" />
            <stop offset="0.45" stopColor="#eaf0ff" stopOpacity="0.6" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={fade} x1="1" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="0.75" stopColor="#ffffff" stopOpacity="0.25" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <mask id={mask}>
            <rect width="760" height="600" fill={`url(#${fade})`} />
          </mask>
        </defs>
        <rect width="760" height="600" fill={`url(#${glow})`} />
        <g mask={`url(#${mask})`} className={styles.ink}>
          <g className={styles.staff}>
            {STAFF_LINE_OFFSETS.map((offset) => (
              <path key={offset} d={STAFF_PATH} transform={`translate(0 ${offset})`} />
            ))}
          </g>
          <g className={styles.symbols}>
            <path className={styles.clef} transform="translate(668 58) rotate(-14) scale(0.95)" d={TREBLE_CLEF_PATH} />
            <Sharp x={600} y={142} angle={-20} />
            <Note x={546} y={178} angle={-22} flag />
            <g transform="translate(486 222) rotate(-24)">
              <ellipse rx="6.4" ry="4.4" transform="rotate(-22)" className={styles.filled} />
              <ellipse cx="22" cy="-6" rx="6.4" ry="4.4" transform="rotate(-22 22 -6)" className={styles.filled} />
              <path d="M5.6 -2 V -30 M27.6 -8 V -36" />
              <path className={styles.beam} d="M5.6 -29 L 27.6 -35" />
            </g>
            <g transform="translate(372 294) rotate(-20)">
              <path d="M0 -20 V 8 C 9 2 10 -6 3 -6 C 1 -6 0 -4 0 -2" />
            </g>
            <Note x={300} y={320} angle={-18} hollow />
            <Sharp x={222} y={368} angle={-16} />
            <Note x={150} y={410} angle={-14} />
          </g>
        </g>
      </svg>
    </div>
  );
}
