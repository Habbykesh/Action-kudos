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

Judge intent using the conversation context provided, not just the thank-you wording in isolation — "thank you" alone could be either, depending on what it's replying to.

Respond with ONLY one line of raw JSON and nothing else — no markdown fences, no explanation, no extra text:
{"classification":"GENUINE_HELP"}
or
{"classification":"PLEASANTRY"}`;

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

/**
 * Classifies a thank-you as GENUINE_HELP or PLEASANTRY using Gemini.
 *
 * Returns { classification: 'GENUINE_HELP' | 'PLEASANTRY' } on success.
 * Returns null on ANY failure — timeout, network error, non-2xx response,
 * unparseable output, or an unexpected classification value. Per spec §8,
 * callers MUST treat null as "do not reward, log for investigation."
 */
async function classifyThankYou({ thankMessage, helpMessage, contextMessages = [] }) {
  if (!config.geminiApiKey) {
    console.error('[aiVerifier] GEMINI_API_KEY is not configured — cannot verify, skipping reward.');
    return null;
  }

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
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [
          {
            role: 'user',
            parts: [{ text: buildUserContent({ contextMessages, helpMessage, thankMessage }) }],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 32,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error(`[aiVerifier] Gemini request failed: ${response.status} ${response.statusText} — ${body.slice(0, 300)}`);
      return null;
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    const classification = parseClassification(rawText);

    if (!classification) {
      console.error('[aiVerifier] Gemini returned an unparseable/unexpected response:', JSON.stringify(data).slice(0, 500));
      return null;
    }

    return { classification };
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error(`[aiVerifier] Gemini request timed out after ${config.geminiTimeoutMs}ms`);
    } else {
      console.error('[aiVerifier] Gemini request errored:', err);
    }
    return null;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

module.exports = { classifyThankYou };
