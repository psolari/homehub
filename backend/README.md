# HomeHub backend

The HomeHub backend is a Django REST application managed with Poetry.

For full project setup and architecture documentation, see the repository [README](../README.md) and [architecture documentation](../docs/architecture.md).

## Setup

From the repository root, create `.env` from `.env.example` and export those values when running Django directly from a shell.

Then:

```bash
cd backend
poetry install
poetry run homehub migrate
poetry run homehub runserver 0.0.0.0:8000
```

The backend API is available under `/api/`.

## Useful commands

```bash
poetry run homehub test
poetry run homehub check
poetry run homehub makemigrations
poetry run homehub migrate
```

Device-integration conventions are documented in [docs/device-integrations.md](../docs/device-integrations.md).
