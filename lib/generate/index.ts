import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

export type GenerationResult = { text: string; model: string; input_tokens: number; output_tokens: number };

const MODEL = 'claude-sonnet-4-6';

function client(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not configured');
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
  return new Anthropic({
    apiKey: key,
    defaultHeaders: workspaceId ? { 'anthropic-workspace-id': workspaceId } : undefined,
  });
}

function readTextBlock(response: Anthropic.Message): string {
  const first = response.content[0];
  if (!first || first.type !== 'text') throw new Error('unexpected block type');
  return first.text.trim();
}

// Positioning is a short "how I want to be positioned" statement stored on the
// profile alongside the resume. It's the narrative frame the resume proves out.
// When present, every generation and scoring call leads with it so that
// artifacts and rankings reflect the candidate's chosen angle rather than the
// generic center-of-gravity of the resume text.
function positioningBlock(positioning: string | null | undefined): string {
  if (!positioning?.trim()) return '';
  return `\n\nCANDIDATE POSITIONING (how they want to be seen — take this seriously; the resume is proof, this is the frame):\n${positioning.trim()}`;
}

export type JobContext = {
  title: string;
  company: string;
  location: string | null;
  description_text: string | null;
};

export type Profile = {
  resumeText: string;
  positioning: string | null;
};

export async function generateCoverLetter(
  job: JobContext,
  profile: Profile,
): Promise<GenerationResult> {
  const system = `You are helping a senior engineering manager draft a targeted cover letter for a specific job. Your voice is direct, specific, and confident without being braggy. No fluff, no cliches ("thrilled", "passionate", "team player"). Reference specific things in the job posting — the exact team, product surface, or challenge — and connect each to a specific thing the candidate has actually done per the resume. Do not invent experience the resume doesn't support. Structure: opening hook (why this role, this company), 2 middle paragraphs (each anchored to a specific job requirement matched to a specific resume moment), close (concrete next step). ~350-400 words.

Format as Markdown. Start with the candidate's name as a heading-1 (# Name) on line 1, then contact info line, then blank line, then the letter body as regular paragraphs. Use bold syntax (double-asterisks) sparingly to emphasize the 2-3 most important claims (specific numbers, company names, or technical terms that match the posting). No bullets in the body — flowing paragraphs.${positioningBlock(profile.positioning)}

CANDIDATE RESUME:
${profile.resumeText}`;

  const user = `Draft a cover letter for this posting.

COMPANY: ${job.company}
TITLE: ${job.title}
LOCATION: ${job.location ?? 'not specified'}

DESCRIPTION:
${job.description_text ?? '(description not available — use the title and company to infer scope, and note in the letter that you\'re inferring based on general knowledge of the company)'}`;

  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 1500,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return {
    text: readTextBlock(res),
    model: MODEL,
    input_tokens: res.usage.input_tokens,
    output_tokens: res.usage.output_tokens,
  };
}

export async function generateTailoredResume(
  job: JobContext,
  profile: Profile,
): Promise<GenerationResult> {
  const system = `You are tailoring a candidate's resume for a specific job posting. Rules:

1. NEVER invent experience, dates, titles, companies, metrics, or skills. Every claim must be verifiable from the original resume text.
2. You may REORDER bullets, PROMOTE some to lead position, DEMOTE or OMIT ones that are less relevant to this role.
3. You may LIGHTLY rewrite bullet wording to use vocabulary that mirrors the job posting AND the candidate's positioning statement (e.g. if positioning says "AI-augmented workflows" and resume says "process improvements", swap language — but only when the swap is truthful).
4. Preserve the original resume's structure (Summary → Experience → Education → Skills, or whatever order the original uses). If the original has a Summary, REWRITE it to reflect the positioning statement while keeping every factual claim verifiable from the rest of the resume.
5. Include the candidate's contact info verbatim from the original.
6. Output as Markdown formatted like a real resume:
   - Line 1: heading-1 with the candidate's name (# Name)
   - Line 2: contact info (email, phone, LinkedIn)
   - Section headings as heading-2 (## Summary, ## Experience, etc.)
   - Each role: heading-3 with company name, then a line with bold title and dates, then bullets prefixed with "- "
   - No code fences, no explanations, no meta-commentary
7. Aim for 1-page density — that means cutting ~30% of the original if it's long.${positioningBlock(profile.positioning)}

CANDIDATE'S ORIGINAL RESUME:
${profile.resumeText}`;

  const user = `Tailor the resume for this posting.

COMPANY: ${job.company}
TITLE: ${job.title}

DESCRIPTION:
${job.description_text ?? '(description not available — infer scope from title and company)'}`;

  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 2500,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return {
    text: readTextBlock(res),
    model: MODEL,
    input_tokens: res.usage.input_tokens,
    output_tokens: res.usage.output_tokens,
  };
}

export async function generateCompanySummary(name: string): Promise<GenerationResult> {
  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 500,
    system: `You write short factual company summaries. 2-3 sentences. Cover: what the company does, who it serves, notable scale/funding/stage if well-known. No marketing fluff. If you don't know the company, say "I don't have reliable information on this company." Plain text, no markdown, no title header.`,
    messages: [{ role: 'user', content: `Summarize the company "${name}" in 2-3 sentences.` }],
  });
  return {
    text: readTextBlock(res),
    model: MODEL,
    input_tokens: res.usage.input_tokens,
    output_tokens: res.usage.output_tokens,
  };
}
