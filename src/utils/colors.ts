/**
 * Tiny chalk-compatible color shim built on picocolors.
 *
 * Supports the chainable subset Ubon actually uses:
 *   - basic colors: red, green, yellow, blue, cyan, gray, white, black
 *   - basic backgrounds: bgRed, bgYellow, bgBlue
 *   - modifiers: bold, dim, italic, underline
 *   - hex/bgHex truecolor (24-bit ANSI) for branded UI
 *
 * Honors NO_COLOR, FORCE_COLOR, and process.stdout.isTTY via picocolors' own
 * detection. If colors are disabled the styler is a pass-through identity.
 */

import pc from 'picocolors';

type StyleFn = (input: string) => string;

interface Styler extends StyleFn {
  red: Styler;
  green: Styler;
  yellow: Styler;
  blue: Styler;
  cyan: Styler;
  gray: Styler;
  white: Styler;
  black: Styler;
  bgRed: Styler;
  bgYellow: Styler;
  bgBlue: Styler;
  bgGreen: Styler;
  bold: Styler;
  dim: Styler;
  italic: Styler;
  underline: Styler;
  hex: (color: string) => Styler;
  bgHex: (color: string) => Styler;
}

const isColorEnabled = (): boolean => {
  if (process.env.NO_COLOR) return false;
  return Boolean(pc.isColorSupported);
};

function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace(/^#/, '');
  const full = v.length === 3 ? v.split('').map((c) => c + c).join('') : v;
  const num = Number.parseInt(full, 16);
  if (Number.isNaN(num)) return [255, 255, 255];
  return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff];
}

interface Code { open: string; close: string }

const RESET = '\u001b[0m';
const ansi = (code: number): Code => ({ open: `\u001b[${code}m`, close: RESET });
const ansiTrue = (r: number, g: number, b: number, bg = false): Code =>
  ({ open: `\u001b[${bg ? 48 : 38};2;${r};${g};${b}m`, close: RESET });

const STYLES: Record<string, Code> = {
  red: ansi(31),
  green: ansi(32),
  yellow: ansi(33),
  blue: ansi(34),
  magenta: ansi(35),
  cyan: ansi(36),
  white: ansi(37),
  gray: ansi(90),
  black: ansi(30),
  bgRed: ansi(41),
  bgGreen: ansi(42),
  bgYellow: ansi(43),
  bgBlue: ansi(44),
  bold: ansi(1),
  dim: ansi(2),
  italic: ansi(3),
  underline: ansi(4),
};

function build(codes: Code[]): Styler {
  const fn = ((input: string): string => {
    if (!isColorEnabled() || codes.length === 0) return input;
    let opens = '';
    let closes = '';
    for (const c of codes) {
      opens += c.open;
      closes = c.close + closes;
    }
    return opens + input + closes;
  }) as Styler;

  for (const [name, code] of Object.entries(STYLES)) {
    Object.defineProperty(fn, name, {
      get() {
        return build([...codes, code]);
      },
      enumerable: false,
      configurable: true,
    });
  }
  fn.hex = (color: string): Styler => {
    const [r, g, b] = hexToRgb(color);
    return build([...codes, ansiTrue(r, g, b, false)]);
  };
  fn.bgHex = (color: string): Styler => {
    const [r, g, b] = hexToRgb(color);
    return build([...codes, ansiTrue(r, g, b, true)]);
  };
  return fn;
}

const chalk = build([]);

export type { Styler };
export default chalk;
