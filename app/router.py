"""Minimal router: (method, path) -> handler, with HTML and JSON responses."""
import json
from dataclasses import dataclass, field
from http.cookies import SimpleCookie
from typing import Any, Callable
from urllib.parse import parse_qs


@dataclass
class Request:
    method: str
    path: str
    query: dict[str, list[str]] = field(default_factory=dict)
    headers: dict[str, str] = field(default_factory=dict)
    body: bytes = b""

    @property
    def cookies(self) -> dict[str, str]:
        c: SimpleCookie = SimpleCookie()
        c.load(self.headers.get("cookie", ""))
        return {k: m.value for k, m in c.items()}

    @property
    def form(self) -> dict[str, str]:
        parsed = parse_qs(self.body.decode("utf-8", "replace"), keep_blank_values=True)
        return {k: v[0] for k, v in parsed.items()}


@dataclass
class Response:
    status: int = 200
    body: bytes = b""
    headers: list[tuple[str, str]] = field(default_factory=list)
    content_type: str = "text/html; charset=utf-8"


def html_response(body: str, status: int = 200) -> Response:
    return Response(status, body.encode("utf-8"))


def json_response(data: Any, status: int = 200) -> Response:
    return Response(status, json.dumps(data).encode("utf-8"), content_type="application/json")


def redirect(location: str, headers: list[tuple[str, str]] | None = None) -> Response:
    return Response(303, b"", [("Location", location)] + (headers or []))


Handler = Callable[[Request], Response]


class Router:
    def __init__(self) -> None:
        self._routes: dict[tuple[str, str], tuple[Handler, bool]] = {}

    def add(self, method: str, path: str, handler: Handler, public: bool = False) -> None:
        self._routes[(method.upper(), path)] = (handler, public)

    def route(self, method: str, path: str, public: bool = False) -> Callable[[Handler], Handler]:
        def deco(fn: Handler) -> Handler:
            self.add(method, path, fn, public)
            return fn
        return deco

    def resolve(self, method: str, path: str) -> tuple[Handler, bool] | None:
        return self._routes.get((method.upper(), path))

    def has_path(self, path: str) -> bool:
        return any(p == path for _, p in self._routes)
