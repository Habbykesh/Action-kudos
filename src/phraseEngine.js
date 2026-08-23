const { BASE_PHRASES } = require('./phrases');
const { getCustomPhrases } = require('./customPhrases');
const { normalize, buildMatcher } = require('./matcher');

const matcherCache = new Map(); // guildId -> { matcher, builtAtCustomLength }

async function getMatcherForGuild(guildId) {
  const custom = await getCustomPhrases(guildId);
  const cached = matcherCache.get(guildId);
  // Rebuild if we don't have one yet, or the custom list length changed
  // (cheap heuristic; add/remove always calls invalidate() below anyway).
  if (cached && cached.customLength === custom.length) {
    return cached.matcher;
  }
  const matcher = buildMatcher([...BASE_PHRASES, ...custom]);
  matcherCache.set(guildId, { matcher, customLength: custom.length });
  return matcher;
}

function invalidate(guildId) {
  matcherCache.delete(guildId);
}

async function isAppreciation(guildId, rawText) {
  const normalized = normalize(rawText);
  if (!normalized) return false;
  const matcher = await getMatcherForGuild(guildId);
  return matcher(normalized);
}

module.exports = { isAppreciation, invalidate };
