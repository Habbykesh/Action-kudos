// Normalizes a raw Discord message into a form suitable for phrase matching,
// and builds/matches phrase regexes. Deliberately not AI-based: a plain,
// predictable, curated substring/word-boundary match.

const LATIN_ONLY = /^[a-z0-9\s'!?.,-]+$/i;
const MENTION_OR_EMOJI = /<(@!?\d+|#\d+|:[a-zA-Z0-9_]+:\d+|a?:[a-zA-Z0-9_]+:\d+)>/g;
const URL = /https?:\/\/\S+/g;

function normalize(text) {
  if (!text) return '';
  let out = text.toLowerCase();
  out = out.replace(URL, ' ');
  out = out.replace(MENTION_OR_EMOJI, ' ');
  // Collapse elongated words: "thanksss" -> "thanks", "merciii" -> "mercii"
  // Only collapse runs of 3+ identical letters down to 1.
  out = out.replace(/([a-zà-öø-ÿ])\1{2,}/gi, '$1');
  // Collapse excess whitespace
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a matcher function for a flat list of phrases (already lowercase).
 * Latin-script phrases get word-boundary-safe matching (so "ty" doesn't match
 * inside "party"); non-Latin scripts fall back to plain substring matching
 * since word-boundary semantics don't apply the same way.
 */
function buildMatcher(phrases) {
  const regexes = phrases
    .filter(Boolean)
    .map((phrase) => {
      const p = phrase.toLowerCase().trim();
      if (!p) return null;
      const escaped = escapeRegex(p);
      if (LATIN_ONLY.test(p)) {
        return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i');
      }
      return new RegExp(escaped);
    })
    .filter(Boolean);

  return function matches(normalizedText) {
    return regexes.some((re) => re.test(normalizedText));
  };
}

module.exports = { normalize, buildMatcher };
