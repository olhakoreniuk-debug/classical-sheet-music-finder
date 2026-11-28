# Classical Sheet Music Finder: frontend

React + TypeScript (strict) + Vite, built from the API contract in
[`../openapi.yaml`](../openapi.yaml) (see
[ADR-0005](../docs/adr/0005-react-typescript-vite-frontend.md)).

## Commands

Run from this folder in PowerShell, through mise:

```powershell
mise exec -- npm ci                 # install the pinned dependencies
mise exec -- npm run dev            # demonstration mode: http://127.0.0.1:5173/ (no backend needed)
mise exec -- npm run dev:api        # real API mode: proxies /api to the Express server on 127.0.0.1:3000
mise exec -- npm run check          # API types in sync, type check, lint, tests
mise exec -- npm run build          # production build (real API mode)
mise exec -- npm run api:types      # regenerate src/api/generated/schema.ts after changing openapi.yaml
```

**Demonstration mode** uses built-in sample data that follows the contract. It
is not read from PostgreSQL, a banner says so on every page, and works added
there are kept only until the page is reloaded. The final demonstration uses
real stored data through the Express API (`npm run dev:api`).

## Structure

| Folder | Responsibility |
|---|---|
| `src/api/` | The `CatalogApi` port, the HTTP client, `ApiError`, and types generated from `openapi.yaml` (never edited by hand) |
| `src/mock/` | Development-only implementation of `CatalogApi` with demonstration data |
| `src/app/` | Composition root (chooses mock or HTTP), routes, layout |
| `src/features/works/` | Catalogue, detail and form: `components/` (presentation), `hooks/` (data loading), `model/` (pure mapping logic) |
| `src/features/sources/` | Sources from `GET /sources` (filter options, attribution) |
| `src/components/` | Shared presentational components (loading, empty and error states, pagination, form field) |
| `src/shared/` | Generic hooks and helpers |

React components depend only on the `CatalogApi` interface. Switching from the
demonstration data to the real API changes nothing in the components.
