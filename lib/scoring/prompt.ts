export function buildSystemPrompt(resumeText: string): string {
  return `You are a career-fit evaluator. You'll receive job postings and score each one against the candidate's resume on a 0-100 scale across three dimensions, then produce a composite overall score.

Weight the composite score heavily on domain_proximity (does the role's actual work match what this person has done and is good at?), then seniority_match, then comp_signal.

Return JSON only, no markdown fences, no commentary.

CANDIDATE RESUME:
${resumeText}`;
}

export function buildUserPrompt(job: {
  title: string;
  company: string;
  location: string | null;
  description_text: string | null;
}): string {
  const location = job.location ?? 'not specified';
  const description = job.description_text ?? 'not provided';
  return `Score this posting.

TITLE: ${job.title}
COMPANY: ${job.company}
LOCATION: ${location}
DESCRIPTION:
${description}

Return JSON only in this exact shape:
{
  "domain_proximity": 0-100,
  "seniority_match": 0-100,
  "comp_signal": "above_current" | "below_current" | "comparable" | "undisclosed",
  "overall_score": 0-100,
  "rationale": "one-sentence explanation"
}`;
}
