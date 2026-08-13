/**
 * Intelligent Response Formatter for QueryDesk AI Assistant.
 * Cleans raw LaTeX, excessive spacing, markdown dividers, and formats equations/solutions/lists
 * appropriately for Web, WhatsApp, and Telegram.
 */

export function sanitizeLaTeXAndMath(text) {
  if (!text) return '';

  let cleaned = String(text);

  // 1. Convert common LaTeX fractions: \frac{a}{b} -> (a/b)
  cleaned = cleaned.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '$1/$2');
  cleaned = cleaned.replace(/\\frac([0-9])([0-9])/g, '$1/$2');

  // 2. Convert common exponents & superscripts (e.g. x^2 -> x², x^3 -> x³)
  cleaned = cleaned.replace(/\^2\b/g, '²');
  cleaned = cleaned.replace(/\^3\b/g, '³');
  cleaned = cleaned.replace(/\^n\b/g, 'ⁿ');

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

  // Remove LaTeX delimiters for plain text outputs: \[\], \(\), $$, $
  cleaned = cleaned.replace(/\\\[\s*/g, '');
  cleaned = cleaned.replace(/\s*\\\]/g, '');
  cleaned = cleaned.replace(/\\\(\s*/g, '');
  cleaned = cleaned.replace(/\s*\\\)/g, '');
  cleaned = cleaned.replace(/\$\$\s*/g, '');
  cleaned = cleaned.replace(/\s*\$\$/g, '');
  cleaned = cleaned.replace(/\$([^$\n]+)\$/g, '$1');

  // Clean remaining double-escaped operators
  cleaned = cleaned.replace(/\\([+\-*=/()])/g, '$1');

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

  if (channel === 'web') {
    // Web Chat: Keep LaTeX delimiters and Markdown structures intact for React FormattedText rendering
    let text = String(rawText);
    // Normalize \( ... \) -> $ ... $ and \[ ... \] -> $$ ... $$
    text = text.replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, '\n$$\n$1\n$$\n');
    text = text.replace(/\\\(\s*([\s\S]*?)\s*\\\)/g, '$$1$');
    text = text.replace(/\n{3,}/g, '\n\n');
    return text.trim();
  }

  let text = sanitizeLaTeXAndMath(rawText);

  if (channel === 'whatsapp') {
    // WhatsApp formatting: bold major headers, bullet points
    text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '*$1*');
    text = text.replace(/\*\*([^*]+)\*\*/g, '*$1*');

    // Standardize bullets
    text = text.replace(/^[ \t]*[\-\*][ \t]+/gm, '• ');

    text = text.replace(/\n{3,}/g, '\n\n');
    return text.trim();
  }

  if (channel === 'telegram') {
    // Telegram formatting: safe bold headers, clean bullets
    text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '*$1*');
    text = text.replace(/\*\*([^*]+)\*\*/g, '*$1*');
    text = text.replace(/^[ \t]*[\-\*][ \t]+/gm, '• ');

    text = text.replace(/\n{3,}/g, '\n\n');
    return text.trim();
  }

  return text.trim();
}
