# HomeHub frontend

The HomeHub frontend is a React/TypeScript application built with Vite.

For full project setup and architecture documentation, see the repository [README](../README.md) and [architecture documentation](../docs/architecture.md).

## Setup

The frontend reads `VITE_*` environment variables from the repository root, so create `.env` from `.env.example` before starting the application.

```bash
cd frontend
npm ci
npm run dev
```

The development server runs at `http://localhost:5173` by default.

## Useful commands

```bash
npm run dev
npm run build
npm run lint
npm run format-check
npm run format
```
