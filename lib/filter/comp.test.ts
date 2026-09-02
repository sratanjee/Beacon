import { describe, it, expect } from 'vitest';
import { parseComp } from './comp';

describe('parseComp', () => {
  it('returns null/null for empty', () => {
    expect(parseComp('')).toEqual({ comp_min: null, comp_max: null });
    expect(parseComp(null as unknown as string)).toEqual({ comp_min: null, comp_max: null });
  });

  it('returns null/null when no comp info', () => {
    expect(parseComp('We are hiring an engineer to help build the future.')).toEqual({
      comp_min: null,
      comp_max: null,
    });
  });

  it('parses Greenhouse structured pay-range HTML', () => {
    const html =
      '<div class="pay-range"><span>$230,000</span><span class="divider">&mdash;</span><span>$322,000 USD</span></div>';
    expect(parseComp(html)).toEqual({ comp_min: 230000, comp_max: 322000 });
  });

  it('parses Lever prose salary range', () => {
    const text =
      'The estimated salary range for this position is estimated to be $135,000 - $200,000/year.';
    expect(parseComp(text)).toEqual({ comp_min: 135000, comp_max: 200000 });
  });

  it('parses K-suffix format', () => {
    expect(parseComp('Base pay: $180K - $250K + equity')).toEqual({
      comp_min: 180000,
      comp_max: 250000,
    });
  });

  it('parses mixed K and full', () => {
    expect(parseComp('Base salary between $180,000 and $250K')).toEqual({
      comp_min: 180000,
      comp_max: 250000,
    });
  });

  it('parses em-dash range', () => {
    expect(parseComp('Salary range: $200,000 — $300,000')).toEqual({
      comp_min: 200000,
      comp_max: 300000,
    });
  });

  it('parses "to" range', () => {
    expect(parseComp('The base pay range for this role is $180,000 to $260,000 USD.')).toEqual({
      comp_min: 180000,
      comp_max: 260000,
    });
  });

  it('ignores hourly rates', () => {
    expect(parseComp('$85/hour to $120/hour')).toEqual({ comp_min: null, comp_max: null });
    expect(parseComp('$85 per hour to $120 per hour')).toEqual({ comp_min: null, comp_max: null });
  });

  it('ignores figures below annual-salary sanity threshold', () => {
    // $500 credit, $1,000 signing bonus, etc. shouldn't be parsed as salary
    expect(parseComp('We offer a $500 wellness credit and $1,000 signing bonus.')).toEqual({
      comp_min: null,
      comp_max: null,
    });
  });

  it('ignores unrealistically large figures', () => {
    expect(parseComp('Company valued at $50 billion. Salary details in offer.')).toEqual({
      comp_min: null,
      comp_max: null,
    });
  });

  it('prefers range near salary trigger word', () => {
    // $500 wellness credit first, then real salary range — should pick the range
    const text =
      'We offer $500 wellness credit and a $1,000 signing bonus. The base salary range for this role is $180,000 - $260,000.';
    expect(parseComp(text)).toEqual({ comp_min: 180000, comp_max: 260000 });
  });

  it('handles Greenhouse HTML with entities and whitespace', () => {
    const html = `
      <div class="pay-range">
        <span>$230,000</span>
        <span class="divider">&mdash;</span>
        <span>$322,000 USD</span>
      </div>
    `;
    expect(parseComp(html)).toEqual({ comp_min: 230000, comp_max: 322000 });
  });

  it('handles single-figure (min only)', () => {
    // Some postings just publish a starting point
    expect(parseComp('Starting salary: $180,000. Equity and bonus additional.')).toEqual({
      comp_min: 180000,
      comp_max: null,
    });
  });

  it('normalizes min <= max even if listed reversed', () => {
    expect(parseComp('Salary range: $322,000 - $230,000')).toEqual({
      comp_min: 230000,
      comp_max: 322000,
    });
  });

  // Regression: jobs.comp_min/max are INTEGER; decimals broke upserts on
  // Airbnb/Pinterest/Block/Fastly/MongoDB/Oscar Health (run_id 7, 2026-09-02).
  it('rounds decimal values to integers', () => {
    const { comp_min, comp_max } = parseComp(
      'The base salary range is $191,666.67 to $239,121.50 USD.',
    );
    expect(comp_min).toBe(191667);
    expect(comp_max).toBe(239122);
    expect(Number.isInteger(comp_min)).toBe(true);
    expect(Number.isInteger(comp_max)).toBe(true);
  });
});
