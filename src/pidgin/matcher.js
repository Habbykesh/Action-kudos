const { collapseRepeats } = require('./normalize');

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compiles a single dictionary entry (word or multi-word phrase) into a
 * word-boundary-safe regex. Word-boundary matching is what prevents "na"
 * from matching inside "banana" — the term only counts when it appears as
 * a standalone word/phrase, not as a substring.
 */
function compileTerm(term) {
  const original = term.toLowerCase().trim();
  if (!original) return null;

  let cleaned = original.replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim();
  cleaned = collapseRepeats(cleaned);
  if (!cleaned) return null;

  const escaped = escapeRegex(cleaned);
  const re = new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i');
  return { original, re };
}

/**
 * Builds a matcher for a flat list of pidgin words/phrases. Unlike a plain
 * boolean check, this returns which configured terms matched — needed for
 * offence logging — while still only ever producing one offence per
 * message (see pidginService.js, which dedupes by message ID regardless
 * of how many terms match).
 */
function buildOffenceMatcher(terms) {
  const compiled = terms.map(compileTerm).filter(Boolean);

  return function matchTerms(normalizedText) {
    if (!normalizedText) return [];
    const matched = [];
    for (const { original, re } of compiled) {
      if (re.test(normalizedText)) matched.push(original);
    }
    return matched;
  };
}

module.exports = { buildOffenceMatcher };
