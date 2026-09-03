# HomeHub architecture

## Design principle

HomeHub separates household concepts from vendor protocols. React understands devices, state and generic controls; it does not know how Samsung, Sonos, Hive or Ring APIs work.

```text
React feature UI
      │
      ▼
shared API client
      │
      ▼
Django REST /api/v1
      │
      ▼
Device service layer
      │
      ▼
Integration registry ───── Integration accounts
      │                            │
      ▼                            ▼
Device driver              Spotify / Hive / Ring / Alexa
      │
      ▼
LAN or vendor service
```

## Backend domains

The Django application label remains `core` to preserve the original custom-user model and migration history. Internally it is divided into:

- `accounts/`: Django `User` model.
- `spaces/`: floor plans, rooms and floor-plan objects.
- `devices/`: devices, dashboard cards, integration accounts and location history.
- `integrations/`: protocol adapters and their registry.
- `services/`: discovery, orchestration and encrypted credential handling.

Django settings are separated into base, development and production modules.

## Device capability contract

Every integration subclasses `BaseDriver` and declares a stable driver key, generic HomeHub device type, configuration fields and generic controls. It implements state retrieval, action execution and optional camera-frame support.

The frontend renders control descriptors such as buttons, ranges, toggles, selects, text actions, media search and compound numeric actions through one shared `ControlPanel`. Vendor response formats are normalised into `Device.state` before reaching React.

## Discovery

Discovery combines:

1. bounded local CIDR probing for known protocol ports;
2. native Sonos discovery;
3. Google Cast mDNS discovery;
4. configured Hive, Ring and Alexa cloud account discovery.

Discovery returns normalised candidates. A candidate is not persisted until a household member selects **Add**.

## Floor plans

A `FloorPlan` defines an SVG coordinate system. `FloorPlanObject` stores object type, coordinates, dimensions, rotation, z-order, properties and an optional device relationship.

Static objects use saved coordinates. When a linked device reports `state.location`, the UI renders that live position instead. `DeviceLocation` stores location history independently of the drawing, allowing future moving devices to reuse the same model.

## Dashboard

Each device receives a `DashboardCard` with enabled state, card size/order and the controls exposed on the compact card. The user can choose those controls in the UI. Everything else remains available in the generic full-device modal.

## Authentication

The backend retains its custom `User` model for future household accounts. The current REST API uses `AllowAny` and the React login flow is removed. This is intentionally a trusted-LAN deployment model, not an Internet-facing security model.

## Runtime secrets

Cloud account credentials and device pairing secrets are encrypted before database storage. Runtime pairing files live under `HOMEHUB_RUNTIME_DIR`, outside source control. Environment configuration is supplied through process environment variables and `.env` is ignored by Git.
