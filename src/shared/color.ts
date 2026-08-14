/**
 * Coerces any color string into the #rrggbb form input[type=color] requires.
 *
 * Also the defense-in-depth normalizer for color strings that cross a trust
 * boundary (board files on disk, settings payloads) before they are applied
 * to CSS — anything unrecognized collapses to a neutral gray.
 */
export function normalizeHex(v: string): string {
  const long = /^#([0-9a-f]{6})/i.exec(v.trim());
  if (long) return `#${long[1].toLowerCase()}`;
  const short = /^#([0-9a-f]{3})$/i.exec(v.trim());
  if (short) {
    const [r, g, b] = short[1];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return "#888888";
}
