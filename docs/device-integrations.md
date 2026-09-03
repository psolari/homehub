# Device integrations

HomeHub keeps vendor-specific smart-device communication in backend integration modules so the REST API and React frontend do not need to understand vendor protocols.

This document describes the integration convention that exists today. It should be updated as the integration layer becomes more generic.

## Current location

Device integration code currently lives under:

```text
backend/homehub/core/device_modules/
├── device_schema.py
└── tv/
    ├── __init__.py
    ├── default.py
    ├── lg.py
    └── samsung.py
```

Runtime pairing tokens may be created under `tv/tokens/`, but that directory is intentionally ignored by Git and must never contain committed credentials.

## TV driver contract

`tv/default.py` defines the current base `TvDriver` interface. Vendor drivers implement the operations expected by HomeHub, including connection initialization and common TV controls.

The current driver selection flow is:

```text
Device model value
      |
      v
get_tv_driver(...)
      |
      v
vendor TvDriver class
      |
      v
physical TV
```

`tv/__init__.py` maps supported model identifiers to Python modules and imports the corresponding `TvDriver` implementation.

## Existing TV integrations

### Samsung

`tv/samsung.py` uses the Samsung TV websocket library. Pairing state is stored as a local token file generated for the TV.

Pairing tokens are runtime credentials. They must remain outside version control and should be treated as compromised if accidentally published.

### LG

`tv/lg.py` contains the LG/webOS integration boundary and communicates with the TV over its websocket interface.

## Adding another TV integration

Under the current structure, a new TV integration should:

1. Create a module under `core/device_modules/tv/`, for example `sony.py`.
2. Implement the `TvDriver` contract defined in `default.py`.
3. Keep vendor SDK/protocol details inside that module.
4. Add the model identifier to the driver map in `tv/__init__.py`.
5. Add the corresponding display/configuration schema to `device_schema.py` when needed.
6. Keep credentials, pairing tokens and generated runtime files outside Git.

The API layer should select the driver through the integration registry rather than importing a vendor driver directly.

## Integration design rules

When adding integrations, follow these boundaries:

- **No vendor protocol logic in React.** The frontend should call HomeHub's API.
- **No secrets in source control.** Tokens and credentials are runtime configuration/state.
- **Keep drivers isolated.** Samsung-specific logic belongs in the Samsung driver, LG-specific logic in the LG driver, and so on.
- **Expose HomeHub-level operations.** The rest of the application should work with concepts such as power, mute and volume rather than raw vendor protocol messages.
- **Fail at the integration boundary.** Device/network failures should be translated into predictable HomeHub responses rather than leaking vendor-library exceptions throughout the application.
- **Avoid machine-specific paths.** Runtime files should use application-controlled locations and ignored directories.

## Future evolution

The current registry is TV-specific. As HomeHub adds speakers, appliances, lights and other categories, the integration layer should evolve toward a category-agnostic registry and shared base contracts. That refactor is intentionally outside the repository-foundation work described here.
