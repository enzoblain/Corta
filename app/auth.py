"""Single-password auth with an HMAC-signed session cookie."""
import hashlib
import hmac
import threading
import time

COOKIE_NAME = "session"


def check_password(candidate: str, expected: str) -> bool:
    # Compare digests so length differences don't leak and the compare is constant time.
    a = hashlib.sha256(candidate.encode()).digest()
    b = hashlib.sha256(expected.encode()).digest()
    return hmac.compare_digest(a, b)


def _sign(secret: str, payload: str) -> str:
    return hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()


def make_session(secret: str, ttl: int, now: float | None = None) -> str:
    expires = str(int((time.time() if now is None else now) + ttl))
    return f"{expires}.{_sign(secret, expires)}"


def verify_session(secret: str, value: str | None, now: float | None = None) -> bool:
    if not value or "." not in value:
        return False
    expires, sig = value.split(".", 1)
    if not hmac.compare_digest(_sign(secret, expires), sig):
        return False
    try:
        return int(expires) > (time.time() if now is None else now)
    except ValueError:
        return False


def cookie_header(value: str, max_age: int, secure: bool) -> str:
    parts = [f"{COOKIE_NAME}={value}", "Path=/", "HttpOnly", "SameSite=Lax", f"Max-Age={max_age}"]
    if secure:
        parts.append("Secure")
    return "; ".join(parts)


class LoginLimiter:
    """In-memory brute-force guard: max_failures failed logins per key within window seconds."""

    def __init__(self, max_failures: int = 5, window: int = 15 * 60) -> None:
        self.max_failures = max_failures
        self.window = window
        self._failures: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def _recent(self, key: str, now: float) -> list[float]:
        recent = [t for t in self._failures.get(key, []) if now - t < self.window]
        if recent:
            self._failures[key] = recent
        else:
            self._failures.pop(key, None)
        return recent

    def is_blocked(self, key: str, now: float | None = None) -> bool:
        with self._lock:
            return len(self._recent(key, time.time() if now is None else now)) >= self.max_failures

    def record_failure(self, key: str, now: float | None = None) -> None:
        now = time.time() if now is None else now
        with self._lock:
            self._recent(key, now)
            self._failures.setdefault(key, []).append(now)

    def reset(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)
