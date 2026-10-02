# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Crow PR Reviewer Tracker: a Firefox Manifest V3 extension in plain JavaScript. The add-on has no build step and no runtime dependencies. `package.json` exists only for Jest and `web-ext`. `PROMPT.md` is the full spec the extension was built from; treat it as the source of requirements and keep it in sync with behavior changes.

## Commands

```sh
npm start                                  # scratch Firefox with the add-on loaded
npm test                                   # all Jest specs
npx jest test/popup.test.js -t "Enter adds"  # one file / one test
npm run lint                               # web-ext lint, must be 0 errors and 0 warnings
npx web-ext sign --channel=unlisted --source-dir . \
  --api-key "$AMO_JWT_ISSUER" --api-secret "$AMO_JWT_SECRET"   # private signed .xpi into web-ext-artifacts/
```

Bump `version` in `manifest.json` (and `package.json`) before signing a new build. `web-ext-config.mjs` keeps `test/`, npm files, `PROMPT.md`, and `CLAUDE.md` out of the package. CI (`.github/workflows/ci.yml`) runs `npm test` and `npm run lint`.

Specs: `test/helpers.js` `loadPage` builds a fresh jsdom window per test from the real HTML, injects the real scripts as `<script>` elements (so top-level `const`s share one global scope, as in Firefox), and stubs `browser` with `fakeBrowser` (in-memory `storage.local` that fires `onChanged`). `fetch` is a `jest.fn()` returning `response(...)` objects; `peoplePage(...)` builds People-page HTML. `Math.random` is pinned to 0 so retry backoff doesn't wait. Call `settle()` after clicks and events. `context` is aliased to `describe` in `test/setup.js`.

## Architecture

- `lib.js` is a plain script (not a module) loaded before `background.js` (via `manifest.json`) and before `popup.js` / `options.js` (via `<script>` tags). It holds the storage schema (`DEFAULTS`), `getState`/`setState`, `buildSearchUrl`, and the GitHub fetch with timeout/retry/pagination. Anything shared goes here as a global.
- `fetchOrgMembers` has two sources. With no token it scrapes `github.com/orgs/{org}/people` using the browser's github.com cookies, which depends on GitHub's HTML. With a token it uses the REST API. Both go through `fetchWithRetry`.
- `background.js` is the only place that fetches the org member list. Popup and options request a refresh with `browser.runtime.sendMessage({ type: "refresh", force })`; `refreshMembers` dedupes concurrent calls via a single `inFlight` promise.
- All state lives in `browser.storage.local` (never `storage.sync`, it holds the token). The popup re-reads state on `storage.onChanged` rather than trusting message responses.
- Refresh scheduling: an hourly `members-check` alarm refreshes only if the cache is older than a day; a `members-retry` alarm backs off 5 min → doubling → 6 h after retryable failures. `FatalError` (401, 404, 403/SSO, exhausted rate limit) is not retried. A failed refresh never clears the cached `members`.
- `selected` = currently checked logins. `pinned` = everyone ever checked, so unchecked picks stay at the top of the list until removed with ×. Changing the org in Options clears `members`.

## Gotchas

- The PR link must use `https://github.com/search?type=pullrequests&q=...`. `github.com/pulls` ANDs repeated `author:` terms, so multi-person searches return nothing.
- Build DOM from GitHub data with `createElement`/`textContent`, never `innerHTML`.
- Keep permissions to `storage` and `alarms` plus hosts `https://api.github.com/*` and `https://github.com/*`. `browser.tabs.create` needs no `tabs` permission.
- Dark mode is handled with `prefers-color-scheme` in `shared.css`.
