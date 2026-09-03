# HomeHub

HomeHub is a local-first smart-home controller built with Django REST Framework and React/TypeScript. It provides one household interface for discovering, adding, monitoring and controlling different smart-device ecosystems while keeping vendor-specific protocol code out of the frontend.

## Current capabilities

- Automatic LAN discovery, with manual device onboarding as a fallback.
- Generic device capability/control API and generic React control rendering.
- LG webOS and Samsung Tizen TV control.
- iRobot Roomba cleaning controls and floor-plan location reporting where supported by the robot firmware.
- Sonos and Google Cast/Nest speaker control.
- Amazon Alexa/Echo control through the unofficial Alexa web API.
- Shared Spotify integration for search and Spotify Connect playback.
- Hive heating control.
- Ring camera/doorbell integration and camera snapshots.
- Ring Alarm control through a configurable MQTT bridge.
- Interactive browser floor-plan editor with walls, doors, windows, furniture and linked devices.
- Live device state on floor plans, including moving-device coordinates supplied by integrations.
- Customisable Home Assistant-style dashboard cards with selectable quick controls and full control dialogs.
- Django users remain in the backend for future use, but household mode currently has no frontend login gate.

## Repository structure

```text
homehub/
├── backend/
│   ├── homehub/
│   │   ├── core/
│   │   │   ├── accounts/
│   │   │   ├── devices/
│   │   │   ├── spaces/
│   │   │   ├── integrations/
│   │   │   ├── services/
│   │   │   └── tests/
│   │   └── smart_home_backend/
│   │       └── settings/
│   ├── requirements-integrations.txt
│   └── requirements-dev.txt
├── frontend/
│   └── src/
│       ├── app/
│       ├── features/
│       └── shared/
├── docs/
└── .github/workflows/ci.yml
```

## Prerequisites

- Python 3.11+
- Poetry 2.x
- Node.js 22+
- npm

Most smart-home integrations require the HomeHub backend to run on the same LAN as the devices it controls.

## Setup

```bash
git clone https://github.com/psolari/homehub.git
cd homehub
cp .env.example .env
```

Set `DJANGO_SECRET_KEY` in `.env`. For long-lived installations also set a persistent Fernet key in `HOMEHUB_ENCRYPTION_KEY` so encrypted integration credentials remain decryptable if the Django secret changes.

Install the backend:

```bash
cd backend
poetry install
poetry run pip install -r requirements-integrations.txt -r requirements-dev.txt
poetry run python homehub/manage.py migrate
cd ..
```

Install the frontend:

```bash
cd frontend
npm ci
cd ..
```

Load the root environment file before running Django:

```bash
set -a
source .env
set +a
```

Backend:

```bash
cd backend
poetry run python homehub/manage.py runserver 0.0.0.0:8000
```

Frontend:

```bash
cd frontend
npm run dev -- --host 0.0.0.0
```

Open `http://localhost:5173`.

## Device onboarding

### Discovery

Discovery is the default workflow. HomeHub scans the local `/24` network unless a CIDR is supplied, probes known local protocols, uses Sonos/Cast discovery APIs, and queries configured Hive/Ring/Alexa accounts. A scan is capped at 512 hosts.

### Manual

Manual onboarding lets you select a generic device category or a known integration, then enter the address and integration-specific configuration. Generic devices are accepted even when HomeHub does not have an active control protocol for them.

## Cloud integrations

Open **Integrations** in the frontend. Credentials are encrypted before they are stored in the database.

Spotify uses OAuth and Spotify Connect. Alexa and Ring rely on unofficial APIs and may require maintenance when their vendors change private endpoints. Ring Alarm panel control uses an MQTT bridge because the Python Ring integration does not expose general alarm-panel control.

## Floor plans

The SVG floor-plan editor stores walls, doors, windows, sofas, tables, labels and linked devices in Django. Linked devices use the same generic control dialog as the dashboard. Devices that report coordinates, such as supported Roomba models, can override their static drawing position with the latest live position. Roomba scale/offset configuration maps robot coordinates to the floor-plan coordinate system.

## API

The supported API namespace is `/api/v1/`. Important resources include:

- `GET /api/v1/device-catalog/`
- `POST /api/v1/discovery/`
- `/api/v1/devices/`
- `POST /api/v1/devices/{id}/control/`
- `POST /api/v1/devices/{id}/refresh/`
- `GET /api/v1/devices/{id}/camera-frame/`
- `/api/v1/floor-plans/`
- `/api/v1/floor-plan-objects/`
- `/api/v1/dashboard-cards/`
- `/api/v1/integration-accounts/`
- `GET /api/v1/provider-catalog/`

`/api/` remains as a temporary compatibility alias.

## Quality checks

```bash
make test
make lint
```

CI runs Django checks, migration consistency, backend tests and critical Ruff checks, then frontend ESLint, unit tests and the TypeScript/Vite production build.

## Security model

The current frontend deliberately has no login because it is intended for trusted household access. Do not expose HomeHub directly to the public Internet. Use a trusted LAN or VPN until household authentication and permissions are introduced.

See [SECURITY.md](SECURITY.md) for credential/runtime guidance.

## Documentation

- [Architecture](docs/architecture.md)
- [Device integrations](docs/device-integrations.md)
- [Contributing](CONTRIBUTING.md)

## License

MIT. See [LICENSE](LICENSE).
