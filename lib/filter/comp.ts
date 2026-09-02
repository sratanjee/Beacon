// Comp band parser — extracts min/max annual salary in USD from job description
// text or HTML. Handles Greenhouse structured markup, Lever prose, and Ashby's
// varied formats. Returns (null, null) when nothing can be confidently parsed —
// silence beats guessing.
//
// Approach:
//   1. Strip HTML tags, decode common entities.
//   2. Extract every $-amount with position; normalize K/M suffix.
//   3. Reject figures outside annual-salary sanity band ($50k-$2M).
//   4. Reject figures followed by /hour, /mo, etc. or preceded by
//      bonus/credit/signing-context.
//   5. Prefer pairs of surviving figures that appear close together and near
//      a salary/compensation trigger word.

type Figure = { value: number; index: number };

const NUM_RE = /\$\s*([\d,]+(?:\.\d+)?)\s*([KkMm]?)\b/g;
const BAD_SUFFIX_RE = /^[\s/]*(?:\/|per\s+)(?:h(?:ou)?r|hourly|day|week|wk|mo(?:nth)?|m)\b/i;
const BAD_PREFIX_RE =
  /\b(?:bonus|credit|stipend|reimbursement|referral|reward|allowance|sign(?:-|\s*)on|signing|per\s+diem)\b[^.]{0,40}$/i;
const TRIGGER_RE = /\b(?:salary|compensation|pay range|base pay|\bcomp\b)/i;

const MIN_SALARY = 50_000;
const MAX_SALARY = 2_000_000;

export type CompRange = { comp_min: number | null; comp_max: number | null };

export function parseComp(input: string | null | undefined): CompRange {
  const empty: CompRange = { comp_min: null, comp_max: null };
  if (!input) return empty;

  const text = input
    .replace(/&mdash;|&#8212;/g, '—')
    .replace(/&ndash;|&#8211;/g, '–')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

  const figures: Figure[] = [];
  let m: RegExpExecArray | null;
  NUM_RE.lastIndex = 0;
  while ((m = NUM_RE.exec(text))) {
    const raw = parseFloat(m[1].replace(/,/g, ''));
    if (Number.isNaN(raw)) continue;
    const suffix = m[2];
    let value = raw;
    if (suffix === 'K' || suffix === 'k') value *= 1_000;
    else if (suffix === 'M' || suffix === 'm') value *= 1_000_000;

    if (value < MIN_SALARY || value > MAX_SALARY) continue;

    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 30);
    if (BAD_SUFFIX_RE.test(after)) continue;

    const before = text.slice(Math.max(0, m.index - 60), m.index);
    if (BAD_PREFIX_RE.test(before)) continue;

    figures.push({ value: Math.round(value), index: m.index });
  }

  if (figures.length === 0) return empty;

  const trigMatch = text.match(TRIGGER_RE);
  const trigPos = trigMatch?.index ?? -1;

  // Rank pairs: proximity to trigger dominates, then compactness of the pair.
  const pairs: { a: Figure; b: Figure; score: number }[] = [];
  for (let i = 0; i < figures.length; i++) {
    for (let j = i + 1; j < figures.length; j++) {
      const a = figures[i];
      const b = figures[j];
      if (b.index - a.index > 200) continue;
      const trigDist =
        trigPos < 0 ? 500 : Math.min(Math.abs(a.index - trigPos), Math.abs(b.index - trigPos));
      const score = trigDist + (b.index - a.index) * 0.1;
      pairs.push({ a, b, score });
    }
  }

  if (pairs.length > 0) {
    pairs.sort((x, y) => x.score - y.score);
    const best = pairs[0];
    const [lo, hi] =
      best.a.value <= best.b.value ? [best.a.value, best.b.value] : [best.b.value, best.a.value];
    return { comp_min: lo, comp_max: hi };
  }

  // Single figure — return it as min if it's near a trigger.
  if (trigPos >= 0) {
    const closest = figures
      .map((f) => ({ f, d: Math.abs(f.index - trigPos) }))
      .sort((x, y) => x.d - y.d)[0];
    if (closest.d < 200) {
      return { comp_min: closest.f.value, comp_max: null };
    }
  }

  return empty;
}
