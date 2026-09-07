export type RolePackId = 'em' | 'sr_ic' | 'pm' | 'designer' | 'data_ml' | 'gtm';

export type RolePack = {
  id: RolePackId;
  label: string;
  description: string;
  include: RegExp[];
  exclude: RegExp[];
};

// Each pack: exclude-first (short-circuit noise), then include.
export const ROLE_PACKS: RolePack[] = [
  {
    id: 'em',
    label: 'Engineering Manager / Head of Eng',
    description: 'People-leader roles: EM, Sr EM, Director of Eng, Head of Eng, VP Eng.',
    include: [
      /engineering manager/i,
      /\bsenior em\b/i,
      /\bhead of .{0,40}?(engineering|applied ai|applied ml|platform|infrastructure|data|ml|ai)\b/i,
      /\bdirector[,\s]+(?:of\s+)?[a-z &\/\-—,]{0,40}engineering\b/i,
      /\bvp[,\s]+(?:of\s+)?[a-z &\/\-—,]{0,40}engineering\b/i,
      /\bmanager\b[^,]{0,5},\s*[a-z &\-—]{0,30}engineering\b/i,
      /\btech(?:nical)? lead manager\b/i,
    ],
    exclude: [
      /\bsales engineer/i,
      /\bfield engineering/i,
      /\bsolution(?:s)? engineering\b/i,
      /\btechnical services\b/i,
      /\bsupport engineering\b/i,
      /\bcustomer engineering\b/i,
      /\bcustomer success\b/i,
      /\bpresales?\b/i,
      /\btechnical program manager\b/i,
      /\bprogram manager\b/i,
      /\bproject manager\b/i,
      /\bTPM\b/,
      /\benterprise sales/i,
      /\bproduct manager\b/i,
      /\bmarketing\b/i,
      /\bmanufacturing/i,
      /\btest engineering/i,
      /\bquality engineering/i,
      /\bem[ci]\b/i,
      /\bsystems test\b/i,
      /\bhardware engineering/i,
      /\bhardware reliability engineering/i,
      /\bmechanical engineering/i,
      /\belectrical engineering/i,
      /\bpharmacy\b/i,
      /\brecruit/i,
      /\bsupplier/i,
      /\bindustrialization/i,
      /\blegal engineering/i,
      /\bpeople partners?/i,
      /\bpayroll/i,
      /\bfinance systems/i,
    ],
  },
  {
    id: 'sr_ic',
    label: 'Senior IC (Staff / Principal Engineer)',
    description: 'Senior hands-on engineering: Staff, Sr Staff, Principal, Distinguished.',
    include: [
      /\bstaff (software |systems )?engineer\b/i,
      /\bsenior staff engineer\b/i,
      /\bprincipal (software |systems )?engineer\b/i,
      /\bdistinguished engineer\b/i,
      /\bstaff engineer,/i,
      /\bstaff ml engineer\b/i,
    ],
    exclude: [
      /\bmanager\b/i,
      /\bdirector\b/i,
      /\bhead of\b/i,
      /\bvp\b/i,
      /\bsales engineer/i,
      /\bfield engineer/i,
      /\bsolutions? engineer/i,
      /\bcustomer engineer/i,
    ],
  },
  {
    id: 'pm',
    label: 'Product Manager',
    description: 'Product management: PM, Sr PM, GPM, Head/Director/VP of Product.',
    include: [
      /\b(senior |sr\.? |lead |staff |principal )?product manager\b/i,
      /\bgroup product manager\b/i,
      /\bhead of product\b/i,
      /\bdirector[,\s]+(?:of\s+)?product\b/i,
      /\bvp[,\s]+(?:of\s+)?product\b/i,
    ],
    exclude: [
      /\bprogram manager\b/i,
      /\btechnical program manager\b/i,
      /\bproject manager\b/i,
      /\bproduct marketing manager\b/i,
      /\bmarketing\b/i,
      /\bengineering manager\b/i,
      /\bTPM\b/,
    ],
  },
  {
    id: 'designer',
    label: 'Product Designer / Design Leader',
    description: 'Product design and design leadership.',
    include: [
      /\b(senior |sr\.? |lead |staff |principal )?product designer\b/i,
      /\b(senior |sr\.? |lead |staff |principal )?ux designer\b/i,
      /\bdesign manager\b/i,
      /\bhead of design\b/i,
      /\bdirector[,\s]+(?:of\s+)?design\b/i,
      /\bvp[,\s]+(?:of\s+)?design\b/i,
      /\bstaff designer\b/i,
      /\bprincipal designer\b/i,
    ],
    exclude: [
      /\bgraphic designer\b/i,
      /\bmarketing designer\b/i,
      /\bbrand designer\b/i,
      /\bdesign engineer\b/i,
      /\bmotion designer\b/i,
      /\bvisual designer\b/i,
    ],
  },
  {
    id: 'data_ml',
    label: 'Data / ML',
    description: 'Data science, ML engineering, applied science, data leadership.',
    include: [
      /\b(senior |sr\.? |lead |staff |principal )?data scientist\b/i,
      /\b(senior |sr\.? |lead |staff |principal )?(machine learning|ml) engineer\b/i,
      /\b(senior |sr\.? |lead |staff |principal )?applied scientist\b/i,
      /\bhead of data\b/i,
      /\bdirector[,\s]+(?:of\s+)?data\b/i,
      /\bvp[,\s]+(?:of\s+)?data\b/i,
      /\bml manager\b/i,
      /\bmanager,?\s*(?:data science|machine learning|ml)\b/i,
    ],
    exclude: [
      /\bdata analyst\b/i,
      /\bbi developer\b/i,
      /\bdata entry\b/i,
      /\bmarketing analytics\b/i,
      /\bbusiness analyst\b/i,
      /\bfinancial analyst\b/i,
    ],
  },
  {
    id: 'gtm',
    label: 'GTM Leadership (CS / Partnerships / Enterprise)',
    description: 'Customer success, strategic accounts, partnerships, enterprise sales leadership.',
    include: [
      /\bcustomer success manager\b/i,
      /\bCSM\b/,
      /\b(director|head|vp)[,\s]+(?:of\s+)?customer success\b/i,
      /\bstrategic account (manager|director|executive)\b/i,
      /\baccount director\b/i,
      /\b(head|director|vp)[,\s]+(?:of\s+)?(?:\w+\s+)?partnerships?\b/i,
      /\balliances director\b/i,
      /\b(director|head|vp)[,\s]+(?:of\s+)?alliances\b/i,
      /\bclient services (director|manager|lead)\b/i,
      /\b(director|head|vp)[,\s]+(?:of\s+)?client services\b/i,
      /\benterprise account executive.*(director|senior)\b/i,
      /\benterprise ae\b/i,
      /\b(head|director|vp)[,\s]+(?:of\s+)?enterprise\b/i,
    ],
    exclude: [
      /\bSDR\b/,
      /\bBDR\b/,
      /\bsales development representative\b/i,
      /\bsales associate\b/i,
      /\bcs analyst\b/i,
      /\bretention specialist\b/i,
      /\bsales engineer\b/i,
      /\bsolutions? engineer\b/i,
      /\bproduct marketing\b/i,
      /\brecruit/i,
    ],
  },
];

export function matchesPack(packId: RolePackId, title: string | null | undefined): boolean {
  if (!title) return false;
  const pack = ROLE_PACKS.find((p) => p.id === packId);
  if (!pack) return false;
  for (const re of pack.exclude) if (re.test(title)) return false;
  for (const re of pack.include) if (re.test(title)) return true;
  return false;
}

export function packsMatching(title: string | null | undefined): RolePackId[] {
  if (!title) return [];
  const out: RolePackId[] = [];
  for (const p of ROLE_PACKS) {
    if (matchesPack(p.id, title)) out.push(p.id);
  }
  return out;
}
