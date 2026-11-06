import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { ensureFolder, expiresAtFrom, parseFiles, run } from "../src/run.js";
import { createClient } from "@tarkle/cli/lib/client.mjs";

let server;
let base;
let calls;
let handlers;
let dir;
let outputFile;
let summaryFile;

const readBody = (req) => new Promise((resolve) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => resolve(Buffer.concat(chunks)));
});

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "upload-action-"));
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    const url = new URL(req.url, "http://x");
    const call = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body };
    calls.push(call);
    const handler = handlers[`${req.method} ${url.pathname}`];
    if (!handler) {
      res.writeHead(404, { "content-type": "application/problem+json" });
      res.end(JSON.stringify({ code: "not_found", title: "Not found", detail: `No route ${req.method} ${url.pathname}` }));
      return;
    }
    const answer = await handler(call);
    res.writeHead(answer.status ?? 200, { "content-type": "application/json" });
    res.end(JSON.stringify(answer.body));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

beforeEach(async () => {
  calls = [];
  handlers = {};
  outputFile = join(dir, `out-${Math.random()}.txt`);
  summaryFile = join(dir, `summary-${Math.random()}.md`);
  await writeFile(outputFile, "");
  await writeFile(summaryFile, "");
});

function setEnv(inputs, extra = {}) {
  for (const [k, v] of Object.entries(inputs)) process.env[`INPUT_${k.toUpperCase()}`] = v;
  process.env.GITHUB_OUTPUT = outputFile;
  process.env.GITHUB_STEP_SUMMARY = summaryFile;
  for (const [k, v] of Object.entries(extra)) process.env[k] = v;
}

function clearEnv(inputs) {
  for (const k of Object.keys(inputs)) delete process.env[`INPUT_${k.toUpperCase()}`];
  delete process.env.GITHUB_OUTPUT;
  delete process.env.GITHUB_STEP_SUMMARY;
}

test("expiresAtFrom: an explicit expires-at wins over duration; duration parses h and d", () => {
  assert.equal(expiresAtFrom({ duration: "24h", expiresAt: "2030-01-01T00:00:00Z" }), "2030-01-01T00:00:00Z");
  assert.equal(expiresAtFrom({}), undefined);
  const soon = expiresAtFrom({ duration: "1h" });
  assert.ok(new Date(soon).getTime() > Date.now());
  assert.throws(() => expiresAtFrom({ duration: "nope" }), /must look like/);
});

test("parseFiles splits lines, drops blanks, and refuses an empty list", () => {
  assert.deepEqual(parseFiles("a.txt\n\nb.txt\n"), ["a.txt", "b.txt"]);
  assert.throws(() => parseFiles("\n  \n"), /at least one local file path/);
});

test("ensureFolder creates every missing segment of a nested path, reusing what already exists", async () => {
  handlers["GET /api/v1/files/by-path"] = (call) => {
    if (call.query.path === "/ci") return { status: 404, body: { code: "not_found" } };
    if (call.query.path === "/ci/builds") return { status: 404, body: { code: "not_found" } };
    return { status: 404, body: { code: "not_found" } };
  };
  handlers["POST /api/v1/folders"] = (call) => {
    const body = JSON.parse(call.body);
    return { status: 201, body: { id: `id-${body.name}`, type: "folder", name: body.name } };
  };
  const api = createClient({ token: "tk_x", workspace: "abcd1234", apiUrl: `${base}/api/v1` });
  await ensureFolder(api, "/ci/builds");
  const folderCalls = calls.filter((c) => c.path === "/api/v1/folders");
  assert.equal(folderCalls.length, 2);
  assert.deepEqual(JSON.parse(folderCalls[0].body), { name: "ci", parent_id: null });
  assert.deepEqual(JSON.parse(folderCalls[1].body), { name: "builds", parent_id: "id-ci" });
});

test("ensureFolder does nothing for a path that already fully exists", async () => {
  handlers["GET /api/v1/files/by-path"] = (call) => ({ body: { id: `id-${call.query.path}`, type: "folder" } });
  const api = createClient({ token: "tk_x", workspace: "abcd1234", apiUrl: `${base}/api/v1` });
  await ensureFolder(api, "/ci");
  assert.equal(calls.filter((c) => c.method === "POST").length, 0);
});

test("run(): uploads each file, shares them in one transfer, and sets the real outputs", async () => {
  const file = join(dir, "report.txt");
  await writeFile(file, "hello");
  handlers["POST /api/v1/uploads"] = () => ({ status: 201, body: { action: "upload", id: "u1", mode: "single", size: 5, name: "report.txt", part_size: 5, part_count: 1, content_type: "text/plain", uploads: [{ partNumber: 1, url: `${base}/storage/one` }] } });
  handlers["PUT /storage/one"] = () => ({ status: 200, body: {} });
  handlers["POST /api/v1/uploads/u1/complete"] = () => ({ body: { id: "177", type: "file", name: "report.txt", size: 5 } });
  handlers["GET /api/v1/files/177"] = () => ({ body: { id: "177", type: "file", name: "report.txt" } });
  handlers["POST /api/v1/transfers"] = (call) => {
    assert.deepEqual(JSON.parse(call.body).items, [{ id: "177", type: "file" }]);
    return { status: 201, body: { id: "9", url: "https://acme.tarkle.com/t/abc123", slug: "abc123", access: "public", expires_at: null } };
  };

  setEnv({ "api-key": "tk_x", workspace: "abcd1234", files: file, "api-url": `${base}/api/v1`, title: "CI build" });
  try {
    const result = await run();
    assert.equal(result.url, "https://acme.tarkle.com/t/abc123");
  } finally {
    clearEnv({ "api-key": "", workspace: "", files: "", "api-url": "", title: "" });
  }

  const output = await readFile(outputFile, "utf8");
  assert.match(output, /url<<.*\nhttps:\/\/acme\.tarkle\.com\/t\/abc123/);
  assert.match(output, /id<<.*\n9/);
  const summary = await readFile(summaryFile, "utf8");
  assert.match(summary, /Shared with Tarkle/);
  assert.match(summary, /report\.txt/);
});

test("run(): an identical-file skip still resolves to the existing file's id for sharing", async () => {
  const file = join(dir, "dup.txt");
  await writeFile(file, "same bytes");
  handlers["POST /api/v1/uploads"] = () => ({ status: 200, body: { action: "skip", existing: { id: "555", name: "dup.txt" } } });
  handlers["GET /api/v1/files/555"] = () => ({ body: { id: "555", type: "file", name: "dup.txt" } });
  handlers["POST /api/v1/transfers"] = (call) => {
    assert.deepEqual(JSON.parse(call.body).items, [{ id: "555", type: "file" }]);
    return { status: 201, body: { id: "9", url: "https://acme.tarkle.com/t/dup", access: "public" } };
  };
  setEnv({ "api-key": "tk_x", workspace: "abcd1234", files: file, "api-url": `${base}/api/v1` });
  try {
    await run();
  } finally {
    clearEnv({ "api-key": "", workspace: "", files: "", "api-url": "" });
  }
});

test("run(): a given folder is created first, and files upload into it", async () => {
  const file = join(dir, "artifact.zip");
  await writeFile(file, "zip-bytes");
  let folderCreated = false;
  handlers["GET /api/v1/files/by-path"] = () => (folderCreated ? { body: { id: "folder-1", type: "folder", name: "ci-builds" } } : { status: 404, body: { code: "not_found" } });
  handlers["POST /api/v1/folders"] = () => {
    folderCreated = true;
    return { status: 201, body: { id: "folder-1", type: "folder", name: "ci-builds" } };
  };
  handlers["POST /api/v1/uploads"] = (call) => {
    assert.equal(JSON.parse(call.body).folder_id, "folder-1");
    return { status: 201, body: { action: "upload", id: "u2", mode: "single", size: 9, name: "artifact.zip", part_size: 9, part_count: 1, content_type: "application/zip", uploads: [{ partNumber: 1, url: `${base}/storage/two` }] } };
  };
  handlers["PUT /storage/two"] = () => ({ status: 200, body: {} });
  handlers["POST /api/v1/uploads/u2/complete"] = () => ({ body: { id: "178", type: "file", name: "artifact.zip", size: 9 } });
  handlers["GET /api/v1/files/178"] = () => ({ body: { id: "178", type: "file", name: "artifact.zip" } });
  handlers["POST /api/v1/transfers"] = () => ({ status: 201, body: { id: "10", url: "https://acme.tarkle.com/t/ci", access: "public" } });
  setEnv({ "api-key": "tk_x", workspace: "abcd1234", files: file, folder: "/ci-builds", "api-url": `${base}/api/v1` });
  try {
    await run();
  } finally {
    clearEnv({ "api-key": "", workspace: "", files: "", folder: "", "api-url": "" });
  }
});
