// Share files with Tarkle -- uploads each file via the real Tarkle CLI's own commands (no upload or
// share logic duplicated here), then creates one transfer covering all of them. Exported separately
// from index.js so tests can call it directly with real @actions/core env-var inputs, the same
// convention tools/tarkle-cli's own tests use (real functions, a local HTTP server, no deep mocking).
import * as core from "@actions/core";
import { createClient, errorJson, exitCodeFor, formatError } from "@tarkle/cli/lib/client.mjs";
import { createCommands } from "@tarkle/cli/lib/commands.mjs";

const DURATION = /^(\d+)(h|d)$/;

export function expiresAtFrom({ duration, expiresAt }) {
  if (expiresAt) return expiresAt;
  if (!duration) return undefined;
  const match = DURATION.exec(duration.trim());
  if (!match) throw new Error(`duration must look like 24h, 3d or 7d, got "${duration}".`);
  const [, amount, unit] = match;
  const ms = Number(amount) * (unit === "h" ? 3600_000 : 86_400_000);
  return new Date(Date.now() + ms).toISOString();
}

/** Creates a remote folder path (and any missing parent) if it does not already exist -- the CLI's own
 * mkdir only takes one path and expects its parent to exist; a CI folder like /ci-builds is usually the
 * FIRST thing a new workflow needs, so this makes the whole path, not just the leaf. */
export async function ensureFolder(api, path) {
  if (!path) return undefined;
  const segments = path.replace(/^\/+/, "").replace(/\/+$/, "").split("/").filter(Boolean);
  let parentId = null; // null = the library root, as every folder-creating/listing call here expects
  let built = "";
  for (const segment of segments) {
    built += `/${segment}`;
    try {
      const entry = await api.get("/files/by-path", { path: built });
      parentId = entry.id;
    } catch (error) {
      if (error.status !== 404) throw error;
      const created = await api.post("/folders", { name: segment, parent_id: parentId });
      parentId = created.id;
    }
  }
  return built;
}

export function parseFiles(input) {
  const files = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (files.length === 0) throw new Error("files is required: at least one local file path, one per line.");
  return files;
}

export async function run() {
  const apiKey = core.getInput("api-key", { required: true });
  const workspace = core.getInput("workspace", { required: true });
  const files = parseFiles(core.getInput("files", { required: true }));
  const folder = core.getInput("folder") || undefined;
  const onConflict = core.getInput("on-conflict") || undefined;
  const apiUrl = core.getInput("api-url") || undefined;
  const password = core.getInput("password") || undefined;
  const burnAfterRead = core.getInput("burn-after-read").trim().toLowerCase() === "true";
  const title = core.getInput("title") || undefined;
  const description = core.getInput("description") || undefined;
  const expiresAt = expiresAtFrom({ duration: core.getInput("duration") || undefined, expiresAt: core.getInput("expires-at") || undefined });

  const api = createClient({ token: apiKey, workspace, ...(apiUrl ? { apiUrl } : {}) });
  const commands = createCommands({ api, out: (line) => core.info(line) });

  if (folder) await ensureFolder(api, folder);

  const fileIds = [];
  for (const localPath of files) {
    core.info(`Uploading ${localPath}...`);
    const uploaded = await commands.put({ args: folder ? [localPath, folder] : [localPath], flags: { onConflict, json: true } });
    // An identical file already on the server (same name, same bytes) answers `{ action: "skip", existing }`
    // instead of the usual Entry -- the CLI's own put() returns that shape as-is.
    fileIds.push(uploaded.action === "skip" ? uploaded.existing.id : uploaded.id);
  }

  core.info(`Sharing ${fileIds.length} file(s)...`);
  const transfer = await commands.share({
    args: fileIds,
    flags: { password, title, description, expiresAt, burnAfterRead: burnAfterRead || undefined, json: true },
  });

  core.setOutput("url", transfer.url);
  core.setOutput("id", transfer.id);
  core.setOutput("expires-at", transfer.expires_at ?? "");
  core.setOutput("result", JSON.stringify(transfer));

  if (process.env.GITHUB_STEP_SUMMARY) {
    await core.summary
      .addHeading("Shared with Tarkle")
      .addTable([
        [{ data: "File", header: true }, { data: "Tarkle id", header: true }],
        ...files.map((file, i) => [file, String(fileIds[i])]),
      ])
      .addLink("Open the share link", transfer.url)
      .write();
  }

  return transfer;
}

const EXIT_MEANING = {
  1: "error",
  2: "not signed in or not allowed",
  3: "daily quota or AI credits used up, do not retry",
  4: "rate limited after retries, run again later",
  5: "network or server trouble",
};

/** Turns a thrown error into the same exit code the CLI would return, so a workflow can react to the cause. */
export function failureOf(error) {
  const exitCode = exitCodeFor(error);
  const detail = errorJson(error).error;
  return { exitCode, code: detail.code, status: detail.status, retryAfter: detail.retry_after ?? "", message: formatError(error) };
}

export function reportFailure(error) {
  const failure = failureOf(error);
  core.setOutput("exit-code", String(failure.exitCode));
  core.setOutput("error-code", failure.code);
  core.setOutput("retry-after", String(failure.retryAfter));
  core.setFailed(`${failure.message}\n(exit code ${failure.exitCode}: ${EXIT_MEANING[failure.exitCode] ?? "error"})`);
  return failure;
}
