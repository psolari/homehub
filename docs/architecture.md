# HomeHub architecture

## Design principle

HomeHub separates household concepts from vendor protocols. React understands devices, state, generic controls and generic setup metadata; it does not know how Samsung, Sonos, Hive, Ring or Roomba APIs work.

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
Device/setup service layer
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
- `integrations/`: protocol adapters, provider definitions and their registry.
- `services/`: discovery, setup/control orchestration and encrypted credential handling.

Django settings are separated into base, development and production modules.

## Device capability and setup contract

Every integration subclasses `BaseDriver` and declares a stable driver key, generic HomeHub device type, configuration fields and generic controls. It implements state retrieval, action execution and optional camera-frame support.

Drivers also publish `setup_schema`. This tells the generic React setup wizard whether the integration requires an IP or MAC address, what pairing instructions to show, which cloud account is required, which optional accounts/services may be linked, which fields are advanced, whether safe setup actions are available, and whether the final connection test must succeed.

The frontend renders control descriptors such as buttons, ranges, toggles, selects, text actions, media search and compound numeric actions through one shared `ControlPanel`. Vendor response formats are normalised into `Device.state` before reaching React.

## Discovery and onboarding

Discovery combines:

1. bounded local CIDR probing for known protocol ports;
2. native Sonos discovery;
3. Google Cast mDNS discovery;
4. configured Hive, Ring and Alexa cloud account discovery.

Discovery returns normalised candidates. Discovery and persistence are intentionally separate: selecting a candidate opens `DeviceSetupWizard` rather than immediately creating a `Device` row.

The wizard is shared by discovered devices, manual additions and existing-device reconfiguration:

1. Identify/select the generic device type and integration.
2. Collect required network identity and show driver-specific physical pairing instructions.
3. Select or configure required cloud integration accounts and optional services such as Spotify.
4. Collect integration-specific configuration and encrypted secret fields. Safe pre-creation helpers can run here, such as supported Roomba local-password retrieval.
5. Run **Test & add** through `/api/v1/devices/complete-setup/`.

For drivers requiring an active test, device creation is transactional: pairing/authentication/state retrieval must succeed before the database insert commits. A failed setup therefore stays in the wizard and does not create another broken device row.

Existing devices use `/api/v1/devices/{id}/setup/`. Devices in an error state expose **Finish setup** while healthy devices expose **Reconfigure**. Previously stored secrets can be preserved without returning their values to the browser.

## Secret handling

Cloud account credentials and device pairing secrets are encrypted before database storage. Driver fields marked `secret` are separated from public `Device.config` into `Device.encrypted_credentials`.

The API never returns decrypted device secrets. It only exposes `configured_credentials`, a list of secret field names already stored. The setup wizard can therefore display “already configured” and omit a blank secret value to preserve it.

Runtime pairing files live under `HOMEHUB_RUNTIME_DIR`, outside source control. Environment configuration is supplied through process environment variables and `.env` is ignored by Git.

## Floor plans

A `FloorPlan` defines an SVG coordinate system. `Room` is a first-class room primitive with geometry and perimeter-wall properties. `FloorPlanObject` stores standalone structural/furniture objects, coordinates, dimensions, rotation, z-order, properties and an optional device relationship.

Interactive editing — room snapping, wall endpoint snapping, alignment guides and corner resize handles — remains in React for responsive pointer behaviour. Django stores the resulting geometry.

Static device objects use saved coordinates. When a linked device reports `state.location`, the UI renders that live position instead. `DeviceLocation` stores location history independently of the drawing, allowing future moving devices to reuse the same model.

## Dashboard

Each device receives a `DashboardCard` with enabled state, card size/order and the controls exposed on the compact card. The user can choose those controls in the UI. Everything else remains available in the generic full-device modal.

## Authentication

The backend retains its custom `User` model for future household accounts. The current REST API uses `AllowAny` and the React login flow is removed. This is intentionally a trusted-LAN deployment model, not an Internet-facing security model.

## Validation

GitHub Actions validates Django system checks, migration consistency, backend tests and critical Ruff checks, plus frontend ESLint, unit tests and a full TypeScript/Vite production build. The automated suite validates HomeHub's setup contracts without real household credentials; physical-device/account validation remains installation-specific.
