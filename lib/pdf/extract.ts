import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

export type ExtractResult = { text: string; input_tokens: number; output_tokens: number };

export async function extractResumeText(pdfBytes: Buffer): Promise<ExtractResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not configured');

  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
  const client = new Anthropic({
    apiKey: key,
    defaultHeaders: workspaceId ? { 'anthropic-workspace-id': workspaceId } : undefined,
  });
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBytes.toString('base64'),
            },
          },
          {
            type: 'text',
            text: 'Extract the plain text of this resume. Preserve section headings, bullet points, dates, and role titles. Return only the plaintext content, no commentary, no markdown fences.',
          },
        ],
      },
    ],
  });

  const first = response.content[0];
  if (!first || first.type !== 'text') {
    throw new Error('Unexpected response shape from Anthropic');
  }
  return {
    text: first.text.trim(),
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  };
}
