"""Claude Messages API client (server-side only) and strict parsing of its JSON answer."""
import json
import logging
import urllib.error
import urllib.request
from dataclasses import dataclass

API_URL = "https://api.anthropic.com/v1/messages"
MODEL = "claude-haiku-5-5"
TIMEOUT = 15  # seconds
MAX_TAGS = 3
log = logging.getLogger("corta")


class AIError(Exception):
    """The AI is unavailable or its answer is unusable (message is safe to show)."""


@dataclass(frozen=True)
class Suggestion:
    title: str
    content: str
    project_id: int | None  # existing project, or None
    new_project: str  # name of a proposed new project, "" if none
    tags: list[str]


def build_prompt(raw_text: str, projects: list[tuple[int, str]], tags: list[str]) -> str:
    project_lines = "\n".join(f"- {pid}: {name}" for pid, name in projects) or "(none)"
    return (
        "You organise ideas for a personal knowledge base. The user wrote a raw idea; "
        "rewrite it and decide where to file it. Reply in the language of the idea.\n\n"
        f"Existing projects (id: name):\n{project_lines}\n\n"
        f"Existing tags: {', '.join(tags) or '(none)'}\n\n"
        "Rules:\n"
        "- Strongly prefer an existing project. Propose a new project only if none fits.\n"
        f"- Give 1 to {MAX_TAGS} short tags, reusing existing tags whenever possible.\n"
        "- title: short and clear. content: the idea rewritten clearly, keeping all details.\n"
        "Answer with JSON only, no prose, exactly this shape:\n"
        '{"title": str, "content": str, "project": {"existing_id": int} or {"new_name": str}, '
        '"tags": [str]}\n\n'
        f"Raw idea:\n<idea>\n{raw_text}\n</idea>"
    )


def parse_suggestion(text: str, project_ids: set[int], known_tags: list[str]) -> Suggestion:
    """Validate the model's answer. Raises AIError on anything unexpected."""
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise AIError("Réponse de l'IA invalide (pas de JSON).")
    try:
        data = json.loads(text[start : end + 1])
    except ValueError:
        raise AIError("Réponse de l'IA invalide (JSON illisible).") from None
    if not isinstance(data, dict):
        raise AIError("Réponse de l'IA invalide.")

    title, content = data.get("title"), data.get("content")
    if not isinstance(title, str) or not title.strip():
        raise AIError("Réponse de l'IA invalide (titre manquant).")
    if not isinstance(content, str) or not content.strip():
        raise AIError("Réponse de l'IA invalide (reformulation manquante).")

    project = data.get("project")
    project_id: int | None = None
    new_project = ""
    if not isinstance(project, dict):
        raise AIError("Réponse de l'IA invalide (projet manquant).")
    existing, new_name = project.get("existing_id"), project.get("new_name")
    if isinstance(existing, int) and not isinstance(existing, bool) and existing in project_ids:
        project_id = existing
    elif isinstance(new_name, str) and new_name.strip():
        new_project = new_name.strip()
    else:
        raise AIError("Réponse de l'IA invalide (projet inconnu).")

    raw_tags = data.get("tags")
    if not isinstance(raw_tags, list) or not all(isinstance(t, str) for t in raw_tags):
        raise AIError("Réponse de l'IA invalide (tags).")
    tags = normalize_tags(raw_tags, known_tags)[:MAX_TAGS]
    if not tags:
        raise AIError("Réponse de l'IA invalide (aucun tag).")
    return Suggestion(title.strip(), content.strip(), project_id, new_project, tags)


def normalize_tags(raw: list[str], known_tags: list[str]) -> list[str]:
    """Trim, lowercase, dedupe; reuse the exact spelling of an existing tag when it matches."""
    known = {t.lower(): t for t in known_tags}
    out: list[str] = []
    for tag in raw:
        tag = tag.strip().lstrip("#").strip()
        if not tag:
            continue
        tag = known.get(tag.lower(), tag.lower())
        if tag not in out:
            out.append(tag)
    return out


def suggest(
    api_key: str, raw_text: str, projects: list[tuple[int, str]], tags: list[str]
) -> Suggestion:
    """Ask Claude for a suggestion. Raises AIError for every failure mode."""
    if not api_key:
        raise AIError("Clé API Anthropic absente : l'IA est désactivée.")
    payload = {
        "model": MODEL,
        "max_tokens": 1024,
        "messages": [{"role": "user", "content": build_prompt(raw_text, projects, tags)}],
    }
    req = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "content-type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        text = "".join(
            b.get("text", "") for b in body["content"] if b.get("type") == "text"
        )
    except TimeoutError:
        raise AIError("L'IA n'a pas répondu à temps.") from None
    except urllib.error.URLError as e:
        # Never log headers/key; the reason is enough.
        log.warning("Claude API call failed: %s", getattr(e, "reason", e))
        raise AIError("L'appel à l'IA a échoué.") from None
    except (ValueError, KeyError, TypeError, AttributeError, OSError):
        raise AIError("Réponse de l'IA illisible.") from None
    return parse_suggestion(text, {pid for pid, _ in projects}, tags)
