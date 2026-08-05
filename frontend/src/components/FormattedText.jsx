import React from 'react';

/**
 * Parses and formats markdown text into clean, styled React components.
 * Eliminates raw markdown syntax markers (**, ###, `, etc.) and renders neat typography.
 */
export default function FormattedText({ text, className = '' }) {
  if (!text) return null;

  const lines = text.split('\n');
  const elements = [];
  let inCodeBlock = false;
  let codeBuffer = [];
  let codeLang = '';

  lines.forEach((line, lineIndex) => {
    // Code block toggle (```)
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        // Close code block
        elements.push(
          <div key={`code-${lineIndex}`} className="my-2 rounded-lg bg-zinc-950 border border-zinc-800 p-3 font-mono text-xs text-emerald-400 overflow-x-auto">
            {codeLang && <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1 select-none">{codeLang}</div>}
            <pre className="whitespace-pre">{codeBuffer.join('\n')}</pre>
          </div>
        );
        codeBuffer = [];
        codeLang = '';
        inCodeBlock = false;
      } else {
        // Open code block
        inCodeBlock = true;
        codeLang = line.trim().replace(/^```/, '').trim();
      }
      return;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      return;
    }

    // Horizontal Rule (--- or ***)
    if (/^(---|\*\*\*|___)\s*$/.test(line.trim())) {
      elements.push(<hr key={`hr-${lineIndex}`} className="my-3 border-zinc-700/60" />);
      return;
    }

    // Headers (#, ##, ###)
    const headerMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const content = parseInlineMarkdown(headerMatch[2]);
      const headerClasses = {
        1: 'text-lg font-bold text-white mt-3 mb-1.5',
        2: 'text-base font-bold text-white mt-2.5 mb-1',
        3: 'text-sm font-semibold text-zinc-100 mt-2 mb-1',
        4: 'text-sm font-medium text-zinc-200 mt-1.5 mb-0.5',
      }[level] || 'text-sm font-semibold text-zinc-100 mt-2 mb-1';

      elements.push(
        <div key={`h-${lineIndex}`} className={headerClasses}>
          {content}
        </div>
      );
      return;
    }

    // Bullet List Items (- item or * item)
    const bulletMatch = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (bulletMatch) {
      const content = parseInlineMarkdown(bulletMatch[2]);
      elements.push(
        <div key={`li-${lineIndex}`} className="flex items-start gap-2 my-0.5 pl-1">
          <span className="text-cyan-400 font-bold select-none text-xs mt-0.5">•</span>
          <span className="flex-1">{content}</span>
        </div>
      );
      return;
    }

    // Numbered List Items (1. item)
    const numberMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (numberMatch) {
      const num = numberMatch[2];
      const content = parseInlineMarkdown(numberMatch[3]);
      elements.push(
        <div key={`num-${lineIndex}`} className="flex items-start gap-2 my-0.5 pl-1">
          <span className="text-cyan-400 font-semibold select-none text-xs mt-0.5">{num}.</span>
          <span className="flex-1">{content}</span>
        </div>
      );
      return;
    }

    // Empty lines
    if (!line.trim()) {
      elements.push(<div key={`blank-${lineIndex}`} className="h-2" />);
      return;
    }

    // Standard paragraph line
    const parsedLine = parseInlineMarkdown(line);
    elements.push(
      <p key={`p-${lineIndex}`} className="my-0.5 leading-relaxed">
        {parsedLine}
      </p>
    );
  });

  return <div className={`formatted-markdown text-sm text-zinc-100 space-y-0.5 ${className}`}>{elements}</div>;
}

/**
 * Parses inline formatting: **bold**, *italic*, `code`, and [links](url)
 */
function parseInlineMarkdown(text) {
  if (!text) return '';

  // Tokenize string for inline styles
  const regex = /(\*\*.*?\*\*|\*.*?\*|`.*?`|\[.*?\]\(.*?\))/g;
  const parts = text.split(regex);

  return parts.map((part, index) => {
    if (!part) return null;

    // Bold (**text**)
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={index} className="font-semibold text-white">
          {parseInlineMarkdown(part.slice(2, -2))}
        </strong>
      );
    }

    // Italic (*text*)
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <em key={index} className="italic text-zinc-200">
          {parseInlineMarkdown(part.slice(1, -1))}
        </em>
      );
    }

    // Inline Code (`code`)
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={index} className="px-1.5 py-0.5 mx-0.5 rounded bg-zinc-800/80 text-amber-300 font-mono text-[0.85em] border border-zinc-700/50">
          {part.slice(1, -1)}
        </code>
      );
    }

    // Links ([text](url))
    const linkMatch = part.match(/^\[(.*?)\]\((.*?)\)$/);
    if (linkMatch) {
      return (
        <a
          key={index}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 transition"
        >
          {linkMatch[1]}
        </a>
      );
    }

    return part;
  });
}
