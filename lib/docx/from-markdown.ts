import 'server-only';
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';

// Small line-oriented Markdown parser targeted at the exact shape our
// generation prompts produce:
//   # Heading 1 (name)
//   ## Heading 2 (section)
//   ### Heading 3 (company)
//   - bullet
//   plain paragraph text
//   **bold spans** inside any text
//
// Anything not matching a heading/bullet becomes a paragraph. Blank lines
// separate paragraphs. This keeps the code short (~80 lines) and predictable.

function parseInlineBold(text: string): TextRun[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((p) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return new TextRun({ text: p.slice(2, -2), bold: true });
    }
    return new TextRun({ text: p });
  });
}

function mkParagraph(text: string): Paragraph {
  return new Paragraph({ children: parseInlineBold(text), spacing: { after: 100 } });
}

function mkHeading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]): Paragraph {
  return new Paragraph({
    heading: level,
    children: parseInlineBold(text),
    spacing: { before: 200, after: 100 },
  });
}

function mkBullet(text: string): Paragraph {
  return new Paragraph({
    children: parseInlineBold(text),
    bullet: { level: 0 },
    spacing: { after: 60 },
  });
}

export function markdownToParagraphs(md: string): Paragraph[] {
  const lines = md.split(/\r?\n/);
  const out: Paragraph[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      // Blank line — insert an empty paragraph as a spacer between blocks.
      out.push(new Paragraph({ children: [], spacing: { after: 100 } }));
      continue;
    }
    if (line.startsWith('# ')) out.push(mkHeading(line.slice(2), HeadingLevel.HEADING_1));
    else if (line.startsWith('## ')) out.push(mkHeading(line.slice(3), HeadingLevel.HEADING_2));
    else if (line.startsWith('### ')) out.push(mkHeading(line.slice(4), HeadingLevel.HEADING_3));
    else if (line.startsWith('- ')) out.push(mkBullet(line.slice(2)));
    else out.push(mkParagraph(line));
  }
  return out;
}

export async function markdownToDocxBuffer(md: string): Promise<Buffer> {
  const doc = new Document({
    styles: {
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          run: { size: 32, bold: true },
          paragraph: { spacing: { after: 120 } },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          run: { size: 22, bold: true, allCaps: true, color: '4b5563' },
          paragraph: { spacing: { before: 240, after: 80 } },
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          run: { size: 22, bold: true },
          paragraph: { spacing: { before: 160, after: 40 } },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, right: 720, bottom: 720, left: 720 }, // 0.5in
          },
        },
        children: markdownToParagraphs(md),
      },
    ],
  });
  const nodeBuffer = await Packer.toBuffer(doc);
  return Buffer.from(nodeBuffer);
}
