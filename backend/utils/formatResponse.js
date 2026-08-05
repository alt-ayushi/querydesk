/**
 * Intelligent Response Formatter for QueryDesk AI Assistant.
 * Cleans raw LaTeX, excessive spacing, markdown dividers, and formats equations/solutions/lists
 * appropriately for Web, WhatsApp, and Telegram.
 */

export function sanitizeLaTeXAndMath(text) {
  if (!text) return '';

  let cleaned = String(text);

  // 1. Remove raw LaTeX block and inline delimiters: \[\], \(\), $$, $
  cleaned = cleaned.replace(/\\\[\s*/g, '\n');
  cleaned = cleaned.replace(/\s*\\\]/g, '\n');
  cleaned = cleaned.replace(/\\\(\s*/g, '');
  cleaned = cleaned.replace(/\s*\\\)/g, '');
  cleaned = cleaned.replace(/\$\$\s*/g, '\n');
  cleaned = cleaned.replace(/\s*\$\$/g, '\n');
  cleaned = cleaned.replace(/\$([^$\n]+)\$/g, '$1');

  // 2. Convert common LaTeX fractions: \frac{a}{b} -> a/b or \frac12 -> 1/2
  cleaned = cleaned.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '$1/$2');
  cleaned = cleaned.replace(/\\frac([0-9])([0-9])/g, '$1/$2');

  // 3. Convert explicit common LaTeX math commands to plain Unicode
  cleaned = cleaned.replace(/\\times\b/g, '×');
  cleaned = cleaned.replace(/\\cdot\b/g, '·');
  cleaned = cleaned.replace(/\\div\b/g, '÷');
  cleaned = cleaned.replace(/\\le\b|\\leq\b/g, '≤');
  cleaned = cleaned.replace(/\\ge\b|\\geq\b/g, '≥');
  cleaned = cleaned.replace(/\\ne\b|\\neq\b/g, '≠');
  cleaned = cleaned.replace(/\\pm\b/g, '±');
  cleaned = cleaned.replace(/\\sqrt\{([^{}]+)\}/g, '√($1)');
  cleaned = cleaned.replace(/\\sqrt\b/g, '√');
  cleaned = cleaned.replace(/\\approx\b/g, '≈');
  cleaned = cleaned.replace(/\\infty\b/g, '∞');
  cleaned = cleaned.replace(/\\degree\b/g, '°');

  // Convert formatting wrappers if present
  cleaned = cleaned.replace(/\\text\{([^{}]+)\}/g, '$1');
  cleaned = cleaned.replace(/\\mathbf\{([^{}]+)\}/g, '$1');
  cleaned = cleaned.replace(/\\mathrm\{([^{}]+)\}/g, '$1');
  cleaned = cleaned.replace(/\\left\(/g, '(');
  cleaned = cleaned.replace(/\\right\)/g, ')');
  cleaned = cleaned.replace(/\\left\[/g, '[');
  cleaned = cleaned.replace(/\\right\]/g, ']');

  // Clean remaining double-escaped operators while leaving unrecognized commands intact
  cleaned = cleaned.replace(/\\([+\-*=/()])/g, '$1');

  // 4. Convert option lists (A. , B. , C.) or dash bullets to clean •
  cleaned = cleaned.replace(/^[ \t]*[A-Z]\.[ \t]+/gm, '• ');
  cleaned = cleaned.replace(/^[ \t]*[\-\*][ \t]+/gm, '• ');

  // 5. Remove dividers & clean up spacing
  cleaned = cleaned.replace(/^[\s\*\-\=_]{3,}$/gm, '');
  cleaned = cleaned.replace(/^#*\s*Equations\s*$/gmi, '');
  cleaned = cleaned.replace(/^#{1,6}\s*/gm, '');

  cleaned = cleaned.replace(/[ \t]+/g, ' ');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  return cleaned.trim();
}

/**
 * Format AI response tailored for target channel.
 * @param {string} rawText - Raw AI output
 * @param {string} channel - 'web' | 'whatsapp' | 'telegram'
 * @returns {string} Formatted text
 */
export function formatAIResponse(rawText, channel = 'web') {
  if (!rawText) return '';

  let text = sanitizeLaTeXAndMath(rawText);

  if (channel === 'whatsapp') {
    // WhatsApp bolding strategy: limit bolding to major section headers only
    text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1');

    // Bold major structural headers only
    text = text.replace(/^(Solution|Given|Given:|Step \d+:?|Answer|Answer:?)$/gm, '*$1*');

    // Standardize bullets
    text = text.replace(/^[ \t]*[\-\*][ \t]+/gm, '• ');

    text = text.replace(/\n{3,}/g, '\n\n');
    return text.trim();
  }

  if (channel === 'telegram') {
    // Telegram formatting: safe bold headers, clean bullets
    text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1');

    text = text.replace(/^(Solution|Given|Given:|Step \d+:?|Answer|Answer:?)$/gm, '*$1*');
    text = text.replace(/^[ \t]*[\-\*][ \t]+/gm, '• ');

    // Safely remove any unescaped loose backslashes that might trigger Telegram syntax error
    text = text.replace(/\\/g, '');

    text = text.replace(/\n{3,}/g, '\n\n');
    return text.trim();
  }

  // Web Chat Formatting
  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '**$1**');
  text = text.replace(/^[ \t]*[\-\*][ \t]+/gm, '• ');
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}
