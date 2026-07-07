# Landing Page Generator

Describe your product in a sentence, get an AI-generated landing page, publish it to a shareable URL. Built as a scrappy MVP to test demand before investing in anything else.

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:3000, type a description, click **Generate**, then **Publish** to get a shareable link at `/p/<slug>`.

## How it works

- `app/page.tsx` — prompt input, Generate button, live preview.
- `app/api/generate/route.ts` — sends the prompt to Claude and returns a self-contained HTML landing page.
- `app/api/publish/route.ts` — saves the generated HTML under a short slug.
- `app/p/[slug]/route.ts` — serves the published HTML directly at a shareable URL.
- `lib/pages-store.ts` — file-based storage (`data/pages.json`) for published pages. Fine for an MVP on a single running instance; swap for a real database before scaling.

## Metric that matters right now

Number of users who generated **and** published a landing page. Nothing else is in scope until that number tells us something.
