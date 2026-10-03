const { fakeBrowser, loadPage, settle } = require("./helpers");

const DAY_MS = 24 * 60 * 60 * 1000;

let browser;
let page;

async function openPopup(store = {}) {
  browser = fakeBrowser({
    org: "acme",
    members: ["alice", "bob", "carol", "dave"],
    membersFetchedAt: Date.now() - 60 * 1000,
    ...store,
  });
  page = loadPage({ html: "popup.html", scripts: ["lib.js", "popup.js"], browser });
  await settle();
}

const $ = (selector) => page.document.querySelector(selector);
const rows = () => [...page.document.querySelectorAll("#list li")];
const loginOf = (li) => li.querySelector("label span").textContent;
const listedLogins = () => rows().map(loginOf);
const rowFor = (login) => rows().find((li) => loginOf(li) === login);
const checkboxFor = (login) => rowFor(login).querySelector("input[type=checkbox]");
const text = (selector) => $(selector).textContent;
const searchTerms = (url) => new URL(url).searchParams.get("q").split(" ");
const openedUrl = () => browser.tabs.create.mock.calls[0][0].url;

async function click(element) {
  element.click();
  await settle();
}

async function typeInFilter(value) {
  $("#filter").value = value;
  $("#filter").dispatchEvent(new page.Event("input"));
  await settle();
}

async function pressEnter() {
  $("#filter").dispatchEvent(new page.KeyboardEvent("keydown", { key: "Enter" }));
  await settle();
}

describe("the list", () => {
  context("with nobody picked", () => {
    beforeEach(() => openPopup());

    it("lists org members in order and disables Open PRs", () => {
      expect(listedLogins()).toEqual(["alice", "bob", "carol", "dave"]);
      expect($("#open").disabled).toBe(true);
      expect(text("#count")).toBe("Pick people below");
      expect($("#clear").hidden).toBe(true);
    });

    it("shows the org name on the org toggle", () => {
      expect(text("#orgName")).toBe("acme");
      expect($("#limitToOrgLabel").hidden).toBe(false);
    });
  });

  context("with picks", () => {
    beforeEach(() => openPopup({ selected: ["dave"], pinned: ["carol", "dave"] }));

    it("puts picked and pinned people on top, then a divider", () => {
      expect(listedLogins()).toEqual(["carol", "dave", "alice", "bob"]);
      expect(rowFor("alice").classList.contains("divider")).toBe(true);
      expect(checkboxFor("dave").checked).toBe(true);
      expect(checkboxFor("carol").checked).toBe(false);
    });

    it("shows the count and Clear", () => {
      expect(text("#count")).toBe("1 selected");
      expect($("#open").disabled).toBe(false);
      expect($("#clear").hidden).toBe(false);
    });

    it("offers × only on unchecked pinned rows", () => {
      expect(rowFor("carol").querySelector(".remove")).not.toBeNull();
      expect(rowFor("dave").querySelector(".remove")).toBeNull();
      expect(rowFor("alice").querySelector(".remove")).toBeNull();
    });
  });

  context("when a pick has left the org", () => {
    beforeEach(() => openPopup({ selected: ["zoe"], pinned: ["zoe"] }));

    it("tags the row", () => {
      expect(rowFor("zoe").querySelector(".tag").textContent).toBe("not in org list");
      expect(rowFor("alice").querySelector(".tag")).toBeNull();
    });
  });

  context("when no org is set", () => {
    beforeEach(() => openPopup({ org: "", members: [] }));

    it("hides the org toggle", () => {
      expect($("#limitToOrgLabel").hidden).toBe(true);
    });
  });

  context("with markup in a login from the People page", () => {
    const hostile = '<img src=x onerror="window.pwned=1">';
    beforeEach(() => openPopup({ members: [hostile] }));

    it("renders it as text", () => {
      expect(listedLogins()).toEqual([hostile]);
      expect(page.document.querySelector("#list img")).toBeNull();
      expect(page.pwned).toBeUndefined();
    });
  });
});

describe("picking", () => {
  beforeEach(() => openPopup());

  it("checking saves the pick and moves it to the top", async () => {
    await click(checkboxFor("carol"));

    expect(browser.store).toMatchObject({ selected: ["carol"], pinned: ["carol"] });
    expect(listedLogins()[0]).toBe("carol");
    expect(text("#count")).toBe("1 selected");
  });

  it("unchecking keeps the person on top, unchecked", async () => {
    await click(checkboxFor("carol"));
    await click(checkboxFor("carol"));

    expect(browser.store).toMatchObject({ selected: [], pinned: ["carol"] });
    expect(listedLogins()[0]).toBe("carol");
    expect(checkboxFor("carol").checked).toBe(false);
  });

  it("× drops an unchecked pick from the top", async () => {
    await click(checkboxFor("carol"));
    await click(checkboxFor("carol"));
    await click(rowFor("carol").querySelector(".remove"));

    expect(browser.store).toMatchObject({ selected: [], pinned: [] });
    expect(listedLogins()).toEqual(["alice", "bob", "carol", "dave"]);
  });

  it("Clear unchecks everyone but keeps them on top", async () => {
    await click(checkboxFor("bob"));
    await click(checkboxFor("dave"));
    await click($("#clear"));

    expect(browser.store).toMatchObject({ selected: [], pinned: ["bob", "dave"] });
    expect(listedLogins().slice(0, 2)).toEqual(["bob", "dave"]);
    expect(rows().every((li) => !li.querySelector("input").checked)).toBe(true);
  });
});

describe("the filter box", () => {
  beforeEach(() => openPopup({ selected: ["dave"], pinned: ["dave"] }));

  it("narrows the list, ignoring case", async () => {
    await typeInFilter("A");
    expect(listedLogins()).toEqual(["dave", "alice", "carol"]);
  });

  it("Enter adds a typed username outside the org", async () => {
    await typeInFilter("@New-Person");
    await pressEnter();

    expect(browser.store.selected).toEqual(["dave", "New-Person"]);
    expect($("#filter").value).toBe("");
    expect(rowFor("New-Person").querySelector(".tag").textContent).toBe("not in org list");
  });

  it("Enter uses the org's spelling of a member", async () => {
    await typeInFilter("ALICE");
    await pressEnter();

    expect(browser.store.selected).toEqual(["alice", "dave"]);
  });

  it.each(["bad name", "-bad", "<script>", ""])("Enter ignores %p", async (typed) => {
    await typeInFilter(typed);
    await pressEnter();

    expect(browser.store.selected).toEqual(["dave"]);
    expect($("#filter").value).toBe(typed);
  });
});

describe("opening PRs", () => {
  beforeEach(() => openPopup({ selected: ["bob", "dave"], pinned: ["bob", "dave"] }));

  it("Open PRs searches for everyone checked and closes the popup", async () => {
    await click($("#open"));

    expect(searchTerms(openedUrl())).toEqual(expect.arrayContaining(["author:bob", "author:dave", "org:acme"]));
    expect(page.close).toHaveBeenCalled();
  });

  it("↗ searches for just that person", async () => {
    await click(rowFor("carol").querySelector(".solo"));

    const authors = searchTerms(openedUrl()).filter((t) => t.startsWith("author:"));
    expect(authors).toEqual(["author:carol"]);
  });

  it("↗ leaves the picks alone", async () => {
    await click(rowFor("carol").querySelector(".solo"));
    expect(browser.store.selected).toEqual(["bob", "dave"]);
  });

  it("uses the current toggles", async () => {
    await click($("#includeDrafts"));
    await click($("#limitToOrg"));
    await click(rowFor("bob").querySelector(".solo"));

    expect(browser.store).toMatchObject({ includeDrafts: true, limitToOrg: false });
    const terms = searchTerms(openedUrl());
    expect(terms).not.toContain("draft:false");
    expect(terms).not.toContain("org:acme");
  });
});

describe("random(3)", () => {
  const authorsOpened = () =>
    searchTerms(openedUrl())
      .filter((t) => t.startsWith("author:"))
      .map((t) => t.slice("author:".length));

  context("with more than 3 people unchecked", () => {
    beforeEach(() =>
      openPopup({ members: ["alice", "bob", "carol", "dave", "erin", "frank"], selected: ["bob"], pinned: ["bob"] }),
    );

    it("opens PRs for 3 different people who aren't checked", async () => {
      await click($("#random"));

      const authors = authorsOpened();
      expect(authors).toHaveLength(3);
      expect(new Set(authors).size).toBe(3);
      expect(authors).not.toContain("bob");
      expect(page.close).toHaveBeenCalled();
    });

    it("leaves the picks alone", async () => {
      await click($("#random"));
      expect(browser.store).toMatchObject({ selected: ["bob"], pinned: ["bob"] });
    });
  });

  context("with fewer than 3 people unchecked", () => {
    beforeEach(() => openPopup({ selected: ["alice", "bob"], pinned: ["alice", "bob"] }));

    it("opens PRs for everyone left", async () => {
      await click($("#random"));
      expect(authorsOpened().sort()).toEqual(["carol", "dave"]);
    });
  });

  context("with everyone checked", () => {
    beforeEach(() => openPopup({ selected: ["alice", "bob", "carol", "dave"] }));

    it("is disabled", () => {
      expect($("#random").disabled).toBe(true);
    });
  });

  context("with no people cached", () => {
    beforeEach(() => openPopup({ members: [] }));

    it("is disabled", () => {
      expect($("#random").disabled).toBe(true);
    });
  });
});

describe("the status line", () => {
  it("shows the count and age", async () => {
    await openPopup();
    expect(text("#status")).toBe("4 people · updated 1m ago");
  });

  context("when the last refresh failed but a list is cached", () => {
    beforeEach(() => openPopup({ lastError: "Request timed out", membersFetchedAt: Date.now() - 2 * DAY_MS }));

    it("warns and keeps using the cache", () => {
      expect(text("#status")).toBe("Request timed out Using list from 2d ago.");
      expect($("#status").className).toBe("warn");
    });
  });

  context("when nothing is cached and the refresh failed", () => {
    beforeEach(() => openPopup({ members: [], lastError: "Sign in to github.com in this browser, then refresh." }));

    it("says names can still be typed", () => {
      expect(text("#status")).toContain("You can still type usernames.");
      expect($("#status").className).toBe("error");
    });
  });

  context("when the cache is a day old", () => {
    beforeEach(() => openPopup({ membersFetchedAt: Date.now() - DAY_MS }));

    it("asks the background for a refresh", () => {
      expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: "refresh", force: false });
    });
  });

  context("when the cache is fresh", () => {
    beforeEach(() => openPopup());

    it("doesn't ask for a refresh", () => {
      expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it("Refresh forces one", async () => {
      await click($("#refresh"));
      expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: "refresh", force: true });
    });

    it("Options opens the settings page", async () => {
      await click($("#options"));
      expect(browser.runtime.openOptionsPage).toHaveBeenCalled();
    });

    it("updates when the background stores a new list", async () => {
      await browser.storage.local.set({ members: ["alice", "bob"], membersFetchedAt: Date.now() });
      await settle();
      expect(text("#status")).toBe("2 people · updated just now");
    });
  });

  context("while the background page is restarting", () => {
    beforeEach(() => openPopup());

    it("doesn't get stuck on refreshing", async () => {
      browser.runtime.sendMessage.mockRejectedValueOnce(new Error("Receiving end does not exist"));
      await click($("#refresh"));
      expect(text("#status")).not.toContain("refreshing");
    });
  });
});
