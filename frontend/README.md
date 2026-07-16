<h1 align="center">LLMHub Frontend</h1>


<p align="center">
  LLMHub frontend built with Next.js and Vercel AI SDK
</p>


## Features

- [Next.js](https://nextjs.org) App Router
  - Advanced routing for seamless navigation and performance
  - React Server Components (RSCs) and Server Actions for server-side rendering and increased performance
- [AI SDK](https://ai-sdk.dev/docs/introduction)
  - Unified API for generating text, structured objects, and tool calls with LLMs
  - Hooks for building dynamic chat and generative user interfaces
  - Supports OpenAI (default), Anthropic, Cohere, and other model providers
- [shadcn/ui](https://ui.shadcn.com)
  - Styling with [Tailwind CSS](https://tailwindcss.com)
  - Component primitives from [Radix UI](https://radix-ui.com) for accessibility and flexibility
- [NextAuth.js](https://github.com/nextauthjs/next-auth)
  - Simple and secure authentication


## Running locally

You will need to use the environment variables [defined in `.env.example`](.env.example) to run this application.

> Note: You should not commit your `.env` file or it will expose secrets that will allow others to control access to your various OpenAI and authentication provider accounts.

### Environment variables

- `.env.example` provides the default values. Copy it to a local `.env` file: `cp .env.example .env`
- In Next.js, `.env.local` overrides `.env`. To change certain variable values, create a `.env.local` and override only the values that need to be overwritten.

```bash
pnpm install
pnpm dev
```

Your app template should now be running on [localhost:3000](http://localhost:3000/).
