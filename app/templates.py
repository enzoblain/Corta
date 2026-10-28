"""Tiny template renderer: string.Template with systematic HTML escaping."""
import html
from pathlib import Path
from string import Template

TEMPLATES_DIR = Path(__file__).parent / "templates"


class Safe(str):
    """Marks a string as already-escaped HTML (e.g. a rendered sub-template)."""


def render(name: str, **context: object) -> Safe:
    raw = (TEMPLATES_DIR / name).read_text(encoding="utf-8")
    escaped = {
        k: v if isinstance(v, Safe) else html.escape(str(v), quote=True)
        for k, v in context.items()
    }
    return Safe(Template(raw).substitute(escaped))


def page(title: str, body: Safe, nav: Safe = Safe("")) -> Safe:
    return render("base.html", title=title, body=body, nav=nav)
