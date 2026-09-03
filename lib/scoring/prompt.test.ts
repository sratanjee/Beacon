import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildUserPrompt } from './prompt';

describe('buildSystemPrompt', () => {
  it('includes the resume text verbatim', () => {
    const p = buildSystemPrompt('SUMMARY\n10 years EM at Google...');
    expect(p).toContain('SUMMARY');
    expect(p).toContain('10 years EM at Google');
  });

  it('states the response format constraint', () => {
    const p = buildSystemPrompt('r');
    expect(p.toLowerCase()).toContain('json');
  });

  it('includes positioning statement when provided', () => {
    const p = buildSystemPrompt('resume', 'Growth EM with AI focus');
    expect(p).toContain('POSITIONING');
    expect(p).toContain('Growth EM with AI focus');
  });

  it('omits positioning block when not provided or empty', () => {
    expect(buildSystemPrompt('r')).not.toContain('POSITIONING');
    expect(buildSystemPrompt('r', '')).not.toContain('POSITIONING');
    expect(buildSystemPrompt('r', '   ')).not.toContain('POSITIONING');
  });
});

describe('buildUserPrompt', () => {
  it('includes title, company, location, description', () => {
    const p = buildUserPrompt({
      title: 'Engineering Manager, AI Platform',
      company: 'Anthropic',
      location: 'San Francisco, CA; Remote',
      description_text: 'Build the AI platform team. $250K-$400K comp.',
    });
    expect(p).toContain('Engineering Manager, AI Platform');
    expect(p).toContain('Anthropic');
    expect(p).toContain('San Francisco');
    expect(p).toContain('AI platform team');
  });

  it('handles null location + description', () => {
    const p = buildUserPrompt({
      title: 'Head of Eng',
      company: 'Foo',
      location: null,
      description_text: null,
    });
    expect(p).toContain('Head of Eng');
    expect(p).toContain('Foo');
    expect(p).not.toContain('null');
    expect(p).not.toContain('undefined');
  });

  it('requests structured JSON with the four fields', () => {
    const p = buildUserPrompt({
      title: 't',
      company: 'c',
      location: null,
      description_text: null,
    });
    expect(p).toContain('domain_proximity');
    expect(p).toContain('seniority_match');
    expect(p).toContain('comp_signal');
    expect(p).toContain('overall_score');
    expect(p).toContain('rationale');
  });
});
