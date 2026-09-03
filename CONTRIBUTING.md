# Contributing to HomeHub

HomeHub uses a Django REST backend and React/TypeScript frontend. Make changes on a feature branch and keep vendor-specific code behind the backend integration interface so the frontend remains capability-driven.

## Checks

Run `make test` and `make lint` before opening a pull request. For frontend changes also run `cd frontend && npm run build`.

## Device integrations

Add a driver under `backend/homehub/core/integrations/`, register it with `@register_driver`, declare its configuration schema and generic controls, and avoid exposing vendor response formats directly to React.

Never commit tokens, passwords, `.env`, SQLite databases or runtime pairing files.
