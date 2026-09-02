const { BASE_TERMS } = require('./dictionary');
const customTerms = require('./customTerms');
const { normalize } = require('./normalize');
const { buildOffenceMatcher } = require('./matcher');

const matcherCache = new Map(); // guildId -> { matcher, customLength }

async function getMatcherForGuild(guildId) {
  const custom = await customTerms.getCustomTerms(guildId);
  const cached = matcherCache.get(guildId);
  if (cached && cached.customLength === custom.length) {
    return cached.matcher;
  }
  const matcher = buildOffenceMatcher([...BASE_TERMS, ...custom]);
  matcherCache.set(guildId, { matcher, customLength: custom.length });
  return matcher;
}

function invalidate(guildId) {
  matcherCache.delete(guildId);
}

/**
 * Returns the list of configured terms that matched the message (empty
 * array if none). A message with multiple matches still only ever
 * produces one offence — that's enforced by the caller (pidginService.js),
 * not here; this just reports what was found.
 */
async function detect(guildId, rawText) {
  const normalized = normalize(rawText);
  if (!normalized) return [];
  const matcher = await getMatcherForGuild(guildId);
  return matcher(normalized);
}

async function countConfiguredTerms(guildId) {
  const custom = await customTerms.getCustomTerms(guildId);
  return BASE_TERMS.length + custom.length;
}

module.exports = { detect, invalidate, countConfiguredTerms };
