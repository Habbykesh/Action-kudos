// Base Pidgin dictionary for the Pidgin Enforcement Layer.
// Not AI-based — a plain, curated word/phrase list, matched after
// normalization (see normalize.js + matcher.js). Admins can extend this
// per-server with /pidgin add, and it merges with this base list in
// dictionaryEngine.js.

const BASE_TERMS = [
  'omo',
  'dey',
  'abeg',
  'una',
  'watin',
  'wetin',
  'wahala',
  'sabi',
];

module.exports = { BASE_TERMS };
