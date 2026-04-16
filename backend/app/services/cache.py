import threading
import time
from typing import Any

CACHE_VERSION = "v2"
MAX_SIZE = 500
_store: dict[str, tuple[Any, float]] = {}
_lock = threading.Lock()


def _cleanup_expired():
    """Remove all expired entries from the store."""
    now = time.time()
    expired = [k for k, (_, exp) in _store.items() if now > exp]
    for k in expired:
        _store.pop(k, None)


def _evict_expired():
    """Remove expired entries if store exceeds max size."""
    if len(_store) <= MAX_SIZE:
        return
    _cleanup_expired()
    # If still over limit, remove oldest entries
    if len(_store) > MAX_SIZE:
        sorted_keys = sorted(_store, key=lambda k: _store[k][1])
        for k in sorted_keys[:len(_store) - MAX_SIZE]:
            del _store[k]


def get(key: str) -> Any | None:
    with _lock:
        entry = _store.get(key)
        if entry is None:
            return None
        value, expiry = entry
        if time.time() > expiry:
            _store.pop(key, None)
            return None
        return value


def set(key: str, value: Any, ttl: int) -> None:
    with _lock:
        _store[key] = (value, time.time() + ttl)
        if len(_store) > MAX_SIZE // 2:
            _cleanup_expired()
        _evict_expired()


def delete(key: str) -> None:
    with _lock:
        _store.pop(key, None)


def clear() -> None:
    with _lock:
        _store.clear()


def make_key(*parts) -> str:
    """Build a versioned cache key."""
    return f"{CACHE_VERSION}:" + ":".join(str(p) for p in parts)
