import json
import unittest
from unittest import mock

from app import ai

PROJECTS = [(1, "Maison"), (2, "Blog")]
TAGS = ["Cuisine", "web"]


def answer(**over: object) -> str:
    data: dict[str, object] = {
        "title": " Idée ",
        "content": "Reformulée",
        "project": {"existing_id": 1},
        "tags": ["cuisine", "#Nouveau"],
    }
    data.update(over)
    return json.dumps(data)


class ParseSuggestionTests(unittest.TestCase):
    def parse(self, text: str) -> ai.Suggestion:
        return ai.parse_suggestion(text, {1, 2}, TAGS)

    def test_valid_existing_project_reuses_tag_spelling(self) -> None:
        s = self.parse(answer())
        self.assertEqual((s.title, s.project_id, s.new_project), ("Idée", 1, ""))
        self.assertEqual(s.tags, ["Cuisine", "nouveau"])

    def test_json_wrapped_in_prose_or_fence(self) -> None:
        self.assertEqual(self.parse("```json\n" + answer() + "\n```").project_id, 1)

    def test_new_project(self) -> None:
        s = self.parse(answer(project={"new_name": " Jardin "}))
        self.assertEqual((s.project_id, s.new_project), (None, "Jardin"))

    def test_tags_capped_at_three(self) -> None:
        self.assertEqual(len(self.parse(answer(tags=list("abcde"))).tags), 3)

    def test_invalid_answers_raise(self) -> None:
        bad = [
            "not json",
            "{broken",
            "[1, 2]",
            answer(title=""),
            answer(content=None),
            answer(project=None),
            answer(project={"existing_id": 99}),
            answer(project={"existing_id": True}),
            answer(project={}),
            answer(tags="x"),
            answer(tags=[1]),
            answer(tags=[" ", "#"]),
        ]
        for text in bad:
            with self.subTest(text=text), self.assertRaises(ai.AIError):
                self.parse(text)


class SuggestTests(unittest.TestCase):
    def test_missing_key(self) -> None:
        with self.assertRaises(ai.AIError):
            ai.suggest("", "idea", PROJECTS, TAGS)

    def test_api_error_and_timeout(self) -> None:
        for exc in (ai.urllib.error.URLError("down"), TimeoutError()):
            with self.subTest(exc=exc), mock.patch("urllib.request.urlopen", side_effect=exc):
                with self.assertRaises(ai.AIError):
                    ai.suggest("k", "idea", PROJECTS, TAGS)

    def test_success(self) -> None:
        body = json.dumps({"content": [{"type": "text", "text": answer()}]}).encode()
        resp = mock.MagicMock()
        resp.__enter__.return_value.read.return_value = body
        with mock.patch("urllib.request.urlopen", return_value=resp) as m:
            s = ai.suggest("k", "idea", PROJECTS, TAGS)
        self.assertEqual(s.project_id, 1)
        self.assertEqual(m.call_args.kwargs["timeout"], 15)

    def test_prompt_lists_projects_and_tags(self) -> None:
        p = ai.build_prompt("x", PROJECTS, TAGS)
        self.assertIn("1: Maison", p)
        self.assertIn("Cuisine", p)
