// Layer 1 title filter — see docs/superpowers/specs/2026-09-02-phase-2-title-filter-design.md
//
// High recall, tolerable precision: catch every plausible EM/HoE/DoE/VP-Eng
// role in software/product/platform/infra domains. Phase 3 Claude scoring
// handles fine-grained judgment on domain fit and seniority.

const INCLUDE_PATTERNS: RegExp[] = [
  /engineering manager/i,
  /\bsenior em\b/i,
  // "Head of Engineering", "Head of Applied AI", etc. — bounded window to
  // avoid catching "Head of Recruiting, Engineering & IT"
  /\bhead of .{0,40}?(engineering|applied ai|applied ml|platform|infrastructure|data|ml|ai)\b/i,
  // "Director of Engineering", "Director of X Engineering", "Director, Engineering"
  // Slash allowed in filler for "AI/ML Engineering", "DevOps/Platform Engineering"
  /\bdirector[,\s]+(?:of\s+)?[a-z &\/\-—,]{0,40}engineering\b/i,
  // "VP, Engineering", "VP of Engineering" — cap matches Director's 40 so multi-word
  // subdomains like "VP of Platform and Infrastructure Engineering" survive
  /\bvp[,\s]+(?:of\s+)?[a-z &\/\-—,]{0,40}engineering\b/i,
  // "Manager, Platform Engineering" (comma-flipped) — allow level suffix like
  // "Manager I,", "Manager II,", etc. (Datadog naming convention)
  /\bmanager\b[^,]{0,5},\s*[a-z &\-—]{0,30}engineering\b/i,
  // "Technical Lead Manager" / "Tech Lead Manager" (Uber/Google/OpenAI TLM convention)
  /\btech(?:nical)? lead manager\b/i,
];

const EXCLUDE_PATTERNS: RegExp[] = [
  /\bsales engineer/i,
  /\bfield engineering/i,
  /\bsolution(?:s)? engineering\b/i, // pre-sales at B2B SaaS (Snowflake, MongoDB)
  /\btechnical services\b/i,          // customer support / TAM leadership
  /\bsupport engineering\b/i,
  /\benterprise sales/i,
  /\bproduct manager\b/i,           // spec §5
  /\bmarketing\b/i,                 // spec §5
  /\bmanufacturing/i,               // Anduril
  /\btest engineering/i,            // Anduril
  /\bquality engineering/i,
  /\bem[ci]\b/i,                    // EMI/EMC test roles
  /\bsystems test\b/i,
  /\bhardware engineering/i,
  /\bhardware reliability engineering/i,   // Anduril: hardware discipline, not software EM
  /\bmechanical engineering/i,
  /\belectrical engineering/i,
  /\bpharmacy\b/i,
  /\brecruit/i,                     // "Director of Recruiting, Engineering & IT"
  /\bsupplier/i,
  /\bindustrialization/i,
  /\blegal engineering/i,
  /\bpeople partners?/i,
  /\bpayroll/i,
  /\bfinance systems/i,
];

export function matchesEmRole(title: string | null | undefined): boolean {
  if (!title) return false;
  for (const re of EXCLUDE_PATTERNS) if (re.test(title)) return false;
  for (const re of INCLUDE_PATTERNS) if (re.test(title)) return true;
  return false;
}
