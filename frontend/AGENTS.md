# Repository Guidelines

## Project Structure & Module Organization
- `app/`: Next.js app routes, layouts, and server route handlers (`app/api/**/route.ts`).
- `components/`: UI components (`components/ui`) and feature components.
- `hooks/`: React Query hooks (for models, deployments, chat).
- `lib/`: shared logic (`lib/db`, `lib/ai`, `lib/models`, `lib/security`).
- `public/`, `docs/`, and Drizzle migrations under `lib/db/migrations/`.

## Build, Test, and Development Commands
- `pnpm dev`: run local dev server.
- `pnpm build`: run DB migration script + production build.
- `pnpm start`: run production server.
- `pnpm lint`: Next lint + Biome lint.
- `pnpm format`: format with Biome.
- `pnpm db:migrate`: apply Drizzle DB migrations.

## Coding Style & Naming Conventions
- TypeScript + React function components; 2-space indentation.
- Tanstack React query + mutation hooks are used for data fetching and caching. No use of useEffect/useState/useSWR unless absolutely necessary.
- Hooks use `useXxx` naming in `hooks/`.
- API routes use Next conventions (`app/api/.../route.ts`).
- File names should be in kebab-case.
- Prefer concise, typed interfaces for API payloads and hook returns.

## UI Components Conventions
- Components are styled with Shadcn UI.
- Components are styled with Tailwind CSS.
- Components are responsive and accessible.
- Components are reusable and composable.
- Components are documented with JSDoc.
- Design for both light/dark mode.
- Use existing brand colors and typography.

## Testing Guidelines
- No dedicated test runner is currently wired; use quality gates:
  - `pnpm lint`
  - `pnpm build`
- For risky logic (deployment routing/status), add focused assertions/tests when introducing new helpers.

## Commit & Pull Request Guidelines
- Use conventional commit prefixes: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`.
- Keep commits small and single-purpose.
- PRs should include: summary, changed paths, validation steps, and screenshots for UI updates.

## Security & Configuration Tips
- Never commit secrets; use `.env.local` and .env.example.
- Keep local/mock APIs namespaced under test routes (for example `app/api/local/...`) and keep core deployment routes production-safe.
