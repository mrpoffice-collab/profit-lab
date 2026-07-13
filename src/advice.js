// The advice layer — Claude Opus 4.8 reads the computed numbers and writes
// the plain-English findings. The engine does the math; Claude does the talking.
const MODEL = 'claude-opus-4-8';

async function buildNarrative(analysis, accountName) {
  const prompt = `You are the advisory voice of Profit Lab, a product that tells small service-business owners the truth about what their hours earn. Voice: plain-spoken, direct, warm but zero hype. Never use marketing language. Every claim must come from the numbers provided. Write for a busy owner, not an accountant.

Here is the computed analysis for "${accountName}" (all numbers are real, computed from their Jobber data):

${JSON.stringify(analysis, null, 2)}

Write the findings as JSON with EXACTLY this shape (no markdown fences, JSON only):
{
  "headline": "2-3 sentence summary for the top of the report: total earned, total hours, blended $/hr, the spread between best and worst work, and the single biggest opportunity in dollars",
  "findings": [
    {
      "title": "short punchy finding title with the key number in it",
      "body": "2-3 sentences: what the numbers show and why it matters",
      "action": "one concrete instruction with a specific dollar amount or percentage",
      "worth": "estimated $ value like '~$2,300/season' or '$1,850 now'",
      "tone": "cash | leak | win"
    }
  ],
  "bottomLine": "2-3 sentences: total opportunity if they act, framed as a raise for zero extra work. No hype."
}

Rules: 3 to 6 findings, ordered by dollar impact. tone "cash" = unbilled/collectable money, "leak" = underpricing or losing work, "win" = their best work to do more of. Include at least one "win" if the data shows one. If totals.unbilled > 0 make it finding #1. Use client names from clientOutliers when a specific client is a clear outlier. Round dollars sensibly. If the analysis has empty=true, return a single finding explaining there isn't enough completed-visit data yet and what to do.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  if (data.stop_reason === 'refusal') throw new Error('Advice generation was declined');

  const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const cleaned = text.replace(/^```(json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  return JSON.parse(cleaned.slice(start, end + 1));
}

module.exports = { buildNarrative };
