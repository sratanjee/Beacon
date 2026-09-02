import { describe, it, expect } from 'vitest';
import { matchesEmRole } from './title';

// Titles pulled from the live DB on 2026-09-02 via
// `select distinct title from jobs where is_active and title ~* '(manager|head|director|vp)' limit 100`
// Split into what we WANT to surface for Sarang's EM search vs what we don't.
const INCLUDES = [
  'Engineering Manager',
  'Engineering Manager, Consumer Product',
  'Senior Software Engineering Manager, Simulation Platforms',
  'Machine Learning Engineering Manager',
  'Director of Engineering',
  'Director of Engineering, AI Platform',
  'Director of Engineering, Rocket Motor Systems',
  'Director of Security Engineering',
  'Director, Engineering, Enterprise',
  'Director, Engineering - Cloud Observability',
  'Head of Engineering',
  'Head of Applied AI',
  'VP, Engineering',
  'VP of Engineering',
  'VP of Platform and Infrastructure Engineering',
  'Director of AI/ML Engineering',
  'Manager, Platform Engineering',
  'Manager, Software Engineering',
  'Manager I, Engineering - Core Analytics',
  'Technical Lead Manager - Training Runtime, Data Movement',
  'Senior EM, Growth',
  'Director of Site Reliability Engineering',
];

const EXCLUDES = [
  'Manufacturing Engineering Manager, Roadrunner',
  'Test Engineering Manager',
  'Quality Engineering Manager',
  'Director, Enterprise Sales Engineering - US Central',
  'Director, Field Engineering (CPG & Retail)',
  'Director of Recruiting, Engineering & IT, Bangalore India',
  'Director of Supplier Industrialization Engineering',
  'Director, People Partners - Product, Design & Engineering',
  'Director, Legal Engineering, EMEA',
  'Director, Manufacturing Engineering',
  'Senior EMC Design Engineer, Air Dominance and Strike',
  'Product Manager, Growth',
  'Marketing Manager',
  'Account Executive - GTM Overlay',
  'Compounding Pharmacy Technician',
  'Director, Hardware Reliability Engineering',
  'Manager, Solution Engineering',
  'Manager, Technical Services Engineering (Support)',
];

describe('matchesEmRole', () => {
  it('returns false for empty', () => {
    expect(matchesEmRole('')).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(matchesEmRole(null as unknown as string)).toBe(false);
    expect(matchesEmRole(undefined as unknown as string)).toBe(false);
  });

  for (const title of INCLUDES) {
    it(`includes: ${title}`, () => {
      expect(matchesEmRole(title)).toBe(true);
    });
  }

  for (const title of EXCLUDES) {
    it(`excludes: ${title}`, () => {
      expect(matchesEmRole(title)).toBe(false);
    });
  }
});
