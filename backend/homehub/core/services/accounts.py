from __future__ import annotations
from typing import Any
from homehub.core.models import IntegrationAccount
from homehub.core.services.crypto import decrypt_json, encrypt_json


def get_credentials(account: IntegrationAccount) -> dict[str, Any]:
    return decrypt_json(account.encrypted_credentials)


def set_credentials(account: IntegrationAccount, credentials: dict[str, Any], *, merge: bool = True, save: bool = True) -> dict[str, Any]:
    current = get_credentials(account) if merge and account.encrypted_credentials else {}
    current.update({k: v for k, v in credentials.items() if v is not None and v != ""})
    account.encrypted_credentials = encrypt_json(current) if current else ""
    if save:
        account.save(update_fields=["encrypted_credentials"])
    return current


def get_active_account(provider: str, account_id: int | None = None) -> IntegrationAccount:
    queryset = IntegrationAccount.objects.filter(provider=provider, active=True)
    if account_id is not None:
        queryset = queryset.filter(pk=account_id)
    account = queryset.first()
    if account is None:
        raise IntegrationAccount.DoesNotExist(f"No active {provider} integration account is configured.")
    return account

get_account_credentials = get_credentials
set_account_credentials = set_credentials
