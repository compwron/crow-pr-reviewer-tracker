const { fakeBrowser, loadPage, settle } = require("./helpers");

let browser;
let page;

async function openOptions(store = {}) {
  browser = fakeBrowser(store);
  page = loadPage({ html: "options.html", scripts: ["lib.js", "options.js"], browser });
  await settle();
}

const $ = (selector) => page.document.querySelector(selector);
const result = () => $("#result");

async function save({ org, token }) {
  if (org !== undefined) $("#org").value = org;
  if (token !== undefined) $("#token").value = token;
  $("#save").click();
  await settle();
}

describe("Options", () => {
  it("fills in the saved org and token", async () => {
    await openOptions({ org: "acme", token: "secret" });
    expect([$("#org").value, $("#token").value]).toEqual(["acme", "secret"]);
  });

  context("with no org typed", () => {
    beforeEach(() => openOptions());

    it("refuses to save", async () => {
      await save({ org: "  " });

      expect(result().textContent).toBe("Organization is required.");
      expect(browser.storage.local.set).not.toHaveBeenCalled();
    });
  });

  context("with no token", () => {
    beforeEach(() => openOptions());

    it("asks for github.com access, then saves and tests", async () => {
      browser.runtime.sendMessage.mockResolvedValueOnce({ ok: true, count: 137 });

      await save({ org: " acme ", token: "" });

      expect(browser.permissions.request).toHaveBeenCalledWith({ origins: ["https://github.com/*"] });
      expect(browser.store).toMatchObject({ org: "acme", token: "", lastError: null });
      expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: "refresh", force: true });
      expect(result().textContent).toBe("Saved. Loaded 137 people.");
    });

    it("saves nothing when access is denied", async () => {
      browser.permissions.request.mockResolvedValueOnce(false);

      await save({ org: "acme", token: "" });

      expect(result().textContent).toBe("Allow github.com access, or paste a token.");
      expect(browser.storage.local.set).not.toHaveBeenCalled();
    });
  });

  context("with a token", () => {
    beforeEach(() => openOptions());

    it("skips the github.com prompt and trims the token", async () => {
      await save({ org: "acme", token: " secret " });

      expect(browser.permissions.request).not.toHaveBeenCalled();
      expect(browser.store.token).toBe("secret");
    });
  });

  context("when the org changes", () => {
    beforeEach(() => openOptions({ org: "old", members: ["alice"], membersFetchedAt: 5 }));

    it("drops the old org's member list", async () => {
      await save({ org: "new" });
      expect(browser.store).toMatchObject({ org: "new", members: [], membersFetchedAt: 0 });
    });
  });

  context("when the org stays the same", () => {
    beforeEach(() => openOptions({ org: "acme", members: ["alice"], membersFetchedAt: 5 }));

    it("keeps the cached list", async () => {
      browser.runtime.sendMessage.mockResolvedValueOnce({ ok: false, error: "Request timed out" });

      await save({ org: "acme" });

      expect(browser.store).toMatchObject({ members: ["alice"], membersFetchedAt: 5 });
      expect(result().textContent).toBe("Saved, but: Request timed out");
      expect(result().className).toBe("error");
    });
  });

  context("when the background page doesn't answer", () => {
    beforeEach(() => openOptions());

    it("reports the failure and re-enables the button", async () => {
      browser.runtime.sendMessage.mockRejectedValueOnce(new Error("Receiving end does not exist"));

      await save({ org: "acme" });

      expect(result().textContent).toBe("Saved, but the test failed: Receiving end does not exist");
      expect($("#save").disabled).toBe(false);
    });
  });
});
