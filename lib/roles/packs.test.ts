import { describe, it, expect } from 'vitest';
import { ROLE_PACKS, matchesPack, packsMatching } from './packs';

describe('ROLE_PACKS metadata', () => {
  it('has the six expected packs', () => {
    const ids = ROLE_PACKS.map((p) => p.id).sort();
    expect(ids).toEqual(['data_ml', 'designer', 'em', 'gtm', 'pm', 'sr_ic']);
  });

  it('every pack has a label and description', () => {
    for (const p of ROLE_PACKS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
    }
  });
});

describe('matchesPack — em', () => {
  const positives = [
    'Engineering Manager',
    'Senior Engineering Manager, Platform',
    'Director of Engineering',
    'Head of Engineering',
    'VP, Engineering',
    'Manager, Software Engineering',
  ];
  const negatives = [
    'Software Engineer',
    'Staff Engineer',
    'Product Manager',
    'Sales Manager',
    'Manufacturing Engineering Manager',
    'Technical Program Manager',
  ];
  for (const t of positives) it(`+ ${t}`, () => expect(matchesPack('em', t)).toBe(true));
  for (const t of negatives) it(`- ${t}`, () => expect(matchesPack('em', t)).toBe(false));
});

describe('matchesPack — sr_ic', () => {
  const positives = [
    'Staff Software Engineer',
    'Principal Engineer',
    'Senior Staff Engineer, Platform',
    'Distinguished Engineer',
    'Staff Engineer, ML',
  ];
  const negatives = [
    'Software Engineer',
    'Engineering Manager',
    'Sales Engineer',
    'Solutions Engineer',
    'Field Engineer',
  ];
  for (const t of positives) it(`+ ${t}`, () => expect(matchesPack('sr_ic', t)).toBe(true));
  for (const t of negatives) it(`- ${t}`, () => expect(matchesPack('sr_ic', t)).toBe(false));
});

describe('matchesPack — pm', () => {
  const positives = [
    'Product Manager',
    'Senior Product Manager, Growth',
    'Group Product Manager',
    'Head of Product',
    'Director of Product',
    'VP Product',
  ];
  const negatives = [
    'Program Manager',
    'Technical Program Manager',
    'Project Manager',
    'Engineering Manager',
    'Marketing Manager',
    'Product Marketing Manager',
  ];
  for (const t of positives) it(`+ ${t}`, () => expect(matchesPack('pm', t)).toBe(true));
  for (const t of negatives) it(`- ${t}`, () => expect(matchesPack('pm', t)).toBe(false));
});

describe('matchesPack — designer', () => {
  const positives = [
    'Product Designer',
    'Senior Product Designer',
    'Staff Product Designer',
    'Design Manager',
    'Head of Design',
    'UX Designer',
  ];
  const negatives = [
    'Graphic Designer',
    'Marketing Designer',
    'Brand Designer',
    'Design Engineer',
    'Motion Designer',
  ];
  for (const t of positives) it(`+ ${t}`, () => expect(matchesPack('designer', t)).toBe(true));
  for (const t of negatives) it(`- ${t}`, () => expect(matchesPack('designer', t)).toBe(false));
});

describe('matchesPack — data_ml', () => {
  const positives = [
    'Data Scientist',
    'Senior Data Scientist',
    'Machine Learning Engineer',
    'ML Engineer, Platform',
    'Applied Scientist',
    'Head of Data',
    'Director of Data Science',
  ];
  const negatives = [
    'Data Analyst',
    'BI Developer',
    'Data Entry Specialist',
    'Marketing Analytics Manager',
    'Business Analyst',
  ];
  for (const t of positives) it(`+ ${t}`, () => expect(matchesPack('data_ml', t)).toBe(true));
  for (const t of negatives) it(`- ${t}`, () => expect(matchesPack('data_ml', t)).toBe(false));
});

describe('matchesPack — gtm', () => {
  const positives = [
    'Customer Success Manager',
    'Director of Customer Success',
    'VP Customer Success',
    'Strategic Account Manager',
    'Account Director',
    'Head of Partnerships',
    'Director, Strategic Partnerships',
    'VP Partnerships',
    'Client Services Director',
    'Enterprise Account Executive, Director',
  ];
  const negatives = [
    'SDR',
    'BDR',
    'Sales Development Representative',
    'CS Analyst',
    'Retention Specialist',
    'Sales Engineer',
    'Solutions Engineer',
    'Marketing Manager',
  ];
  for (const t of positives) it(`+ ${t}`, () => expect(matchesPack('gtm', t)).toBe(true));
  for (const t of negatives) it(`- ${t}`, () => expect(matchesPack('gtm', t)).toBe(false));
});

describe('packsMatching', () => {
  it('returns all packs that match a title', () => {
    expect(packsMatching('Engineering Manager, ML')).toContain('em');
  });
  it('empty for unrelated title', () => {
    expect(packsMatching('Barista')).toEqual([]);
  });
});
