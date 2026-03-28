import time
from typing import Any

MAX_SIZE = 500
_store: dict[str, tuple[Any, float]] = {}


def _evict_expired():
    """Remove expired entries if store exceeds max size."""
    if len(_store) <= MAX_SIZE:
        return
    now = time.time()
    expired = [k for k, (_, exp) in _store.items() if now > exp]
    for k in expired:
        del _store[k]
    # If still over limit, remove oldest entries
    if len(_store) > MAX_SIZE:
        sorted_keys = sorted(_store, key=lambda k: _store[k][1])
        for k in sorted_keys[:len(_store) - MAX_SIZE]:
            del _store[k]


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
    _evict_expired()


def delete(key: str) -> None:
    _store.pop(key, None)


def clear() -> None:
    _store.clear()
