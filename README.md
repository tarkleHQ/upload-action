# Share files with Tarkle

Upload one or more files from a GitHub Actions workflow to [Tarkle](https://tarkle.com) and get back a
shareable link, with optional expiry, password and one-time-download protection. Wraps the real
[`@tarkle/cli`](https://www.npmjs.com/package/@tarkle/cli) — no upload or sharing logic is duplicated here.

## Usage

```yaml
- name: Share the build
  id: tarkle
  uses: tarkleHQ/upload-action@v1
  with:
    api-key: ${{ secrets.TARKLE_API_KEY }}
    workspace: ${{ secrets.TARKLE_WORKSPACE }}
    files: |
      dist/application.zip
      reports/test-results.html
    duration: 7d

- name: Print the share link
  run: echo "${{ steps.tarkle.outputs.url }}"
```

A real API key is created at **Settings → API** in your Tarkle workspace — save it as a repository
secret. `workspace` is the 8-character workspace key (also shown on that page, or via `GET
/api/v1/workspaces`).

### Password and one-time download

```yaml
- uses: tarkleHQ/upload-action@v1
  with:
    api-key: ${{ secrets.TARKLE_API_KEY }}
    workspace: ${{ secrets.TARKLE_WORKSPACE }}
    files: build/release.zip
    password: ${{ secrets.RELEASE_PASSWORD }}
    burn-after-read: true
    title: "Release candidate"
```

### Upload into a folder

```yaml
- uses: tarkleHQ/upload-action@v1
  with:
    api-key: ${{ secrets.TARKLE_API_KEY }}
    workspace: ${{ secrets.TARKLE_WORKSPACE }}
    files: dist/app.zip
    folder: /ci-builds
```

`folder` is created automatically (including any missing parent) if it does not already exist.

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `api-key` | Yes | — | A Tarkle API key. Pass it through a secret. |
| `workspace` | Yes | — | The 8-character workspace key. |
| `files` | Yes | — | One or more local file paths, one per line. |
| `folder` | No | library root | A remote library folder to upload into, e.g. `/ci-builds`. Created if missing. |
| `duration` | No | never expires | `1h`, `24h`, `3d`, `7d`, `14d`, `30d`. Ignored if `expires-at` is set. |
| `expires-at` | No | — | An exact ISO 8601 expiry. Overrides `duration`. |
| `password` | No | — | A password required to open the link. Pass it through a secret. |
| `burn-after-read` | No | `false` | The link stops working after its first download. |
| `title` | No | — | Shown on the share page. |
| `description` | No | — | Shown on the share page. |
| `on-conflict` | No | the workspace's own rule | `version`, `separate` or `skip`, when a file of the same name already exists in the destination. |
| `api-url` | No | `https://tarkle.com/api/v1` | The Tarkle API base URL. |

## Outputs

| Output | Description |
|---|---|
| `url` | The share link. |
| `id` | The transfer id. |
| `expires-at` | When the link expires (ISO 8601), or empty if it never does. |
| `result` | The complete JSON response from `POST /api/v1/transfers`. |

## Security

- `api-key` and `password` are read only from `@actions/core`'s input mechanism (environment
  variables GitHub Actions sets from your workflow's `with:` block) — never put a real value directly
  in a workflow file; always pass it through `secrets`.
- Files are uploaded straight to Tarkle's object storage through short-lived presigned URLs (the same
  engine the Tarkle app and its public API use); the API key itself is never sent to storage.
- **Pin this action to a full commit SHA** (`uses: tarkleHQ/upload-action@<sha>`) rather than a
  floating tag when your workflow runs on untrusted input (e.g. a fork's pull request), the same
  guidance any third-party action deserves.

## Development

```
npm install
npm test     # runs against a local mock server, no real network calls
npm run build  # bundles src/index.js into dist/index.js with @vercel/ncc
```

`dist/index.js` is committed (GitHub Actions run the checked-in file directly, with no install step),
so run `npm run build` and commit the result after any change under `src/`.

## Licence

Apache-2.0 (see `LICENSE`).
