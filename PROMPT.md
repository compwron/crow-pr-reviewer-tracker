# Prompt to rebuild this tool

Paste this into an AI coding agent to build the same extension from scratch.

---

Build a Firefox extension called "Crow PR Reviewer Tracker", Manifest V3, in plain JavaScript. No build step and no runtime dependencies. Jest and `web-ext` are dev dependencies only.

**What it does**

- A toolbar popup lists the members of one GitHub organization. I check the people I care about.
- An **Open PRs** button opens a new tab showing a GitHub search of all open PRs by the checked people.
- A toggle in the popup includes or hides draft PRs. A second toggle limits results to the org's repos.
- A filter box narrows the list. Typing a valid GitHub username and pressing Enter adds that person, even if they aren't in the org list.
- Checked people go at the top of the list. Unchecking someone, or clicking Clear, leaves them at the top, unchecked. An × on an unchecked top row removes it. People at the top who are no longer in the org get a small "not in org list" tag. Every row has a ↗ button that opens the search for just that person, using the current toggles.
- A **random(3)** button next to Open PRs opens the search for 3 random org members who aren't checked. It doesn't change the picks. It is disabled when nobody is left to pick.

**Search URL**

Use `https://github.com/search?type=pullrequests&q=...` with
`is:pr is:open archived:false`, plus `draft:false` when drafts are hidden, plus `org:<org>` when the org toggle is on, plus one `author:<login>` per person.

Do NOT use `https://github.com/pulls?q=...`. That page ANDs repeated `author:` terms, so two or more authors match nothing. The `/search` page and the search API OR them.

**Settings page**

- Fields: organization (empty by default) and an optional GitHub token.
- With no token, use the browser's github.com login. Explain that SSO orgs need an active SSO session.
- The token is a fallback: a classic token with `read:org`. Explain that SSO orgs need the token authorized under "Configure SSO".
- A "Save and test" button saves, forces a refresh, and reports how many people it loaded or the error.
- Changing the org clears the cached member list.
- Open this page on first install when no org is set.

**Caching**

- Keep the org, token, checked people, people ever checked, toggles, member list, and last-fetch time in `browser.storage.local`. Never use `storage.sync` for the token.
- Refresh the member list at most once a day. Use a `browser.alarms` check every hour, not one 24h alarm, so a laptop that slept through the refresh catches up.
- Also refresh on browser startup and on install.
- The background script owns fetching. The popup asks for refreshes by message. Only one refresh runs at a time.

**Bad networks**

- With no token, fetch `https://github.com/orgs/{org}/people` with `credentials: "include"` and parse it with `DOMParser`. Logins are the `href` of `li.member-list-item a[id^="member-"]`. Follow `a[rel="next"]`. A redirect ending in `/sso` means the SSO session expired. An empty `<meta name="user-login">` means signed out. Both are fatal with a clear message.
- With a token, get members from `GET /orgs/{org}/members?per_page=100` and follow the `Link` header's `rel="next"` for more pages.
- Stop after 50 pages either way.
- Time out each request after 15 seconds with `AbortController`.
- Retry up to 4 times with exponential backoff and full jitter. Retry on network errors, timeouts, 5xx, bodies that fail to parse as JSON, and `navigator.onLine === false`.
- Don't retry errors that won't fix themselves: 401 (bad token), 404 (org not found or no access), 403 (needs SSO), or rate limits with `x-ratelimit-remaining: 0`. Show when the rate limit resets. Honor a short `retry-after`.
- If a scheduled refresh fails with a retryable error, schedule a retry alarm at 5 minutes. Double it each time, up to 6 hours. Clear it on success.
- A failed refresh never wipes the cached list. The popup keeps working and says something like "Request timed out. Using list from 2d ago."
- Opening the PR search needs no API call. It always works from the cache.

**Popup status line**

Show the member count and how long ago the list was refreshed, or the last error, or "refreshing…". Include Refresh and Options links. Re-render when storage changes.

**Code rules**

- Put shared helpers in `lib.js` and load it before `background.js` and `popup.js`. Use plain scripts, not modules.
- Build DOM rows with `createElement` and `textContent`. Never use `innerHTML` with GitHub data.
- Support dark mode with `prefers-color-scheme`.
- Set `browser_specific_settings.gecko.id` to `crow-pr-reviewer-tracker@crow`, `data_collection_permissions: { required: ["none"] }`, and `strict_min_version: "142.0"`.
- Permissions are `storage` and `alarms`. The host permissions are `https://api.github.com/*` and `https://github.com/*`. Opening a tab with `browser.tabs.create` doesn't need the `tabs` permission.
- Draw your own icon. Don't copy GitHub's Octicons without their MIT notice.
- `npx web-ext lint` must report 0 errors and 0 warnings.

**Test it**

- Write Jest specs in `test/`. Load the real HTML and scripts into a fresh jsdom window per test, with a fake `browser` API and a `jest.fn()` `fetch`.
- Cover the search URL, username checks, retries (two network errors, then 502, then success), fatal errors stopping at once, both member sources, the background's refresh and retry alarms, and the popup and Options flows.
- Check with the search API that repeated `author:` terms are ORed.
- Add a GitHub Actions workflow that runs `npm test` and `npm run lint`. Keep dev files out of the package with `web-ext-config.mjs`.
- Ship an MIT `LICENSE`.

**README**

Cover requirements: Firefox 142+ desktop only, not Chrome. Cover setup with just a github.com login, and the optional token. Cover a temporary install through `about:debugging` → "Load Temporary Add-on". Cover a permanent private install: sign it with `web-ext sign --channel=unlisted` using addons.mozilla.org API keys, then open the `.xpi` it makes.
