---
date:
    2026-10-15
categories:
    - Announcements
---

# LLMHub documentation is live

Today we're launching this documentation site for LLMHub — the same Material
for MkDocs setup as the
[Illinois Chat docs](https://docs.chat.illinois.edu/), with Illinois
branding, full-text search, light/dark mode, and a blog for releases and
announcements.

## What's here

- **[Getting started](../../getting-started/quickstart.md)**: from signing
  in to your first chat with a model you launched.
- **[Deploying models](../../deploying/index.md)**: launching, GPUs and
  cost, logs, sharing, and asking for new models.
- **[API reference](../../api/index.md)**: OpenAI-compatible chat
  completions, with curl, Python and JavaScript examples.
- **[Self-hosting](../../self-hosting/index.md)** and
  **[Contributing](../../contributing/index.md)**: pointers to the setup and
  developer guides in the repository.
- **[How it works](../../how-it-works/index.md)**: the architecture, what
  happens when you launch, and a glossary of the HPC vocabulary.

The site builds on every push to `main` and publishes automatically via
GitHub Actions. If you spot something wrong or missing, please open an
issue or PR — the pages live in the
[`docs/`](https://github.com/Center-for-AI-Innovation/LLMHub/tree/main/docs)
directory of the repository.
