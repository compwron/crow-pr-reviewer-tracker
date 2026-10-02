const { fakeBrowser, loadPage, response, settle } = require("./helpers");

const DAY_MS = 24 * 60 * 60 * 1000;

let browser;
let fetch;

function loadBackground(store) {
  browser = fakeBrowser({ org: "acme", token: "secret", ...store });
  fetch = jest.fn();
  loadPage({ scripts: ["lib.js", "background.js"], browser, fetch });
}

const sendMessage = (message) => browser.runtime.onMessage.fns[0](message);
const fireAlarm = (name) => browser.alarms.onAlarm.fns[0]({ name });
const retryAlarmCalls = () => browser.alarms.create.mock.calls.filter(([name]) => name === "members-retry");

describe("refresh", () => {
  context("when the cached list is under a day old", () => {
    beforeEach(() => loadBackground({ members: ["alice"], membersFetchedAt: Date.now() - 1000 }));

    it("skips the fetch", async () => {
      expect(await sendMessage({ type: "refresh" })).toMatchObject({ ok: true, skipped: true });
      expect(fetch).not.toHaveBeenCalled();
    });

    it("fetches anyway when forced", async () => {
      fetch.mockResolvedValueOnce(response({ body: [{ login: "bob" }] }));
      expect(await sendMessage({ type: "refresh", force: true })).toMatchObject({ ok: true, count: 1 });
      expect(browser.store.members).toEqual(["bob"]);
    });
  });

  context("when the cached list is stale", () => {
    beforeEach(() => loadBackground({ members: ["alice"], membersFetchedAt: Date.now() - DAY_MS - 1 }));

    it("stores the new list and clears old errors", async () => {
      browser.store.lastError = "old";
      browser.store.retryDelayMinutes = 40;
      fetch.mockResolvedValueOnce(response({ body: [{ login: "bob" }, { login: "alice" }] }));

      await sendMessage({ type: "refresh" });

      expect(browser.store).toMatchObject({ members: ["alice", "bob"], lastError: null, retryDelayMinutes: 0 });
      expect(browser.store.membersFetchedAt).toBeGreaterThan(Date.now() - 1000);
      expect(browser.alarms.clear).toHaveBeenCalledWith("members-retry");
    });

    it("runs one fetch for overlapping requests", async () => {
      fetch.mockResolvedValue(response({ body: [{ login: "bob" }] }));

      const [first, second] = await Promise.all([sendMessage({ type: "refresh" }), sendMessage({ type: "refresh" })]);

      expect(first).toBe(second);
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  context("when no org is set", () => {
    beforeEach(() => loadBackground({ org: "" }));

    it("says to set one and doesn't fetch", async () => {
      expect(await sendMessage({ type: "refresh", force: true })).toMatchObject({ ok: false });
      expect(browser.store.lastError).toBe("Set an organization in Options.");
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  context("when the fetch keeps failing", () => {
    beforeEach(() => loadBackground({ members: ["alice"], membersFetchedAt: 1 }));

    it("keeps the cached list and reports the error", async () => {
      fetch.mockResolvedValue(response({ status: 503 }));

      expect(await sendMessage({ type: "refresh" })).toMatchObject({ ok: false, error: "GitHub returned 503" });
      expect(browser.store).toMatchObject({ members: ["alice"], membersFetchedAt: 1, lastError: "GitHub returned 503" });
    });

    it("schedules retries at 5, 10, 20 minutes and caps at 6 hours", async () => {
      fetch.mockResolvedValue(response({ status: 503 }));

      for (let i = 0; i < 10; i++) await sendMessage({ type: "refresh", force: true });

      expect(retryAlarmCalls().map(([, info]) => info.delayInMinutes)).toEqual([
        5, 10, 20, 40, 80, 160, 320, 360, 360, 360,
      ]);
    });
  });

  context("when the error won't fix itself", () => {
    beforeEach(() => loadBackground({ members: ["alice"], membersFetchedAt: 1 }));

    it("doesn't schedule a retry", async () => {
      fetch.mockResolvedValue(response({ status: 401 }));

      await sendMessage({ type: "refresh" });

      expect(retryAlarmCalls()).toEqual([]);
      expect(browser.store).toMatchObject({ members: ["alice"], retryDelayMinutes: 0 });
      expect(browser.store.lastError).toContain("401");
    });
  });
});

describe("events", () => {
  it("ignores unknown messages", () => {
    loadBackground({});
    expect(sendMessage({ type: "other" })).toBeUndefined();
    expect(sendMessage(undefined)).toBeUndefined();
  });

  it("forces a refresh when the retry alarm fires", async () => {
    loadBackground({ members: ["alice"], membersFetchedAt: Date.now() });
    fetch.mockResolvedValueOnce(response({ body: [{ login: "bob" }] }));

    fireAlarm("members-retry");
    await settle();

    expect(browser.store.members).toEqual(["bob"]);
  });

  it("checks freshness when the hourly alarm fires", async () => {
    loadBackground({ members: ["alice"], membersFetchedAt: Date.now() });

    fireAlarm("members-check");
    await settle();

    expect(fetch).not.toHaveBeenCalled();
  });

  context("on first install with no org", () => {
    beforeEach(() => loadBackground({ org: "" }));

    it("opens Options and sets the hourly check", async () => {
      await browser.runtime.onInstalled.fns[0]({ reason: "install" });

      expect(browser.runtime.openOptionsPage).toHaveBeenCalled();
      expect(browser.alarms.create).toHaveBeenCalledWith("members-check", { periodInMinutes: 60 });
    });
  });

  context("on update with an org set", () => {
    beforeEach(() => loadBackground({ members: [], membersFetchedAt: 0 }));

    it("refreshes instead of opening Options", async () => {
      fetch.mockResolvedValueOnce(response({ body: [{ login: "bob" }] }));

      await browser.runtime.onInstalled.fns[0]({ reason: "update" });
      await settle();

      expect(browser.runtime.openOptionsPage).not.toHaveBeenCalled();
      expect(browser.store.members).toEqual(["bob"]);
    });
  });

  context("on browser startup", () => {
    beforeEach(() => loadBackground({ members: [], membersFetchedAt: 0 }));

    it("refreshes and sets the hourly check", async () => {
      fetch.mockResolvedValueOnce(response({ body: [{ login: "bob" }] }));

      browser.runtime.onStartup.fns[0]();
      await settle();

      expect(browser.alarms.create).toHaveBeenCalledWith("members-check", { periodInMinutes: 60 });
      expect(browser.store.members).toEqual(["bob"]);
    });
  });
});
