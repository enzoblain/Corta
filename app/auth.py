"""Single-password auth with an HMAC-signed session cookie."""
import hashlib
import hmac
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
