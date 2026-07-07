import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `You are a landing page generator. Given a short description of a product, business, or idea, output a single complete, self-contained HTML document for a polished marketing landing page.

Rules:
- Output ONLY raw HTML starting with <!doctype html> — no markdown fences, no commentary before or after.
- Inline all CSS in a <style> tag in the <head>. Do not reference external stylesheets, fonts, images, or scripts.
- Use only system fonts, CSS gradients/shapes, and emoji for visuals — no external image URLs.
- Include: a hero section with headline + subheadline + call-to-action button, a features or benefits section, a short social-proof or testimonial section, and a footer with a call-to-action.
- Make it responsive (mobile-friendly) and visually modern (good spacing, a coherent color palette, readable typography).
- Fill in realistic, specific placeholder copy based on the user's description — do not leave [bracketed placeholders].`;

export async function generateLandingPageHtml(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to your environment to enable generation."
    );
  }

  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

  const message = await client.messages.create({
    model,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Build a landing page for: ${prompt}`,
      },
    ],
  });

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  const html = extractHtml(text);
  if (!html) {
    throw new Error("Model response did not contain an HTML document.");
  }
  return html;
}

function extractHtml(text: string): string | null {
  const fenced = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.toLowerCase().indexOf("<!doctype html");
  const fallbackStart = start === -1 ? candidate.toLowerCase().indexOf("<html") : start;
  if (fallbackStart === -1) return null;
  return candidate.slice(fallbackStart).trim();
}
