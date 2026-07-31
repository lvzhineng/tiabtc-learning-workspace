---
status: proposed
---

# Evolve the current system with React while retaining Python, Bybit, and SQLite

The migration will evolve `tiabtc-learning-workspace` in place: a React and TypeScript frontend will replace the generated and vanilla-JavaScript review UI incrementally, while the Python HTTP service, Bybit market-data source, existing API behavior, and existing SQLite data remain the compatibility baseline. `BitLanglangReview` is a reference implementation and source of selected domain/UI logic, not the new application shell or backend; its OKX services, Vite middleware backend, workbook requirement, database schema, lockfiles, and `node_modules` must not be copied wholesale.

## Considered Options

- Replace the current repository with `BitLanglangReview`: rejected because it would discard video learning, Bybit semantics, offline cache ranges, rich drawing persistence, and existing local data.
- Rewrite both frontend and backend in TypeScript: rejected for the first migration because it combines UI, API, storage, and data-source risk into one cutover.
- Keep extending the current generated HTML and vanilla JavaScript: rejected because the main review script and Python server already combine too many responsibilities for safe feature growth.

## Consequences

- During migration, the legacy pages and the React application may coexist behind separate entry URLs.
- The frontend must adapt existing wire formats rather than forcing an immediate database or API rewrite.
- Python internals may be modularized only after compatibility is established, without changing public API behavior in the same phase.
- All market-data code and user-visible symbol terminology must use Bybit conventions.
