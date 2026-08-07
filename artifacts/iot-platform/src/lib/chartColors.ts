/**
 * The platform's chart colours — one source of truth.
 *
 * Before this file, six pages each carried their own palette array (Analytics &
 * KPI, Data Explorer, Live Twin, Asset Management, the Ingest Simulator and the
 * dashboard builder), and every one of them opened with some mix of amber, red and
 * orange. Two consequences:
 *
 *   1. The same asset drew in a different colour on every page.
 *   2. Ordinary series were painted in alarm colours, so a chart of four metrics
 *      contained two lines that looked like warnings and meant nothing of the kind.
 *
 * Hence the split below: SERIES is for identity (which metric is this?), STATUS is
 * for state (is this bad?), and they never overlap.
 */

/**
 * Categorical series colours, assigned in fixed order — never cycled by rank, so
 * a filter that removes a series does not repaint the survivors.
 *
 * Validated with the OKLab/CVD checker against BOTH surfaces the app renders on
 * (#FFFFFF light card, #13161D dark card):
 *
 *   lightness band   all 8 inside the mode's band
 *   chroma floor     all 8 >= 0.10 (none reads as grey)
 *   CVD separation   worst adjacent pair ΔE 12.6 (deuteranopia)
 *   normal vision    worst adjacent pair ΔE 21.1
 *   contrast         all 8 >= 3:1 against the surface
 *
 * Do not add, reorder or eyeball a substitution here. Colours that look obviously
 * different can be near-identical to a colour-blind operator — a teal (#14B8A6)
 * next to this pink measured ΔE 3.7 under deuteranopia, and #DB2777 next to it
 * fails even for normal vision at ΔE 6.9. Re-run the validator instead:
 *
 *   node scripts/validate_palette.js "<hex,…>" --mode dark --surface "#13161D"
 *
 * Eight is the ceiling. A ninth series should become "Other", a small multiple, or
 * a second chart — not a ninth hue.
 */
// Deliberately `string[]` and not `as const`: several consumers pass this straight
// into props typed as a mutable string[] (e.g. ColorField's `presets`), and a
// readonly tuple cannot be assigned to those.
export const SERIES: string[] = [
  "#0891B2", // cyan
  "#8B5CF6", // violet
  "#65A30D", // lime
  "#EC4899", // pink
  "#2563EB", // blue
  "#0D9488", // teal
  "#C026D3", // fuchsia
  "#4D7C0F", // olive
];

/**
 * State colours. Reserved: never used to identify a series.
 *
 * These are intentionally the warm end of the spectrum, which is exactly why the
 * app's accent moved off orange — while the brand colour and the warning colour
 * were the same hue, a real alarm had no visual authority left.
 *
 * Always ship these with an icon or a text label too; colour alone is not a signal
 * a colour-blind operator can read.
 */
export const STATUS = {
  ok: "#22C55E",
  warning: "#F59E0B",
  critical: "#EF4444",
  neutral: "#64748B",
} as const;

/** Nth series colour, wrapping at the ceiling. */
export function seriesColor(index: number): string {
  return SERIES[index % SERIES.length];
}
