import time
from typing import Any


_store: dict[str, tuple[Any, float]] = {}


def get(key: str) -> Any | None:
    entry = _store.get(key)
    if entry is None:
        return None
    value, expiry = entry
    if time.time() > expiry:
        del _store[key]
        return None
    return value


def set(key: str, value: Any, ttl: int) -> None:
    _store[key] = (value, time.time() + ttl)


def delete(key: str) -> None:
    _store.pop(key, None)


def clear() -> None:
    _store.clear()
