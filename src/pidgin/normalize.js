// Normalizes raw Discord message text for Pidgin detection. Independent
// from src/matcher.js (the Thank-You layer's normalizer) so the two
// systems can evolve separately per the spec's independence requirement.

const URL_REGEX = /https?:\/\/\S+/g;
const MENTION_OR_EMOJI_REGEX = /<(@!?\d+|#\d+|a?:[a-zA-Z0-9_]+:\d+)>/g;

/**
 * Collapses any run of 2+ identical letters down to a single instance, so
 * arbitrarily stretched spellings all normalize to the same base form:
 * "omo" / "omoo" / "omoooo" / "omoooooo" -> "omo"
 * "abeg" / "abeggg"                       -> "abeg"
 * "wahala" / "wahalaaa" / "wahalaaaaa"    -> "wahala"
 * "dey" / "deyyy"                          -> "dey"
 * Dictionary terms are collapsed the same way when the matcher is built
 * (see matcher.js), so matching stays consistent in both directions.
 */
function collapseRepeats(text) {
  return text.replace(/([a-z])\1+/g, '$1');
}

function normalize(text) {
  if (!text) return '';
  let out = text.toLowerCase();
  out = out.replace(URL_REGEX, ' ');
  out = out.replace(MENTION_OR_EMOJI_REGEX, ' ');
  // Strip punctuation, emoji, and other symbols — keep letters, digits,
  // apostrophes, and whitespace. This neutralizes things like "OMOOOO 😂",
  // "Abeg!!!", "WETIN?" down to their plain word content.
  out = out.replace(/[^a-z0-9'\s]/g, ' ');
  out = collapseRepeats(out);
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

module.exports = { normalize, collapseRepeats };
