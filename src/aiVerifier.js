const config = require('./config');

function geminiEndpoint(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

// The AI's ONLY job is GENUINE_HELP vs PLEASANTRY. It must never see or
// decide anything about reward amounts, eligibility, limits, roles, or
// OG/moderator status — that's all deterministic logic in rewardService.js.
const SYSTEM_INSTRUCTION = `You are a strict binary classifier for a Discord community bot called Action Kudos.

Your ONLY job: decide whether a "thank you" message is genuine appreciation for real, ecosystem-relevant help, or just a social pleasantry. You do not decide reward amounts, eligibility, or anything else — only this one classification.

GENUINE_HELP means the message being thanked actually helped with something like: Web3/DeFi questions or troubleshooting, the Action Model ecosystem or its products, wallet connections, connecting X/Twitter or other supported accounts, dApp usage, transactions or signing, smart-contract-related assistance, bridging or other Web3 workflows, Discord navigation, explaining where to find something or which channel to use, explaining how to verify, or otherwise helping a member complete a server-related process.

PLEASANTRY means the thank-you is NOT acknowledging that kind of help — e.g. thanking someone for asking a question, for a compliment, for an invite, for a welcome, for birthday wishes, for a follow, or general social/casual conversation with no real assistance behind it.

Judge intent using the conversation context provided, not just the thank-you wording in isolation — "thank you" alone could be either, depending on what it's replying to.`;

function truncate(text, max = 500) {
  if (!text) return '(no text content)';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function buildUserContent({ contextMessages, helpMessage, thankMessage }) {
  const lines = [];

  if (contextMessages.length) {
    lines.push('Nearby conversation context, for background only (oldest first):');
    for (const m of contextMessages) {
      lines.push(`[${m.author}]: ${truncate(m.content)}`);
    }
    lines.push('');
  }

  lines.push('Message being replied to (the potential help):');
  lines.push(`[${helpMessage.author.username}]: ${truncate(helpMessage.content)}`);
  lines.push('');
  lines.push('Thank-you message (sent as a reply to the message above):');
  lines.push(`[${thankMessage.author.username}]: ${truncate(thankMessage.content)}`);
  lines.push('');
  lines.push('Classify this thank-you.');

  return lines.join('\n');
}

function parseClassification(rawText) {
  if (!rawText) return null;
  let cleaned = rawText.trim();
  // Strip accidental markdown fences in case the model doesn't respect
  // responseMimeType perfectly.
  cleaned = cleaned.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }

  if (parsed?.classification === 'GENUINE_HELP' || parsed?.classification === 'PLEASANTRY') {
    return parsed.classification;
  }
  return null;
}

const REQUEST_BODY = (contextMessages, helpMessage, thankMessage) => ({
  system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
  contents: [
    {
      role: 'user',
      parts: [{ text: buildUserContent({ contextMessages, helpMessage, thankMessage }) }],
    },
  ],
  generationConfig: {
    temperature: 0,
    // gemini-3.6-flash is a Gemini 3-family "thinking" model — it spends
    // tokens reasoning internally before writing output, and those
    // thinking tokens count against maxOutputTokens. Gemini 3 models use
    // thinkingLevel (not the older thinkingBudget field). "low" keeps this
    // cheap for a simple binary classification task.
    thinkingConfig: { thinkingLevel: 'low' },
    // Needs to comfortably cover thinking + the actual JSON answer — 32
    // was too small and left 0 tokens for output once thinking used its
    // share, causing an empty MAX_TOKENS response.
    maxOutputTokens: 1024,
    responseMimeType: 'application/json',
    // Constrains the output at the API level, not just by asking nicely in
    // the prompt: Gemini is structurally unable to return anything except
    // {"classification": "GENUINE_HELP"|"PLEASANTRY"}. parseClassification()
    // below is still kept as a defense-in-depth safety net, but with this
    // schema it should never need to reject anything except an outright
    // empty/truncated response.
    responseSchema: {
      type: 'OBJECT',
      properties: {
        classification: {
          type: 'STRING',
          enum: ['GENUINE_HELP', 'PLEASANTRY'],
        },
      },
      required: ['classification'],
      propertyOrdering: ['classification'],
    },
  },
});

/**
 * A single attempt at the Gemini call. Returns:
 * - { ok: true, classification } on success
 * - { ok: false, retryable: true } on a timeout specifically — worth one retry
 * - { ok: false, retryable: false } on anything else (bad key, bad request,
 *   rate limit, unparseable output) — retrying immediately won't help
 */
async function performRequest({ thankMessage, helpMessage, contextMessages }) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), config.geminiTimeoutMs);

  try {
    const response = await fetch(geminiEndpoint(config.geminiModel), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.geminiApiKey,
      },
      body: JSON.stringify(REQUEST_BODY(contextMessages, helpMessage, thankMessage)),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error(`[aiVerifier] Gemini request failed: ${response.status} ${response.statusText} — ${body.slice(0, 300)}`);
      return { ok: false, retryable: false };
    }

    const data = await response.json();
    const candidate = data?.candidates?.[0];
    const rawText = candidate?.content?.parts?.[0]?.text;

    if (!rawText && candidate?.finishReason === 'MAX_TOKENS') {
      console.error(
        '[aiVerifier] Gemini used its entire token budget on internal thinking and never wrote an answer ' +
          '(finishReason: MAX_TOKENS, empty content). Consider raising maxOutputTokens or lowering thinkingLevel further.'
      );
      return { ok: false, retryable: false };
    }

    const classification = parseClassification(rawText);

    if (!classification) {
      console.error('[aiVerifier] Gemini returned an unparseable/unexpected response:', JSON.stringify(data).slice(0, 500));
      return { ok: false, retryable: false };
    }

    return { ok: true, classification };
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error(`[aiVerifier] Gemini request timed out after ${config.geminiTimeoutMs}ms`);
      return { ok: false, retryable: true };
    }
    console.error('[aiVerifier] Gemini request errored:', err);
    return { ok: false, retryable: false };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * Classifies a thank-you as GENUINE_HELP or PLEASANTRY using Gemini.
 *
 * Returns { classification: 'GENUINE_HELP' | 'PLEASANTRY' } on success.
 * Returns null on ANY failure — timeout (after one retry), network error,
 * non-2xx response, unparseable output, or an unexpected classification
 * value. Per spec §8, callers MUST treat null as "do not reward, log for
 * investigation."
 *
 * Retries exactly once, and only on a timeout — a single slow response
 * shouldn't cost someone their reward, but a hard error (bad key, rate
 * limit, malformed request) won't be fixed by immediately retrying, so
 * those fail fast instead of doubling latency for nothing.
 */
async function classifyThankYou({ thankMessage, helpMessage, contextMessages = [] }) {
  if (!config.geminiApiKey) {
    console.error('[aiVerifier] GEMINI_API_KEY is not configured — cannot verify, skipping reward.');
    return null;
  }

  let result = await performRequest({ thankMessage, helpMessage, contextMessages });

  if (!result.ok && result.retryable) {
    console.error('[aiVerifier] Retrying once after timeout...');
    result = await performRequest({ thankMessage, helpMessage, contextMessages });
  }

  return result.ok ? { classification: result.classification } : null;
}

module.exports = { classifyThankYou };
