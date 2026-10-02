# Crow PR Reviewer Tracker

Firefox toolbar button. Pick people from your GitHub org, click **Open PRs**, and get a
GitHub search of their open PRs. A toggle includes or hides drafts.

It uses `github.com/search`, not `github.com/pulls`. The `/pulls` page ANDs repeated `author:`
terms, so two or more people would match nothing.

- The org member list is cached and refreshed once a day. It is checked hourly, so a sleeping laptop catches up on wake.
- Your picks and toggles are saved in the browser profile. Unchecked picks stay at the top. Click × to drop one.
- Click ↗ on any row to open just that person's PRs, with the same toggles.
- On a bad network, requests time out after 15s and retry with backoff. Failed daily refreshes retry every 5 min, then 10, up to 6h. The old list stays usable the whole time.
- You can type a username and press Enter to add someone who isn't in the list.

## Requirements

- Firefox 142 or newer, desktop. It is a Firefox-only Manifest V3 add-on. It does not run in Chrome.
- A github.com login in the same Firefox, or a GitHub token.

## Setup

1. Install the extension. See below.
2. Sign in to github.com in the same Firefox. For an SSO org, open the org once so the SSO session is active.
3. Open the extension's Options. Enter your org. Click **Save and test**.

No token is needed. The member list is read from the org's People page with your github.com login.
If that fails, paste a classic token with the `read:org` scope in Options. The API is used instead.

## Install for just me

### Quick, lasts until Firefox restarts

1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and pick `manifest.json` in this folder.

### Permanent, still private

Release Firefox only installs signed add-ons. An "unlisted" signature is private. It is not published on addons.mozilla.org.

1. Make API keys at https://addons.mozilla.org/developers/addon/api/key/
2. Run:

   ```sh
   npx web-ext sign --channel=unlisted --source-dir . \
     --api-key "$AMO_JWT_ISSUER" --api-secret "$AMO_JWT_SECRET"
   ```

3. Open the `.xpi` it writes to `web-ext-artifacts/` in Firefox.

For updates, bump `version` in `manifest.json` and sign again.

## Develop

Needs Node 22 or newer. The add-on itself has no build step. `npm` is only for tests and lint.

```sh
npm install
npm start                 # scratch Firefox with the add-on loaded
npm test                  # Jest specs in test/
npx jest test/popup.test.js -t "Enter adds"   # one file or one test
npm run lint              # web-ext lint, must be 0 errors and 0 warnings
```

`web-ext-config.mjs` keeps tests, docs, and npm files out of the packaged add-on.
GitHub Actions runs `npm test` and `npm run lint` on every push and pull request.

## License

MIT. See [LICENSE](LICENSE).

To rebuild this from scratch with an AI agent, see [PROMPT.md](PROMPT.md).
