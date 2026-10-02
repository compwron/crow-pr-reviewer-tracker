// Shared by background.js and popup.js (loaded as a plain script, not a module).

const DAY_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_ATTEMPTS = 4;
const MAX_PAGES = 50;

const DEFAULTS = {
  org: "",
  token: "",
  includeDrafts: false,
  limitToOrg: true,
  selected: [],
  // Everyone ever checked, so unchecking keeps them on the list instead of dropping them
  pinned: [],
  members: [],
  membersFetchedAt: 0,
  lastAttemptAt: 0,
  lastError: null,
  retryDelayMinutes: 0,
};

const GITHUB_ORIGIN = "https://github.com/*";

const USERNAME_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

function getState() {
  return browser.storage.local.get(DEFAULTS);
}

function setState(patch) {
  return browser.storage.local.set(patch);
}

function isValidUsername(name) {
  return USERNAME_RE.test(name);
}

function byLogin(a, b) {
  return a.toLowerCase().localeCompare(b.toLowerCase());
}

function buildSearchUrl({ selected, includeDrafts, limitToOrg, org }) {
  const terms = ["is:pr", "is:open", "archived:false"];
  if (!includeDrafts) terms.push("draft:false");
  if (limitToOrg && org) terms.push(`org:${org}`);
  // /search ORs repeated author: qualifiers. The /pulls dashboard ANDs them,
  // so any two authors there match nothing.
  selected.forEach((login) => terms.push(`author:${login}`));
  return `https://github.com/search?type=pullrequests&q=${encodeURIComponent(terms.join(" "))}`;
}

function formatAge(ms) {
  if (!ms) return "never";
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

class FatalError extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Exponential backoff with full jitter so retries after a flaky network don't bunch up
function backoffMs(attempt) {
  return Math.random() * Math.min(30000, 1000 * 2 ** attempt);
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

// read turns a successful response into data. A throw from it is retried,
// since a body that fails to parse is usually a dropped connection.
async function fetchWithRetry(url, options, read) {
  let lastError;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(backoffMs(attempt));
    if (!navigator.onLine) {
      lastError = new Error("Offline");
      continue;
    }

    let res;
    try {
      res = await fetchWithTimeout(url, options);
    } catch (e) {
      lastError = new Error(e.name === "AbortError" ? "Request timed out" : `Network error: ${e.message}`);
      continue;
    }

    if (res.ok) {
      try {
        return { data: await read(res), res };
      } catch (e) {
        // Truncated body from a dropped connection
        lastError = new Error("Incomplete response from GitHub");
        continue;
      }
    }

    if (res.status === 401) {
      throw new FatalError("GitHub rejected the token (401). Update it in Options.");
    }
    if (res.status === 404) {
      throw new FatalError("Org not found, or you can't see its members (404).");
    }
    if (res.status === 403 || res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after"));
      if (res.headers.get("x-ratelimit-remaining") === "0") {
        const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
        throw new FatalError(`Rate limited until ${new Date(reset).toLocaleTimeString()}.`);
      }
      if (retryAfter && retryAfter <= 60) {
        await sleep(retryAfter * 1000);
        lastError = new Error(`GitHub asked to slow down (${res.status})`);
        continue;
      }
      if (res.status === 403) {
        throw new FatalError("Forbidden (403). The token may need SSO authorization for the org.");
      }
    }
    lastError = new Error(`GitHub returned ${res.status}`);
  }
  throw lastError;
}

function nextLink(linkHeader) {
  if (!linkHeader) return null;
  const match = linkHeader.split(",").find((part) => /rel="next"/.test(part));
  return match ? match.match(/<([^>]+)>/)[1] : null;
}

function fetchOrgMembers(org, token) {
  return token ? fetchOrgMembersFromApi(org, token) : fetchOrgMembersFromSession(org);
}

async function fetchOrgMembersFromApi(org, token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    Authorization: `Bearer ${token}`,
  };

  const logins = new Set();
  let url = `https://api.github.com/orgs/${encodeURIComponent(org)}/members?per_page=100`;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const { data, res } = await fetchWithRetry(url, { headers }, (r) => r.json());
    data.forEach((member) => logins.add(member.login));
    url = nextLink(res.headers.get("Link"));
  }
  return [...logins].sort(byLogin);
}

// No token: read the org's People page with the browser's github.com login.
// Members see everyone there, including private members the public API hides.
async function fetchOrgMembersFromSession(org) {
  if (!(await browser.permissions.contains({ origins: [GITHUB_ORIGIN] }))) {
    throw new FatalError("Allow github.com access: open Options and click Save and test.");
  }
  const logins = new Set();
  let url = `https://github.com/orgs/${encodeURIComponent(org)}/people`;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const { data: html, res } = await fetchWithRetry(url, { credentials: "include" }, (r) => r.text());
    if (new URL(res.url).pathname.endsWith("/sso")) {
      throw new FatalError(`Sign in to ${org} with SSO on github.com, then refresh.`);
    }
    const doc = new DOMParser().parseFromString(html, "text/html");
    if (!doc.querySelector('meta[name="user-login"]')?.content) {
      throw new FatalError("Sign in to github.com in this browser, then refresh.");
    }
    doc.querySelectorAll("li.member-list-item a[id^='member-']").forEach((a) => {
      logins.add(a.getAttribute("href").slice(1));
    });
    const next = doc.querySelector('a[rel="next"]');
    url = next ? new URL(next.getAttribute("href"), url).href : null;
  }
  if (!logins.size) {
    throw new FatalError("Couldn't read the org's People page. Type usernames, or add a token in Options.");
  }
  return [...logins].sort(byLogin);
}
