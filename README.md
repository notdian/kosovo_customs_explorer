# Kosovo Customs Explorer

Interactive explorer for the tariff schedule published by the Customs Administration of the Republic of Kosovo. Search and filter tariff codes in Albanian, review duty rates, and understand how individual items map to the broader customs hierarchy.

> **Disclaimer**: This project is community-maintained and is not an official product of Dogana e Kosovës. Always verify information against the latest official publications.

## Key features

- Fast client-side search across ~10k tariff records using MiniSearch
- Hierarchical tree table with virtualized rendering for smooth scrolling
- Offline-first caching powered by Dexie (IndexedDB)
- Static export (`next build`) suitable for GitHub Pages or any static host
- Build timestamp embedded via `NEXT_PUBLIC_BUILD_TIME` for quick freshness checks

## Quick start

Prerequisites: Node.js ≥ 20 and [pnpm](https://pnpm.io/) ≥ 8.

```bash
pnpm install
pnpm dev
```

Visit http://localhost:3000 to view the explorer. The entry point lives in `app/page.tsx`, and changes hot-reload automatically.

## Available scripts

| Command | Description |
| ------- | ----------- |
| `pnpm dev` | Run the Next.js development server |
| `pnpm build` | Create a production build and static export in `out/` |
| `pnpm start` | Serve the production build (uses `next start`) |
| `pnpm lint` | Run ESLint checks |
| `pnpm trim-tarrifs` | Normalize and slim the source tariff dataset |

## Data pipeline

- Source data is stored in `data/tarrifs.json`, derived from the official customs tariff publications.
- Run `pnpm trim-tarrifs` after updating the raw dataset to coerce types, remove unused fields, and shrink payload size.
- The trimmed JSON is bundled into the static export and indexed on first load inside the browser.

## Deployment notes

- The app is configured with `output: "export"` and `basePath: "/kosovo_customs_explorer"` (see `next.config.ts`), which makes it straightforward to host on GitHub Pages.
- Adjust the `basePath` (and update any asset links) if you deploy under a different subdirectory.
- The build timestamp shown in the UI comes from `NEXT_PUBLIC_BUILD_TIME`, automatically set at build time in `next.config.ts`. Override it by defining the variable in your environment when needed.

## Project structure

- `app/` – App Router pages and layout
- `components/` – UI primitives and the tariff explorer widgets
- `lib/` – Dexie data service, search helpers, and formatters
- `data/` – Trimmed tariff dataset consumed by the client
- `public/` – Static assets for the exported site

## Contributing

Contributions and data corrections are welcome. To propose changes, open an issue or submit a pull request via GitHub. Please include details about the data source and steps to reproduce when reporting discrepancies.
