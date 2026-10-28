import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { AIError, buildPrompt, parseSuggestion, suggest, type ProjectRef } from "@/lib/ai";

const PROJECTS: ProjectRef[] = [
  { id: 1, name: "Maison" },
  { id: 2, name: "Blog" },
];
const TAGS = ["Cuisine", "web"];

function answer(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    title: " Idée ",
    content: "Reformulée",
    project: { existing_id: 1 },
    tags: ["cuisine", "#Nouveau"],
    ...over,
  });
}

const parse = (text: string) => parseSuggestion(text, new Set([1, 2]), TAGS);

describe("parseSuggestion", () => {
  test("valid existing project reuses tag spelling", () => {
    const s = parse(answer());
    assert.deepEqual([s.title, s.projectId, s.newProject], ["Idée", 1, ""]);
    assert.deepEqual(s.tags, ["Cuisine", "nouveau"]);
  });

  test("JSON wrapped in prose or fence", () => {
    assert.equal(parse("```json\n" + answer() + "\n```").projectId, 1);
  });

  test("new project", () => {
    const s = parse(answer({ project: { new_name: " Jardin " } }));
    assert.deepEqual([s.projectId, s.newProject], [null, "Jardin"]);
  });

  test("tags capped at three", () => {
    assert.equal(parse(answer({ tags: ["a", "b", "c", "d", "e"] })).tags.length, 3);
  });

  test("invalid answers throw", () => {
    const bad = [
      "not json",
      "{broken",
      "[1, 2]",
      answer({ title: "" }),
      answer({ content: null }),
      answer({ project: null }),
      answer({ project: { existing_id: 99 } }),
      answer({ project: { existing_id: true } }),
      answer({ project: {} }),
      answer({ tags: "x" }),
      answer({ tags: [1] }),
      answer({ tags: [" ", "#"] }),
    ];
    for (const text of bad) assert.throws(() => parse(text), AIError, text);
  });
});

describe("suggest", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("missing key", async () => {
    await assert.rejects(suggest("", "idea", PROJECTS, TAGS), AIError);
  });

  test("network error and timeout", async () => {
    for (const err of [new TypeError("fetch failed"), new DOMException("timeout", "TimeoutError")]) {
      globalThis.fetch = async () => {
        throw err;
      };
      await assert.rejects(suggest("k", "idea", PROJECTS, TAGS), AIError);
    }
  });

  test("HTTP error and unreadable body", async () => {
    globalThis.fetch = async () => new Response("{}", { status: 500 });
    await assert.rejects(suggest("k", "idea", PROJECTS, TAGS), AIError);
    globalThis.fetch = async () => new Response("<html>", { status: 200 });
    await assert.rejects(suggest("k", "idea", PROJECTS, TAGS), AIError);
    globalThis.fetch = async () => new Response(JSON.stringify({ nope: 1 }), { status: 200 });
    await assert.rejects(suggest("k", "idea", PROJECTS, TAGS), AIError);
  });

  test("success sends the key, the model and a 15 s timeout signal", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    globalThis.fetch = async (url, init) => {
      seen = { url: String(url), init: init ?? {} };
      return new Response(JSON.stringify({ content: [{ type: "text", text: answer() }] }), { status: 200 });
    };
    const s = await suggest("k", "idea", PROJECTS, TAGS);
    assert.equal(s.projectId, 1);
    assert.ok(seen);
    assert.equal(seen.url, "https://api.anthropic.com/v1/messages");
    assert.equal((seen.init.headers as Record<string, string>)["x-api-key"], "k");
    assert.equal(JSON.parse(String(seen.init.body)).model, "claude-haiku-5-5");
    assert.ok(seen.init.signal instanceof AbortSignal);
  });

  test("the API key is never logged on failure", async () => {
    const logged: string[] = [];
    const realWarn = console.warn;
    console.warn = (...a: unknown[]) => logged.push(a.join(" "));
    try {
      globalThis.fetch = async () => new Response("{}", { status: 401 });
      await assert.rejects(suggest("secret-key", "idea", PROJECTS, TAGS), AIError);
    } finally {
      console.warn = realWarn;
    }
    assert.equal(logged.length, 1);
    assert.ok(!String(logged[0]).includes("secret-key"));
  });
});

test("prompt lists projects and tags", () => {
  const p = buildPrompt("x", PROJECTS, TAGS);
  assert.ok(p.includes("1: Maison"));
  assert.ok(p.includes("Cuisine"));
});
