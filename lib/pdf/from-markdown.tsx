import 'server-only';
import React from 'react';
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
  pdf,
} from '@react-pdf/renderer';

// PDF renderer for cover letters + tailored resumes.
//
// Shares the Markdown shape produced by lib/generate/index.ts:
//   # Name
//   contact line
//   ## Section
//   ### Company
//   **bold spans**
//   - bullet
//   paragraph
//
// Ships alongside the DOCX renderer (lib/docx/from-markdown.ts) — DOCX stays
// the ATS-friendly path, PDF is the human-facing artifact.
//
// Uses built-in Helvetica (no network font fetch, safe in Vercel Lambda).

// ─── Parser ────────────────────────────────────────────────────────────
type Block =
  | { kind: 'name'; text: string }
  | { kind: 'contact'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'h3'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'blank' };

function parseMarkdown(md: string): Block[] {
  const lines = md.split(/\r?\n/);
  const out: Block[] = [];
  let seenName = false;
  let seenContact = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      out.push({ kind: 'blank' });
      continue;
    }
    if (line.startsWith('# ')) {
      out.push({ kind: 'name', text: line.slice(2) });
      seenName = true;
      continue;
    }
    if (seenName && !seenContact && !line.startsWith('#') && !line.startsWith('-')) {
      out.push({ kind: 'contact', text: line });
      seenContact = true;
      continue;
    }
    if (line.startsWith('## ')) {
      out.push({ kind: 'h2', text: line.slice(3) });
      continue;
    }
    if (line.startsWith('### ')) {
      out.push({ kind: 'h3', text: line.slice(4) });
      continue;
    }
    if (line.startsWith('- ')) {
      out.push({ kind: 'bullet', text: line.slice(2) });
      continue;
    }
    out.push({ kind: 'para', text: line });
  }
  return out;
}

// Splits a line on **bold** spans and returns Text children with proper weight.
// Inherits size/color/family from the parent Text; only overrides fontWeight.
function renderInline(text: string, key: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**')) {
          return (
            <Text key={`${key}-${i}`} style={{ fontWeight: 700 }}>
              {p.slice(2, -2)}
            </Text>
          );
        }
        return <Text key={`${key}-${i}`}>{p}</Text>;
      })}
    </>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 40,
    paddingLeft: 48,
    paddingRight: 48,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: '#1a1a1a',
    lineHeight: 1.4,
  },
  name: {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  contact: {
    fontSize: 9,
    color: '#5b5b5b',
    marginBottom: 12,
  },
  rule: {
    borderBottomWidth: 0.75,
    borderBottomColor: '#c8c4bc',
    marginBottom: 12,
  },
  h2: {
    fontSize: 9.5,
    fontWeight: 700,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: '#333',
    marginTop: 14,
    marginBottom: 6,
    paddingBottom: 2,
    borderBottomWidth: 0.5,
    borderBottomColor: '#d9d5cc',
  },
  h3: {
    fontSize: 11,
    fontWeight: 700,
    color: '#1a1a1a',
    marginTop: 10,
    marginBottom: 2,
  },
  para: {
    marginBottom: 6,
    lineHeight: 1.45,
  },
  bulletRow: {
    flexDirection: 'row',
    marginBottom: 3,
    paddingLeft: 4,
  },
  bulletMark: {
    width: 10,
    fontSize: 10,
    color: '#5b5b5b',
  },
  bulletText: {
    flex: 1,
    lineHeight: 1.4,
  },
  blank: {
    height: 4,
  },
  // Cover letter overrides — a bit more breathing room and no bullets expected
  clPage: {
    paddingTop: 48,
    paddingBottom: 48,
    paddingLeft: 56,
    paddingRight: 56,
    fontFamily: 'Helvetica',
    fontSize: 10.5,
    color: '#1a1a1a',
    lineHeight: 1.55,
  },
  clPara: {
    marginBottom: 10,
    lineHeight: 1.55,
    textAlign: 'justify',
  },
});

// ─── Document component ────────────────────────────────────────────────
function renderBlock(b: Block, i: number, kind: 'resume' | 'cover_letter'): React.ReactNode {
  const key = `b-${i}`;
  switch (b.kind) {
    case 'name':
      return (
        <Text key={key} style={styles.name}>
          {b.text}
        </Text>
      );
    case 'contact':
      return (
        <View key={key}>
          <Text style={styles.contact}>{b.text}</Text>
          <View style={styles.rule} />
        </View>
      );
    case 'h2':
      return (
        <Text key={key} style={styles.h2}>
          {b.text}
        </Text>
      );
    case 'h3':
      return (
        <Text key={key} style={styles.h3}>
          {renderInline(b.text, key)}
        </Text>
      );
    case 'bullet':
      return (
        <View key={key} style={styles.bulletRow} wrap={false}>
          <Text style={styles.bulletMark}>•</Text>
          <Text style={styles.bulletText}>{renderInline(b.text, key)}</Text>
        </View>
      );
    case 'para':
      return (
        <Text key={key} style={kind === 'cover_letter' ? styles.clPara : styles.para}>
          {renderInline(b.text, key)}
        </Text>
      );
    case 'blank':
      return <View key={key} style={styles.blank} />;
  }
}

function ResumeDoc({ blocks }: { blocks: Block[] }): React.ReactElement {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {blocks.map((b, i) => renderBlock(b, i, 'resume'))}
      </Page>
    </Document>
  );
}

function CoverLetterDoc({ blocks }: { blocks: Block[] }): React.ReactElement {
  return (
    <Document>
      <Page size="LETTER" style={styles.clPage}>
        {blocks.map((b, i) => renderBlock(b, i, 'cover_letter'))}
      </Page>
    </Document>
  );
}

// ─── Public API ────────────────────────────────────────────────────────
export type PdfKind = 'tailored_resume' | 'cover_letter';

export async function markdownToPdfBuffer(md: string, kind: PdfKind): Promise<Buffer> {
  const blocks = parseMarkdown(md);
  const doc =
    kind === 'cover_letter' ? <CoverLetterDoc blocks={blocks} /> : <ResumeDoc blocks={blocks} />;
  const nodeBuffer = await pdf(doc).toBuffer();
  // React-PDF returns a Node stream in some versions; toBuffer() gives us a Buffer/Uint8Array.
  // Normalize to Buffer for the Next.js response.
  return Buffer.isBuffer(nodeBuffer) ? nodeBuffer : Buffer.from(nodeBuffer as unknown as ArrayBuffer);
}

// Font registration hook — expand later if we want to swap Helvetica for Inter.
// Kept as an empty exported function so callers can call it once at boot without
// crashing if we haven't wired real font files yet.
export function registerFonts(): void {
  // Intentionally no-op today. To add Inter or a custom face:
  //   Font.register({ family: 'Inter', src: '/path/or/url' });
  void Font; // silence unused warning
}
