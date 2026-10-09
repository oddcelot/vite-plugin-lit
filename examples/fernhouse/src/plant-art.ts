import {html, svg, type SVGTemplateResult, type TemplateResult} from 'lit';
import type {PlantKind} from './products';

// Small hand-drawn plants for the cards' `media` slot. Each is drawn around
// (0, 0), the middle of the pot's rim, and moved into place below.
const leaf = (d: string, fill: string) => svg`<path d=${d} fill=${fill} />`;

const plants: Record<PlantKind, SVGTemplateResult> = {
  monstera: svg`
    <path d="M0 0C-4 -18 -10 -30 -26 -40M0 0C2 -20 8 -34 22 -46M0 0C-2 -14 -2 -30 -2 -56" stroke="#2c6a45" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <g transform="translate(-30 -44) rotate(-30)">${leaf('M0 0C-30 -6 -36 -36 -12 -48C2 -54 22 -48 26 -32C30 -14 18 -2 0 0Z', '#3d8a58')}<path d="M-22 -18L-6 -22M-24 -32L-6 -30M-10 -44L0 -34M8 -46L4 -32M18 -30L6 -24" stroke="#d9e8d4" stroke-width="2.4" stroke-linecap="round"/></g>
    <g transform="translate(24 -48) rotate(28)">${leaf('M0 0C-26 -4 -32 -30 -12 -42C0 -48 18 -44 22 -30C26 -14 16 -2 0 0Z', '#3f8a57')}<path d="M-18 -16L-4 -20M-20 -30L-4 -26M-8 -40L0 -30M10 -38L4 -26M16 -24L6 -18" stroke="#d9e8d4" stroke-width="2.2" stroke-linecap="round"/></g>
    <g transform="translate(-2 -58) rotate(-4)">${leaf('M0 0C-22 -2 -28 -24 -12 -34C-2 -40 14 -36 18 -24C22 -10 14 -2 0 0Z', '#5aa56e')}<path d="M-16 -12L-4 -16M-16 -24L-2 -22M4 -34L2 -24M14 -20L4 -14" stroke="#d9e8d4" stroke-width="2" stroke-linecap="round"/></g>`,
  fiddle: svg`
    <path d="M0 0C1 -30 -1 -60 0 -92" stroke="#6b5a3c" stroke-width="3" fill="none" stroke-linecap="round"/>
    <g transform="translate(-2 -26) rotate(-62)">${leaf('M0 0C-6 -18 4 -34 16 -34C28 -34 30 -16 22 -6C16 2 6 4 0 0Z', '#3c7f52')}</g>
    <g transform="translate(2 -42) rotate(58)">${leaf('M0 0C-6 -18 4 -34 16 -34C28 -34 30 -16 22 -6C16 2 6 4 0 0Z', '#4a9560')}</g>
    <g transform="translate(-1 -58) rotate(-52)">${leaf('M0 0C-6 -18 4 -34 16 -34C28 -34 30 -16 22 -6C16 2 6 4 0 0Z', '#3c7f52')}</g>
    <g transform="translate(1 -72) rotate(46)">${leaf('M0 0C-6 -18 4 -34 16 -34C28 -34 30 -16 22 -6C16 2 6 4 0 0Z', '#5aa56e')}</g>
    <g transform="translate(0 -90) rotate(-14)">${leaf('M0 0C-6 -14 2 -28 12 -28C22 -28 24 -12 18 -4C12 2 4 3 0 0Z', '#4a9560')}</g>`,
  snake: svg`
    <path d="M-22 0C-30 -30 -24 -56 -18 -70C-10 -52 -8 -24 -8 0Z" fill="#2f6f4e"/>
    <path d="M-4 0C-6 -40 -2 -78 4 -96C14 -70 14 -30 12 0Z" fill="#3f8a57"/>
    <path d="M10 0C12 -30 22 -50 32 -60C34 -36 28 -14 24 0Z" fill="#2c6a45"/>
    <path d="M-16 -20L-10 -22M-14 -42L-8 -44M2 -30L8 -32M4 -58L10 -60M-6 -70L0 -72M22 -20L28 -22" stroke="#bcd8b8" stroke-width="2.4" stroke-linecap="round" opacity="0.8"/>
    <path d="M-4 -90L4 -96M10 -64L6 -90" stroke="#d6e86a" stroke-width="1.6" stroke-linecap="round" fill="none" opacity="0.6"/>`,
  pothos: svg`
    <path d="M-6 0C-26 -10 -40 -4 -50 14M6 0C24 -14 38 -6 46 12M0 0C-2 -22 4 -40 0 -58" stroke="#2c6a45" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    ${[
      [-18, -10, 200, '#4f9a64'],
      [-34, -4, 170, '#d7c24a'],
      [-48, 12, 150, '#3f8a57'],
      [14, -14, -20, '#d7c24a'],
      [32, -8, 10, '#4f9a64'],
      [44, 10, 30, '#3f8a57'],
      [0, -30, -10, '#4f9a64'],
      [-4, -50, 20, '#d7c24a'],
    ].map(
      ([x, y, r, c]) =>
        svg`<g transform="translate(${x} ${y}) rotate(${r}) scale(0.8)">${leaf('M0 0C-12 -6 -14 -20 0 -26C14 -20 12 -6 0 0Z', String(c))}</g>`
    )}`,
  zz: svg`
    <path d="M0 0C-14 -20 -26 -36 -34 -60M0 0C0 -30 0 -50 2 -76M0 0C14 -20 26 -34 36 -58" stroke="#2c6a45" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    ${[
      [-8, -14, -50],
      [-16, -28, -46],
      [-24, -42, -40],
      [-31, -56, -34],
      [0, -26, 0],
      [1, -46, 4],
      [1, -66, 0],
      [8, -14, 50],
      [16, -28, 46],
      [26, -42, 40],
      [33, -54, 34],
    ].map(
      ([x, y, r]) =>
        svg`<g transform="translate(${x} ${y}) rotate(${r})"><ellipse cx="0" cy="-8" rx="6" ry="10" fill="#2f7a4f"/></g>`
    )}`,
  calathea: svg`
    <path d="M-4 0C-14 -22 -26 -34 -34 -40M4 0C12 -22 24 -32 34 -38M0 0C0 -30 0 -48 0 -60" stroke="#2c6a45" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <g transform="translate(-34 -40) rotate(-40)"><ellipse cx="0" cy="-16" rx="15" ry="22" fill="#4a9560"/><path d="M0 -4V-34M0 -12L-9 -20M0 -12L9 -20M0 -22L-8 -29M0 -22L8 -29" stroke="#d9e8d4" stroke-width="1.8" stroke-linecap="round"/></g>
    <g transform="translate(34 -38) rotate(40)"><ellipse cx="0" cy="-16" rx="15" ry="22" fill="#3c7f52"/><path d="M0 -4V-34M0 -12L-9 -20M0 -12L9 -20M0 -22L-8 -29M0 -22L8 -29" stroke="#d9e8d4" stroke-width="1.8" stroke-linecap="round"/></g>
    <g transform="translate(0 -60)"><ellipse cx="0" cy="-16" rx="17" ry="24" fill="#5aa56e"/><path d="M0 -2V-38M0 -10L-10 -19M0 -10L10 -19M0 -22L-9 -30M0 -22L9 -30" stroke="#d9e8d4" stroke-width="1.8" stroke-linecap="round"/></g>`,
};

/** A plant on a soft green ground, for a card's `media` slot. */
export function plantArt(kind: PlantKind): TemplateResult {
  return html`<svg
    slot="media"
    viewBox="0 0 412 160"
    preserveAspectRatio="xMidYMax slice"
    role="img"
    aria-label=${kind}
  >
    <defs>
      <linearGradient id="fh-bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#eaf2e3" />
        <stop offset="1" stop-color="#cfe2cc" />
      </linearGradient>
      <radialGradient id="fh-glow" cx="0.5" cy="0.6" r="0.5">
        <stop offset="0" stop-color="#fff" stop-opacity="0.75" />
        <stop offset="1" stop-color="#fff" stop-opacity="0" />
      </radialGradient>
    </defs>
    <rect width="412" height="160" fill="url(#fh-bg)" />
    <ellipse cx="206" cy="90" rx="150" ry="80" fill="url(#fh-glow)" />
    <ellipse cx="206" cy="158" rx="46" ry="4" fill="#1f2a1f" opacity="0.1" />
    <g transform="translate(206 118)">${plants[kind]}</g>
    <path d="M184 118H228L223 158H189Z" fill="#d9c7a7" />
    <path d="M182 113H230V121H182Z" fill="#cbb38d" />
  </svg>`;
}
