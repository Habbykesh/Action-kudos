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

// HTTP status codes worth retrying: 429 (rate limited), and the 5xx family
// Google itself describes as transient ("high demand... usually
// temporary" for 503, similar for 500/502/504). Anything else (400 bad
// request, 401/403 auth, 404 unknown model) is a real problem that an
// immediate retry won't fix.
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

/**
 * A single attempt at the Gemini call. Returns:
 * - { ok: true, classification } on success
 * - { ok: false, retryable: true } on a timeout, or a transient HTTP error
 *   (429/5xx) — worth one retry
 * - { ok: false, retryable: false } on anything else (bad key, bad
 *   request, unparseable output) — retrying immediately won't help
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
      return { ok: false, retryable: RETRYABLE_STATUS_CODES.has(response.status) };
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
 * Returns null on ANY failure — timeout, transient error (both after one
 * retry), a hard error, unparseable output, or an unexpected
 * classification value. Per spec §8, callers MUST treat null as "do not
 * reward, log for investigation."
 *
 * Retries exactly once, and only when it's likely to help: a timeout, or a
 * transient server-side error (429 rate limit, 5xx — Google's own error
 * text calls these "usually temporary"). A short backoff runs before that
 * retry, since an instant retry into the same busy moment is less likely
 * to succeed than a brief pause. A hard error (bad key, malformed
 * request, bad model name) won't be fixed by retrying at all, so those
 * fail fast instead of doubling latency for nothing.
 */
const RETRY_BACKOFF_MS = 2000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function classifyThankYou({ thankMessage, helpMessage, contextMessages = [] }) {
  if (!config.geminiApiKey) {
    console.error('[aiVerifier] GEMINI_API_KEY is not configured — cannot verify, skipping reward.');
    return null;
  }

  let result = await performRequest({ thankMessage, helpMessage, contextMessages });

  if (!result.ok && result.retryable) {
    console.error(`[aiVerifier] Retrying once after a ${RETRY_BACKOFF_MS}ms backoff...`);
    await delay(RETRY_BACKOFF_MS);
    result = await performRequest({ thankMessage, helpMessage, contextMessages });
  }

  return result.ok ? { classification: result.classification } : null;
}

module.exports = { classifyThankYou };
