# HomeHub

HomeHub is a self-hosted smart-home application with a Django REST backend and a React/TypeScript frontend. It is intended to provide one interface for modelling rooms and floor plans, registering smart-home devices, and controlling devices through vendor-specific integrations.

The project is in active early development. The current device-integration work is focused on smart TVs, with Samsung and LG drivers providing the first integration boundary.

## Technology stack

### Backend

- Python 3.11+
- Django 5
- Django REST Framework
- Simple JWT authentication
- Poetry for dependency management
- SQLite for local development

### Frontend

- React 19
- TypeScript
- Vite
- Redux Toolkit
- React Router
- Tailwind CSS

## Repository layout

```text
homehub/
├── .github/                 # GitHub configuration and workflows
├── .vscode/                 # Shared, portable VS Code configuration
├── docs/                    # Architecture and integration documentation
├── backend/
│   ├── pyproject.toml
│   ├── poetry.lock
│   └── homehub/
│       ├── manage.py
│       ├── core/            # Current Django application/domain code
│       └── smart_home_backend/
│           └── settings.py  # Django project configuration
└── frontend/
    ├── package.json
    └── src/
        ├── api/
        ├── components/
        ├── pages/
        ├── redux/
        └── utils/
```

For a description of how the pieces currently interact, see [docs/architecture.md](docs/architecture.md). For the current smart-device driver model, see [docs/device-integrations.md](docs/device-integrations.md).

## Local development

### Prerequisites

Install:

- Python 3.11 or newer
- Poetry
- Node.js and npm

### 1. Configure the environment

Copy the example environment file:

```bash
cp .env.example .env
```

Generate a Django secret key and place it in `DJANGO_SECRET_KEY` in `.env`:

```bash
python -c "import secrets; print(secrets.token_urlsafe(50))"
```

The committed VS Code launch configuration loads the root `.env` automatically. Vite also reads environment values from the repository root.

When starting Django directly from a shell, export the root `.env` first:

```bash
set -a
source .env
set +a
```

### 2. Start the backend

From the repository root:

```bash
cd backend
poetry install
poetry run homehub migrate
poetry run homehub runserver 0.0.0.0:8000
```

The API is available at `http://localhost:8000/api/` by default.

### 3. Start the frontend

In another terminal:

```bash
cd frontend
npm ci
npm run dev
```

The frontend is available at `http://localhost:5173` by default.

### VS Code

The shared launch configuration includes a compound task named **Launch Backend and Frontend**. Select a Python interpreter for the Poetry environment in VS Code, create `.env` from `.env.example`, then run the compound configuration.

## Environment variables

| Variable | Purpose | Development default |
| --- | --- | --- |
| `DJANGO_SECRET_KEY` | Django signing key | Ephemeral key when `DJANGO_DEBUG=True`; required when debug is disabled |
| `DJANGO_DEBUG` | Enables Django debug mode | `True` |
| `DJANGO_ALLOWED_HOSTS` | Comma-separated Django allowed hosts | Empty |
| `DJANGO_CORS_ALLOW_ALL_ORIGINS` | Allow all CORS origins | `True` |
| `DJANGO_CORS_ALLOWED_ORIGINS` | Comma-separated explicit CORS origins | Empty |
| `VITE_BACKEND_URL` | Base URL used by the React frontend | `http://localhost:8000` |

Production deployments should explicitly set the Django secret, disable debug mode, restrict allowed hosts, and restrict CORS origins.

## Development commands

Frontend quality checks already available:

```bash
cd frontend
npm run lint
npm run format-check
npm run build
```

Backend tests currently use Django's test framework:

```bash
cd backend
poetry run homehub test
```

The GitHub Actions workflow is reserved for the next CI foundation step and is not configured yet.

## Local and sensitive runtime data

The following must not be committed:

- `.env` files containing real credentials or secrets
- SQLite development databases
- Python bytecode and caches
- device pairing/authentication tokens
- virtual environments
- frontend dependencies and build output

Device tokens are runtime state. Drivers may create them locally as needed, but the token directory is ignored by Git.

## Documentation

- [Architecture](docs/architecture.md)
- [Device integrations](docs/device-integrations.md)

## License

HomeHub is licensed under the MIT License. See [LICENSE](LICENSE).
