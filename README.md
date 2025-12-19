# AI Project (Cloudflare Pages + Worker)

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure Cloudflare bindings (Pages/Workers):

- `OPENAI_API_KEY` (secret)
- `AI_MEMORY` (KV namespace)
- `AI_KB` (KV namespace)
- `AI_FILES` (KV namespace)

3. Run locally with Pages dev:

```bash
npm run dev
```

This serves the static UI from `public/` and the API via `worker.js`.

## Features

- AI chat with model selection and short-term memory.
- Knowledge base saving with AI-powered folder classification (hidden in UI).
- AI-created files are stored in KV and downloadable via links.
- Markdown rendering for AI responses.
- Collapsible sidebar with database and file sections.
