"""Project / idea pages and their form + JSON endpoints."""
import html
import sqlite3
from urllib.parse import urlencode

from . import ai
from .config import Config
from .db import connect, queries
from .router import Request, Response, Router, html_response, json_response, redirect
from .templates import Safe, page, render

STATUS_LABELS = {"todo": "À faire", "in_progress": "En cours", "done": "Fini"}


NOTICES = {
    "saved": "Idée enregistrée.",
    "no_key": "Clé API absente : l'idée brute est dans l'Inbox, sans traitement IA.",
    "ai_error": "L'IA a échoué : l'idée brute est dans l'Inbox. Vous pouvez la retraiter plus tard.",
    "reprocess_error": "L'IA a échoué : l'idée reste inchangée dans l'Inbox.",
}


def escape_html(value: object) -> str:
    return html.escape(str(value), quote=True)


def layout(title: str, body: Safe, q: str = "") -> Response:
    return html_response(page(title, Safe(render("nav.html", q=q) + body)))


def parse_id(raw: str | None) -> int | None:
    return int(raw) if raw and raw.isdigit() else None


def project_href(project_id: int | None) -> str:
    return "/inbox" if project_id is None else f"/project?id={project_id}"


def counts_line(row: sqlite3.Row) -> str:
    return " · ".join(f"{STATUS_LABELS[s]} : {row[s]}" for s in queries.STATUSES)


def status_select(idea: sqlite3.Row) -> str:
    opts = "".join(
        f'<option value="{s}"{" selected" if s == idea["status"] else ""}>{label}</option>'
        for s, label in STATUS_LABELS.items()
    )
    return (
        f'<select class="status" data-id="{idea["id"]}" data-current="{escape_html(idea["status"])}"'
        f' aria-label="Statut">{opts}</select>'
    )


def idea_items(ideas: list[sqlite3.Row], tags: dict[int, list[str]]) -> Safe:
    out = []
    for idea in ideas:
        title = idea["title"] or idea["raw_text"][:80]
        reprocess = (
            '<form method="post" action="/capture/reprocess">'
            f'<input type="hidden" name="idea_id" value="{idea["id"]}">'
            '<button type="submit">Retraiter avec l\'IA</button></form>'
            if idea["project_id"] is None and not idea["ai_processed"]
            else ""
        )
        tag_html = "".join(f'<span class="tag">{escape_html(t)}</span>' for t in tags.get(idea["id"], []))
        out.append(
            f'<li class="idea s-{escape_html(idea["status"])}"><a class="title" href="/idea?id={idea["id"]}">'
            f"{escape_html(title)}</a><p class=\"tags\">{tag_html}</p>{status_select(i)}{reprocess}</li>"
        )
    return Safe("".join(out) or "<li>Aucune idée.</li>")


def build_pages(router: Router, config: Config) -> None:
    def open_db() -> sqlite3.Connection:
        return connect(config.db_path)

    def home(req: Request, error: str = "", status: int = 200) -> Response:
        conn = open_db()
        try:
            rows = [
                f'<li><a class="title" href="/inbox">Inbox</a>'
                f'<p class="counts">{counts_line(queries.inbox_counts(conn))}</p></li>'
            ]
            for p in queries.project_counts(conn):
                rows.append(
                    f'<li><a class="title" href="/project?id={p["id"]}">{escape_html(p["name"])}</a>'
                    f'<p class="counts">{counts_line(p)}</p></li>'
                )
        finally:
            conn.close()
        notice = NOTICES.get(req.query.get("notice", [""])[0], "")
        body = render("home.html", rows=Safe("".join(rows)), error=error, notice=notice)
        resp = layout("Projets", body)
        resp.status = status
        return resp

    router.add("GET", "/", home)

    def project_page(req: Request, inbox: bool = False) -> Response:
        raw_id = "" if inbox else req.query.get("id", [""])[0]
        project_id = parse_id(raw_id) if raw_id else None
        status = req.query.get("status", [""])[0]
        tag = req.query.get("tag", [""])[0]
        if status not in queries.STATUSES:
            status = ""
        conn = open_db()
        try:
            project = queries.get_project(conn, project_id) if project_id is not None else None
            if raw_id and project is None:
                return html_response("Projet introuvable", 404)
            ideas = queries.list_ideas(conn, project_id, status or None, tag or None)
            tags = queries.tags_of_ideas(conn, [i["id"] for i in ideas])
            all_tags = queries.project_tags(conn, project_id)
        finally:
            conn.close()

        def link(label: str, st: str, tg: str) -> str:
            qs = urlencode({k: v for k, v in (("id", raw_id), ("status", st), ("tag", tg)) if v})
            on = ' class="on"' if (st, tg) == (status, tag) else ""
            base = "/inbox" if project is None else "/project"
            return f'<a{on} href="{base}{"?" + qs if qs else ""}">{escape_html(label)}</a>'

        status_filters = link("Tous", "", tag) + "".join(
            link(label, s, tag) for s, label in STATUS_LABELS.items()
        )
        tag_filters = "".join(link("#" + t, status, t) for t in all_tags)
        if tag:
            tag_filters = link("Tous les tags", status, "") + tag_filters
        manage = (
            render("manage.html", id=project["id"], pname=project["name"]) if project else Safe("")
        )
        body = render(
            "project.html",
            title=project["name"] if project else "Inbox",
            manage=manage,
            status_filters=Safe(status_filters),
            tag_filters=Safe(tag_filters),
            rows=idea_items(ideas, tags),
            notice=NOTICES.get(req.query.get("notice", [""])[0], ""),
        )
        return layout(project["name"] if project else "Inbox", body)

    def project_route(req: Request) -> Response:
        if not req.query.get("id", [""])[0]:
            return redirect("/inbox")
        return project_page(req)

    router.add("GET", "/project", project_route)
    router.add("GET", "/inbox", lambda req: project_page(req, inbox=True))

    def project_name(req: Request) -> str:
        return req.form.get("name", "").strip()[:100]

    def create_project(req: Request) -> Response:
        name = project_name(req)
        if not name:
            return home(req, "Nom requis.", 400)
        conn = open_db()
        try:
            new_id = queries.create_project(conn, name)
        except sqlite3.IntegrityError:
            return home(req, "Ce projet existe déjà.", 409)
        finally:
            conn.close()
        return redirect(project_href(new_id))

    def rename_project(req: Request) -> Response:
        project_id = parse_id(req.form.get("id"))
        name = project_name(req)
        if project_id is None or not name:
            return home(req, "Nom requis.", 400)
        conn = open_db()
        try:
            queries.rename_project(conn, project_id, name)
        except sqlite3.IntegrityError:
            return home(req, "Ce nom est déjà pris.", 409)
        finally:
            conn.close()
        return redirect(project_href(project_id))

    def delete_project(req: Request) -> Response:
        project_id = parse_id(req.form.get("id"))
        if project_id is not None:
            conn = open_db()
            try:
                queries.delete_project(conn, project_id)
            finally:
                conn.close()
        return redirect("/")

    router.add("POST", "/projects/create", create_project)
    router.add("POST", "/projects/rename", rename_project)
    router.add("POST", "/projects/delete", delete_project)

    def idea_form(req: Request) -> Response:
        idea_id = parse_id(req.query.get("id", [""])[0])
        conn = open_db()
        try:
            idea = queries.get_idea(conn, idea_id) if idea_id is not None else None
            if idea is None:
                return html_response("Idée introuvable", 404)
            projects = queries.list_projects(conn)
            tags = queries.tags_of_ideas(conn, [idea["id"]])[idea["id"]]
        finally:
            conn.close()
        options = [
            f'<option value=""{" selected" if idea["project_id"] is None else ""}>Inbox</option>'
        ] + [
            f'<option value="{pid}"{" selected" if pid == idea["project_id"] else ""}>'
            f"{escape_html(name)}</option>"
            for pid, name in projects
        ]
        status_options = "".join(
            f'<option value="{s}"{" selected" if s == idea["status"] else ""}>{label}</option>'
            for s, label in STATUS_LABELS.items()
        )
        body = render(
            "idea.html",
            id=idea["id"],
            back=project_href(idea["project_id"]),
            title=idea["title"] or "",
            content=idea["content"] or "",
            project_options=Safe("".join(options)),
            status_options=Safe(status_options),
            tags=", ".join(tags),
            raw_text=idea["raw_text"],
        )
        return layout("Idée", body)

    def idea_save(req: Request) -> Response:
        form = req.form
        idea_id = parse_id(form.get("id"))
        status = form.get("status", "")
        project_raw = form.get("project_id", "")
        project_id = parse_id(project_raw)
        if idea_id is None or status not in queries.STATUSES or (project_raw and project_id is None):
            return html_response("Requête invalide", 400)
        conn = open_db()
        try:
            if queries.get_idea(conn, idea_id) is None:
                return html_response("Idée introuvable", 404)
            if project_id is not None and queries.get_project(conn, project_id) is None:
                return html_response("Projet introuvable", 400)
            queries.update_idea(
                conn,
                idea_id,
                title=form.get("title", "").strip() or None,
                content=form.get("content", "").strip() or None,
                project_id=project_id,
                status=status,
            )
            tags = ai.normalize_tags(form.get("tags", "").split(","), queries.list_tag_names(conn))
            queries.set_idea_tags(conn, idea_id, tags)
        finally:
            conn.close()
        return redirect(project_href(project_id))

    router.add("GET", "/idea", idea_form)
    router.add("POST", "/idea", idea_save)

    def api_status(req: Request) -> Response:
        idea_id = parse_id(req.form.get("id"))
        status = req.form.get("status", "")
        if idea_id is None or status not in queries.STATUSES:
            return json_response({"error": "invalid"}, 400)
        conn = open_db()
        try:
            if queries.get_idea(conn, idea_id) is None:
                return json_response({"error": "not found"}, 404)
            queries.update_idea(conn, idea_id, status=status)
        finally:
            conn.close()
        return json_response({"ok": True, "status": status})

    router.add("POST", "/api/idea/status", api_status)

    def search(req: Request) -> Response:
        q = req.query.get("q", [""])[0].strip()
        conn = open_db()
        try:
            ideas = queries.search_ideas(conn, q) if q else []
            tags = queries.tags_of_ideas(conn, [i["id"] for i in ideas])
        finally:
            conn.close()
        summary = f"{len(ideas)} résultat(s) pour « {q} »" if q else "Saisissez un terme."
        body = render("search.html", summary=summary, rows=idea_items(ideas, tags))
        return layout("Recherche", body, q)

    router.add("GET", "/search", search)
