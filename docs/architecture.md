# HomeHub architecture

This document describes the current high-level architecture of HomeHub. It is intentionally descriptive rather than a roadmap; structural refactors can be documented separately when they are made.

## System overview

HomeHub is a single repository containing two applications:

```text
React / TypeScript frontend
          |
          | HTTP / JSON
          v
Django REST API
          |
          +---- Django models / SQLite (development)
          |
          +---- device integration drivers
                    |
                    v
             smart-home devices
```

The browser communicates with the Django backend over the REST API. Django owns persistent domain data such as users, floor plans, rooms and devices. Vendor-specific communication with physical smart-home devices is handled in backend device modules rather than in the React application.

## Backend

The backend is managed with Poetry and currently lives under `backend/homehub/`.

### Django project

`backend/homehub/smart_home_backend/` contains the Django project configuration:

- `settings.py` - runtime settings and environment configuration
- `urls.py` - project-level URL routing
- `asgi.py` / `wsgi.py` - deployment entry points

The current Django application is `backend/homehub/core/`.

### Domain data

The current `core` application contains models for:

- users
- floor plans
- rooms
- devices

Django REST Framework serializers and viewsets expose these resources to the frontend.

### Authentication

The backend uses Django REST Framework with Simple JWT. The frontend obtains access/refresh tokens through the backend API and uses those credentials for authenticated requests.

### Device integrations

Physical device communication belongs in `core/device_modules/`. The current TV integration uses a base TV driver with LG and Samsung implementations selected by a registry function.

The intended boundary is:

```text
API view
   |
   v
integration selection
   |
   v
vendor driver
   |
   v
physical device
```

API code should not require vendor protocol details, and the frontend should not communicate directly with smart-home devices.

See [device-integrations.md](device-integrations.md) for the current driver convention.

## Frontend

The frontend is a Vite React application under `frontend/`.

The current source tree separates concerns into:

- `api/` - shared HTTP request helpers
- `components/` - reusable UI components
- `pages/` - route-level screens
- `redux/` - global application state and asynchronous state actions
- `utils/` - shared utilities

`App.tsx` currently composes routing, authentication-aware layouts and application initialization.

### State flow

The normal frontend data path is:

```text
React component/page
       |
       v
Redux action/thunk
       |
       v
API service
       |
       v
Django REST API
```

Django remains the persistent source of truth for domain data. Redux provides browser-side application state and caching.

## Configuration

Runtime configuration is environment-driven.

The repository root `.env.example` documents supported values. Real `.env` files are ignored by Git.

- VS Code's shared backend launch configuration loads the root `.env`.
- Vite is configured to read environment values from the repository root.
- Direct shell execution of Django requires the relevant environment variables to be exported first.

No production secret, device pairing token or local database should be committed to the repository.

## Local runtime data

The following are local/runtime state rather than source code:

- SQLite database files
- Python bytecode/cache directories
- `.env` files
- smart-device pairing tokens
- virtual environments
- `node_modules` and frontend build output

These are excluded through the repository `.gitignore`.

## Architectural principles

As HomeHub grows, changes should preserve these boundaries:

1. The frontend communicates with HomeHub through the backend API rather than directly with physical devices.
2. Django owns persistent HomeHub domain data.
3. Vendor/device protocol code stays behind integration-driver boundaries.
4. Secrets and machine-specific runtime state stay outside Git.
5. Environment-specific configuration stays out of application source where practical.
6. Shared project configuration committed to Git should be portable across developer machines.
