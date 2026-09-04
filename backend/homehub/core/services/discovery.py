from __future__ import annotations

import concurrent.futures
import ipaddress
import socket
from dataclasses import asdict, dataclass
from typing import Any

from homehub.core.models import Device
from homehub.core.services.network import resolve_mac_address


@dataclass
class Candidate:
    unique_id: str
    name: str
    device_type: str
    model: str
    manufacturer: str = ""
    hardware_model: str = ""
    ip_address: str | None = None
    mac_address: str | None = None
    config: dict[str, Any] | None = None
    discovery_data: dict[str, Any] | None = None
    source: str = "discovery"

    def as_dict(self):
        return {k: v for k, v in asdict(self).items() if v not in (None, "")}


def _candidate_identity(candidate: Candidate) -> tuple[str, ...]:
    """Return a stable physical identity for discovery de-duplication."""
    model = candidate.model or candidate.device_type
    if candidate.ip_address:
        return ("ip", candidate.ip_address, model)
    if candidate.mac_address:
        return ("mac", candidate.mac_address.lower(), model)
    return ("uid", candidate.unique_id)


def _candidate_quality(candidate: Candidate) -> int:
    method = str((candidate.discovery_data or {}).get("method") or "")
    # Prefer native discovery, because it usually carries the canonical name,
    # UUID/UID and model metadata. TCP probing is intentionally the fallback.
    return 0 if method == "tcp_probe" else 10


def _merge_candidate(preferred: Candidate, fallback: Candidate) -> Candidate:
    """Keep the richer candidate while filling any useful missing fields."""
    if _candidate_quality(fallback) > _candidate_quality(preferred):
        preferred, fallback = fallback, preferred
    for field in (
        "name",
        "manufacturer",
        "hardware_model",
        "ip_address",
        "mac_address",
        "config",
        "discovery_data",
    ):
        if getattr(preferred, field) in (None, "", {}):
            setattr(preferred, field, getattr(fallback, field))
    return preferred


def _dedupe_candidates(candidates: list[Candidate]) -> list[Candidate]:
    by_identity: dict[tuple[str, ...], Candidate] = {}
    for candidate in candidates:
        identity = _candidate_identity(candidate)
        if identity in by_identity:
            by_identity[identity] = _merge_candidate(by_identity[identity], candidate)
        else:
            by_identity[identity] = candidate
    return list(by_identity.values())


def _is_already_configured(candidate: Candidate) -> bool:
    queryset = Device.objects.all()
    if candidate.unique_id and queryset.filter(unique_id=candidate.unique_id).exists():
        return True
    if candidate.ip_address and queryset.filter(
        ip_address=candidate.ip_address,
        model=candidate.model,
    ).exists():
        return True
    if candidate.mac_address and queryset.filter(
        mac_address__iexact=candidate.mac_address,
        model=candidate.model,
    ).exists():
        return True
    return False


def local_ipv4() -> str:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        sock.close()


def default_network() -> str:
    ip = local_ipv4()
    if ip.startswith("127."):
        return "127.0.0.0/32"
    return str(ipaddress.ip_network(f"{ip}/24", strict=False))


def _port_open(ip: str, port: int, timeout: float = 0.18) -> bool:
    try:
        with socket.create_connection((ip, port), timeout=timeout):
            return True
    except OSError:
        return False


def _probe_host(ip: str) -> list[Candidate]:
    matches: list[Candidate] = []
    checks = {
        3000: ("tv", "lg_webos", "LG", "LG webOS TV"),
        8001: ("tv", "samsung_tizen", "Samsung", "Samsung TV"),
        8002: ("tv", "samsung_tizen", "Samsung", "Samsung TV"),
        1400: ("speaker", "sonos", "Sonos", "Sonos Speaker"),
        8009: ("speaker", "google_cast", "Google", "Google Cast device"),
        8883: ("vacuum", "irobot_roomba", "iRobot", "Roomba"),
    }
    seen: set[str] = set()
    for port, (device_type, model, manufacturer, label) in checks.items():
        if model in seen or not _port_open(ip, port):
            continue
        seen.add(model)
        matches.append(
            Candidate(
                unique_id=f"{model}:{ip}",
                name=f"{label} ({ip})",
                device_type=device_type,
                model=model,
                manufacturer=manufacturer,
                ip_address=ip,
                discovery_data={"method": "tcp_probe", "port": port},
            )
        )
    if matches:
        mac = resolve_mac_address(ip, prime=False)
        if mac:
            for candidate in matches:
                candidate.mac_address = mac
    return matches


def _discover_sonos() -> list[Candidate]:
    try:
        import soco

        devices = soco.discover(timeout=2) or []
    except Exception:
        return []

    result: list[Candidate] = []
    for speaker in devices:
        hardware_model = ""
        try:
            hardware_model = speaker.get_speaker_info(timeout=2).get("model_name", "")
        except Exception:
            pass
        result.append(
            Candidate(
                unique_id=f"sonos:{speaker.uid or speaker.ip_address}",
                name=speaker.player_name or f"Sonos {speaker.ip_address}",
                device_type="speaker",
                model="sonos",
                manufacturer="Sonos",
                ip_address=speaker.ip_address,
                hardware_model=hardware_model,
                discovery_data={"method": "sonos_ssdp", "uid": getattr(speaker, "uid", None)},
            )
        )
    return result


def _discover_cast() -> list[Candidate]:
    try:
        import pychromecast

        casts, browser = pychromecast.get_chromecasts(timeout=3)
    except Exception:
        return []
    try:
        result: list[Candidate] = []
        for cast in casts:
            info = cast.cast_info
            host = getattr(info, "host", None)
            uuid = str(getattr(info, "uuid", ""))
            friendly_name = getattr(info, "friendly_name", None) or f"Google Cast {host}"
            result.append(
                Candidate(
                    unique_id=f"cast:{uuid or host}",
                    name=friendly_name,
                    device_type="speaker",
                    model="google_cast",
                    manufacturer="Google",
                    hardware_model=getattr(info, "model_name", "") or "",
                    ip_address=host,
                    config={"friendly_name": friendly_name},
                    discovery_data={"method": "mdns", "uuid": uuid},
                )
            )
        return result
    finally:
        try:
            pychromecast.discovery.stop_discovery(browser)
        except Exception:
            pass


def discover_network(cidr: str | None = None, *, max_hosts: int = 512) -> list[dict[str, Any]]:
    network = ipaddress.ip_network(cidr or default_network(), strict=False)
    hosts = [str(host) for host in network.hosts()]
    if len(hosts) > max_hosts:
        raise ValueError(f"Discovery is limited to {max_hosts} hosts per scan")

    candidates: list[Candidate] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(64, max(1, len(hosts)))) as pool:
        for found in pool.map(_probe_host, hosts):
            candidates.extend(found)
    candidates.extend(_discover_sonos())
    candidates.extend(_discover_cast())

    candidates = _dedupe_candidates(candidates)
    return [candidate.as_dict() for candidate in candidates if not _is_already_configured(candidate)]


def _discover_hive_account(account) -> list[Candidate]:
    from homehub.core.services.accounts import get_credentials
    from homehub.core.services.devices import run_async

    async def discover():
        try:
            from apyhiveapi import Auth, Hive

            credentials = get_credentials(account)
            auth = Auth(credentials.get("username", ""), credentials.get("password", ""))
            tokens = await auth.login()
            hive = Hive(tokens)
            await hive.startSession(tokens)
            data = getattr(getattr(hive, "session", None), "data", None)
            devices = getattr(data, "devices", data) or []
            values = devices.values() if isinstance(devices, dict) else devices
            result: list[Candidate] = []
            for device in values:
                if isinstance(device, dict):
                    device_id = device.get("id") or device.get("device_id")
                    name = device.get("name") or device.get("hiveType") or "Hive Heating"
                    type_name = str(device.get("type") or device.get("hiveType") or "").lower()
                else:
                    device_id = getattr(device, "id", getattr(device, "device_id", None))
                    name = getattr(device, "name", "Hive Heating")
                    type_name = str(getattr(device, "type", getattr(device, "hiveType", ""))).lower()
                if not device_id or not any(word in type_name for word in ("heat", "thermostat", "zone")):
                    continue
                result.append(
                    Candidate(
                        unique_id=f"hive:{device_id}",
                        name=str(name),
                        device_type="thermostat",
                        model="hive_heating",
                        manufacturer="Hive",
                        source="cloud",
                        config={"account_id": account.id, "hive_device_id": str(device_id)},
                        discovery_data={"method": "hive_cloud"},
                    )
                )
            return result
        except Exception:
            return []

    return run_async(discover())


def _discover_alexa_account(account) -> list[Candidate]:
    from homehub.core.services.accounts import get_credentials
    from homehub.core.services.devices import run_async

    async def discover():
        try:
            from alexapy import AlexaAPI, AlexaLogin

            credentials = get_credentials(account)
            login = AlexaLogin(
                url=credentials.get("url", "amazon.co.uk"),
                email=credentials.get("email", ""),
                password=credentials.get("password", ""),
                outputpath=None,
                otp_secret=credentials.get("otp_secret"),
            )
            await login.login(cookies=credentials.get("cookies"))
            devices = await AlexaAPI.get_devices(login)
            result: list[Candidate] = []
            for device in devices or []:
                serial = device.get("serialNumber") or device.get("serial_number")
                if not serial:
                    continue
                result.append(
                    Candidate(
                        unique_id=f"alexa:{serial}",
                        name=device.get("accountName") or device.get("name") or "Alexa",
                        device_type="speaker",
                        model="alexa_echo",
                        manufacturer="Amazon",
                        hardware_model=device.get("deviceType") or "",
                        source="cloud",
                        config={"account_id": account.id, "serial_number": serial},
                        discovery_data={"method": "alexa_cloud", "device_family": device.get("deviceFamily")},
                    )
                )
            return result
        except Exception:
            return []

    return run_async(discover())


def _discover_ring_account(account) -> list[Candidate]:
    from homehub.core.services.accounts import get_credentials, set_credentials
    from homehub.core.services.devices import run_async

    async def discover():
        try:
            from ring_doorbell import Auth, Ring

            credentials = get_credentials(account)

            def token_updated(token):
                credentials["token"] = token
                set_credentials(account, credentials)

            auth = Auth("HomeHub/1.0", credentials.get("token"), token_updated)
            if not credentials.get("token"):
                await auth.async_fetch_token(
                    credentials.get("username", ""),
                    credentials.get("password", ""),
                    credentials.get("otp"),
                )
            ring = Ring(auth)
            if hasattr(ring, "async_create_session"):
                await ring.async_create_session()
            if hasattr(ring, "async_update_data"):
                await ring.async_update_data()
            devices = ring.devices()
            if hasattr(devices, "__await__"):
                devices = await devices
            result: list[Candidate] = []
            if isinstance(devices, dict):
                for family, family_devices in devices.items():
                    for device in family_devices or []:
                        device_id = getattr(
                            device,
                            "device_id",
                            getattr(device, "id", getattr(device, "account_id", None)),
                        )
                        if not device_id:
                            continue
                        result.append(
                            Candidate(
                                unique_id=f"ring:{device_id}",
                                name=getattr(device, "name", None) or f"Ring {family}",
                                device_type="camera",
                                model="ring_camera",
                                manufacturer="Ring",
                                hardware_model=str(getattr(device, "model", "") or ""),
                                source="cloud",
                                config={
                                    "account_id": account.id,
                                    "ring_device_id": str(device_id),
                                    "family": family,
                                },
                                discovery_data={"method": "ring_cloud", "family": family},
                            )
                        )
            return result
        except Exception:
            return []

    return run_async(discover())


def discover_cloud_accounts() -> list[dict[str, Any]]:
    from homehub.core.models import IntegrationAccount

    handlers = {
        "hive": _discover_hive_account,
        "alexa": _discover_alexa_account,
        "ring": _discover_ring_account,
    }
    candidates: list[Candidate] = []
    for account in IntegrationAccount.objects.filter(active=True):
        handler = handlers.get(account.provider)
        if handler:
            candidates.extend(handler(account))
    candidates = _dedupe_candidates(candidates)
    return [candidate.as_dict() for candidate in candidates if not _is_already_configured(candidate)]


def discover_all(cidr: str | None = None, *, include_cloud: bool = True) -> dict[str, Any]:
    local = discover_network(cidr)
    cloud = discover_cloud_accounts() if include_cloud else []
    # Local and cloud results can occasionally describe the same integration
    # through different discovery routes. Prefer one physical device card.
    combined = [Candidate(**item) for item in [*local, *cloud]]
    devices = [candidate.as_dict() for candidate in _dedupe_candidates(combined)]
    return {"network": cidr or default_network(), "devices": devices}
