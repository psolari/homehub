# HomeHub

HomeHub is a local-first smart-home controller built with Django REST Framework and React/TypeScript. It provides one household interface for discovering, adding, monitoring and controlling different smart-device ecosystems while keeping vendor-specific protocol code out of the frontend.

## Current capabilities

- Automatic LAN discovery, with manual device onboarding as a fallback.
- Driver-driven setup wizards for pairing, local device credentials, cloud accounts and connection testing.
- Generic device capability/control API and generic React control rendering.
- LG webOS and Samsung Tizen TV control.
- iRobot Roomba cleaning controls and floor-plan location reporting where supported by the robot firmware.
- Sonos and Google Cast/Nest speaker control.
- Amazon Alexa/Echo control through the unofficial Alexa web API.
- Shared Spotify integration for search and Spotify Connect playback.
- Hive heating control.
- Ring camera/doorbell integration and camera snapshots.
- Ring Alarm control through a configurable MQTT bridge.
- Room-first interactive browser floor-plan editor with snapping, drag-resizing, a household-object library and linked devices.
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

Load the root environment file before running Django from a normal terminal:

```bash
set -a
source .env
set +a
```

The checked-in VS Code launch configuration loads the root `.env` automatically.

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

### Discovery-first setup

Discovery is the default workflow. HomeHub scans the local `/24` network unless a CIDR is supplied, probes known local protocols, uses Sonos/Cast discovery APIs, and queries configured Hive/Ring/Alexa accounts. A scan is capped at 512 hosts.

Selecting a discovered device opens its integration-specific setup wizard rather than immediately inserting it into the database. The wizard is generated from the backend driver contract and can request pairing approval, local credentials, cloud accounts, optional services such as Spotify and advanced integration settings.

For integrations that support an active connection test, **Test & add** must successfully pair/authenticate and read device state before the device is created. Failed onboarding therefore remains in the wizard and does not leave a new broken device row behind.

### Manual setup

Manual onboarding uses the same wizard. Choose a generic category or known driver, then complete the steps advertised by that driver. Generic devices can still be represented even when HomeHub does not have an active control protocol for them; those drivers deliberately skip the connection test rather than pretending control is available.

### Repairing an existing device

Devices already present in an error state display **Finish setup**. This reopens the same driver wizard with existing non-secret configuration prefilled. HomeHub exposes only the names of already-stored secret fields, so the wizard can preserve an encrypted token/password without revealing it to the browser.

### Examples

- **LG webOS** — supply the IP, approve HomeHub on the TV on first connection, and optionally add the MAC address for Wake-on-LAN.
- **Samsung Tizen** — supply the IP, approve the HomeHub pairing prompt, and HomeHub stores the resulting token encrypted; MAC is optional but required for Wake-on-LAN power-on.
- **Roomba** — supply the robot IP and BLID, then enter the local robot password or use the wizard's password-retrieval action while a supported robot is on its dock and in pairing mode. Local credential retrieval support varies by robot firmware/model.
- **Sonos / Google Cast** — verify the local speaker and optionally link a Spotify integration account.
- **Alexa / Hive / Ring** — choose or configure the relevant cloud integration account inside the wizard; device-specific account identifiers are normally supplied by cloud discovery.
- **Ring Alarm** — choose/configure the MQTT bridge and alarm topic; the setup test authenticates to the broker without sending an arm/disarm command.

## Cloud integrations

Cloud credentials can be managed either from **Integrations** or inline from a device setup wizard. Credentials are encrypted before they are stored in the database.

Spotify uses OAuth and Spotify Connect. Alexa and Ring rely on unofficial APIs and may require maintenance when their vendors change private endpoints. Ring Alarm panel control uses an MQTT bridge because the Python Ring integration does not expose general alarm-panel control.

## Floor plans

The SVG floor-plan editor is room-first: rooms have perimeter walls, can be dragged and resized by corner handles, and snap to neighbouring rooms, walls, grid positions and plan edges. Standalone walls have draggable endpoints. Doors/windows and other structural openings can snap to room boundaries. A searchable object library provides common structural, living-room, bedroom, kitchen, bathroom, office, utility, outdoor and decorative items.

Linked devices use the same generic control dialog as the dashboard. Devices that report coordinates, such as supported Roomba models, can override their static drawing position with the latest live position. Roomba scale/offset configuration maps robot coordinates to the floor-plan coordinate system.

## API

The supported API namespace is `/api/v1/`. Important resources include:

- `GET /api/v1/device-catalog/`
- `POST /api/v1/discovery/`
- `/api/v1/devices/`
- `POST /api/v1/devices/complete-setup/`
- `POST /api/v1/devices/setup-action/`
- `POST /api/v1/devices/{id}/setup/`
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

Device pairing tokens, Roomba credentials and integration-account credentials are encrypted at rest. Real environment files, runtime databases and token files are excluded from Git.

See [SECURITY.md](SECURITY.md) for credential/runtime guidance.

## Documentation

- [Architecture](docs/architecture.md)
- [Device integrations](docs/device-integrations.md)
- [Contributing](CONTRIBUTING.md)

## License

MIT. See [LICENSE](LICENSE).
