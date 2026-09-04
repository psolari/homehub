from __future__ import annotations

import ipaddress
import re
import socket
import subprocess
from pathlib import Path

_MAC_RE = re.compile(r"(?i)\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b")


def _normalise_mac(value: str | None) -> str | None:
    if not value:
        return None
    match = _MAC_RE.search(value)
    if not match:
        return None
    mac = match.group(0).replace("-", ":").lower()
    if mac == "00:00:00:00:00:00":
        return None
    return mac


def _prime_neighbour_cache(ip: str) -> None:
    """Cause the OS to resolve the local L2 neighbour without requiring ping/root."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(0.25)
    try:
        # A TCP connection attempt is enough to trigger ARP/ND resolution even
        # when the destination port is closed.
        sock.connect_ex((ip, 9))
    except OSError:
        pass
    finally:
        sock.close()


def _linux_proc_arp(ip: str) -> str | None:
    path = Path("/proc/net/arp")
    if not path.exists():
        return None
    try:
        for line in path.read_text().splitlines()[1:]:
            fields = line.split()
            if fields and fields[0] == ip and len(fields) >= 4:
                mac = _normalise_mac(fields[3])
                if mac:
                    return mac
    except OSError:
        pass
    return None


def _command_output(command: list[str]) -> str:
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=1,
            check=False,
        )
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
        return ""
    return f"{result.stdout}\n{result.stderr}"


def resolve_mac_address(ip: str | None, *, prime: bool = True) -> str | None:
    """Best-effort MAC discovery for a directly reachable IPv4 LAN device.

    HomeHub first causes the host OS to resolve the neighbour, then reads the
    platform neighbour/ARP table. This works without elevated privileges on
    typical Linux and macOS HomeHub hosts. Routed/cloud devices intentionally
    return no MAC because a remote MAC is not visible across a router.
    """
    if not ip:
        return None
    try:
        address = ipaddress.ip_address(str(ip))
    except ValueError:
        return None
    if address.version != 4 or address.is_loopback:
        return None

    value = str(address)
    if prime:
        _prime_neighbour_cache(value)

    proc_mac = _linux_proc_arp(value)
    if proc_mac:
        return proc_mac

    for command in (
        ["ip", "neigh", "show", value],
        ["arp", "-n", value],
        ["arp", value],
    ):
        output = _command_output(command)
        if value not in output:
            continue
        mac = _normalise_mac(output)
        if mac:
            return mac
    return None
