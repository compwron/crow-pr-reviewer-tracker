// Loads the add-on's plain scripts into a fresh jsdom window per test, with a
// fake `browser` API, the way Firefox loads them into extension pages.
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const BLANK_PAGE = "<!doctype html><html><body></body></html>";

function listenerSlot() {
  const fns = [];
  return { fns, addListener: (fn) => fns.push(fn) };
}

function fakeBrowser(initialStore = {}) {
  const store = structuredClone(initialStore);
  const onChanged = listenerSlot();
  return {
    store,
    storage: {
      local: {
        get: jest.fn(async (defaults) => ({ ...structuredClone(defaults), ...structuredClone(store) })),
        set: jest.fn(async (patch) => {
          Object.assign(store, structuredClone(patch));
          onChanged.fns.forEach((fn) => fn(patch, "local"));
        }),
      },
      onChanged,
    },
    alarms: {
      create: jest.fn(),
      clear: jest.fn(async () => true),
      onAlarm: listenerSlot(),
    },
    runtime: {
      onInstalled: listenerSlot(),
      onStartup: listenerSlot(),
      onMessage: listenerSlot(),
      sendMessage: jest.fn(async () => ({ ok: true, count: 0 })),
      openOptionsPage: jest.fn(),
    },
    tabs: { create: jest.fn(async () => ({})) },
    permissions: {
      contains: jest.fn(async () => true),
      request: jest.fn(async () => true),
    },
  };
}

function loadPage({ html, scripts, browser, fetch = jest.fn() }) {
  const markup = html ? fs.readFileSync(path.join(ROOT, html), "utf8") : BLANK_PAGE;
  // Inline <script> elements share one global lexical scope, as in Firefox.
  // External <script src> tags in the HTML aren't fetched; the files are injected below.
  const scriptErrors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => scriptErrors.push(error));
  const { window } = new JSDOM(markup, { runScripts: "dangerously", url: "https://extension.test/", virtualConsole });
  window.browser = browser;
  window.fetch = fetch;
  // Zero backoff so retry tests don't wait
  window.Math.random = () => 0;
  window.close = jest.fn();
  scripts.forEach((file) => {
    const script = window.document.createElement("script");
    script.textContent = fs.readFileSync(path.join(ROOT, file), "utf8");
    window.document.body.append(script);
    // jsdom reports script errors to the console instead of throwing
    if (scriptErrors.length) throw new Error(`${file}: ${scriptErrors[0].message}`);
  });
  return window;
}

function response({ status = 200, body = "", headers = {}, url = "" } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    json: async () => JSON.parse(text),
    text: async () => text,
  };
}

function peoplePage({ logins, viewer = "me", next = null }) {
  const rows = logins
    .map(
      (login) =>
        `<li class="member-list-item"><a id="member-${login}" href="/${login}">${login}</a></li>`,
    )
    .join("");
  const nextLink = next ? `<a rel="next" href="${next}">Next</a>` : "";
  return `<html><head><meta name="user-login" content="${viewer}"></head><body><ul>${rows}</ul>${nextLink}</body></html>`;
}

// Lets chains of awaits and zero-delay timers inside the page run to completion
async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

module.exports = { fakeBrowser, loadPage, response, peoplePage, settle };
