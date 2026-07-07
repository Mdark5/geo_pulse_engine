const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

const SYSTEM_PROMPT = `You write complete, single-file HTML landing pages.
Output ONLY raw HTML starting with <!doctype html> - no markdown code fences, no commentary.
Inline all CSS in a <style> tag. Do not reference external assets, fonts, or scripts.
Design a clean, modern landing page for the product idea the user describes, including:
a headline, a subheadline, 3 feature highlights, and a call-to-action button.
Keep it a single page, mobile-responsive, and visually polished using only CSS.`;

async function generateLandingPage(prompt) {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await generateWithClaude(prompt);
    } catch (err) {
      console.error('Claude generation failed, falling back to template:', err.message);
    }
  }
  return generateFromTemplate(prompt);
}

async function generateWithClaude(prompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Product idea: ${prompt}` }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.content && data.content[0] && data.content[0].text;
  if (!text) {
    throw new Error('Empty response from Anthropic API');
  }
  return stripCodeFences(text.trim());
}

function stripCodeFences(text) {
  return text.replace(/^```(?:html)?\n?/i, '').replace(/```$/, '').trim();
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function generateFromTemplate(prompt) {
  const idea = escapeHtml(prompt);
  const headline = idea.length > 60 ? idea.slice(0, 57) + '...' : idea;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${headline}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #1a1a2e;
    background: linear-gradient(180deg, #f7f8fc 0%, #eef0fb 100%);
  }
  header {
    max-width: 880px;
    margin: 0 auto;
    padding: 96px 24px 64px;
    text-align: center;
  }
  h1 {
    font-size: clamp(2rem, 5vw, 3.2rem);
    line-height: 1.15;
    margin-bottom: 20px;
  }
  p.sub {
    font-size: 1.2rem;
    color: #4a4a68;
    max-width: 640px;
    margin: 0 auto 36px;
  }
  .cta {
    display: inline-block;
    background: #5b4cff;
    color: #fff;
    padding: 14px 32px;
    border-radius: 999px;
    font-weight: 600;
    text-decoration: none;
    box-shadow: 0 8px 24px rgba(91, 76, 255, 0.35);
  }
  .features {
    max-width: 960px;
    margin: 0 auto;
    padding: 0 24px 96px;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 24px;
  }
  .feature {
    background: #fff;
    border-radius: 16px;
    padding: 32px 24px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.05);
  }
  .feature h3 { margin-bottom: 10px; font-size: 1.1rem; }
  .feature p { color: #5c5c78; font-size: 0.95rem; line-height: 1.5; }
</style>
</head>
<body>
  <header>
    <h1>${idea}</h1>
    <p class="sub">A live landing page generated from a single idea. Refine the prompt to reshape the pitch, then ship it.</p>
    <a class="cta" href="#">Get Started</a>
  </header>
  <section class="features">
    <div class="feature">
      <h3>Fast to launch</h3>
      <p>Go from idea to a shareable page in under a minute, no design work required.</p>
    </div>
    <div class="feature">
      <h3>Built to convert</h3>
      <p>Clear headline, focused message, and a single call to action guide visitors to say yes.</p>
    </div>
    <div class="feature">
      <h3>Easy to iterate</h3>
      <p>Change the prompt and regenerate instantly to test different angles on your idea.</p>
    </div>
  </section>
</body>
</html>`;
}

module.exports = { generateLandingPage };
