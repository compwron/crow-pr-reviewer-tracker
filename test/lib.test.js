const { fakeBrowser, loadPage, response, peoplePage } = require("./helpers");

let browser;
let fetch;
let page;

const lib = (name) => page.eval(name);
const searchTerms = (url) => new URL(url).searchParams.get("q").split(" ");
const members = (...logins) => logins.map((login) => ({ login }));

beforeEach(() => {
  browser = fakeBrowser();
  fetch = jest.fn();
  page = loadPage({ scripts: ["lib.js"], browser, fetch });
});

describe("buildSearchUrl", () => {
  const base = { selected: ["alice", "bob"], includeDrafts: false, limitToOrg: true, org: "acme" };

  it("uses the /search page, since /pulls ANDs repeated author: terms", () => {
    const url = new URL(lib("buildSearchUrl")(base));
    expect(`${url.origin}${url.pathname}`).toBe("https://github.com/search");
    expect(url.searchParams.get("type")).toBe("pullrequests");
  });

  it("adds one author: term per person", () => {
    expect(searchTerms(lib("buildSearchUrl")(base))).toEqual([
      "is:pr",
      "is:open",
      "archived:false",
      "draft:false",
      "org:acme",
      "author:alice",
      "author:bob",
    ]);
  });

  context("with drafts included", () => {
    it("leaves out draft:false", () => {
      expect(searchTerms(lib("buildSearchUrl")({ ...base, includeDrafts: true }))).not.toContain("draft:false");
    });
  });

  context("with the org toggle off", () => {
    it("leaves out org:", () => {
      const terms = searchTerms(lib("buildSearchUrl")({ ...base, limitToOrg: false }));
      expect(terms.some((t) => t.startsWith("org:"))).toBe(false);
    });
  });

  context("when no org is set", () => {
    it("leaves out org: even with the toggle on", () => {
      const terms = searchTerms(lib("buildSearchUrl")({ ...base, org: "" }));
      expect(terms.some((t) => t.startsWith("org:"))).toBe(false);
    });
  });
});

describe("isValidUsername", () => {
  it.each(["a", "a-b", "A1", "x".repeat(39)])("accepts %s", (name) => {
    expect(lib("isValidUsername")(name)).toBe(true);
  });

  it.each(["", "-a", "a-", "a--b", "a_b", "a b", "x".repeat(40), "<script>"])("rejects %p", (name) => {
    expect(lib("isValidUsername")(name)).toBe(false);
  });
});

describe("formatAge", () => {
  const ago = (ms) => lib("formatAge")(Date.now() - ms);

  it("shows never for an empty timestamp", () => {
    expect(lib("formatAge")(0)).toBe("never");
  });

  it.each([
    [10 * 1000, "just now"],
    [5 * 60 * 1000, "5m ago"],
    [3 * 60 * 60 * 1000, "3h ago"],
    [3 * 24 * 60 * 60 * 1000, "3d ago"],
  ])("formats %d ms as %s", (ms, text) => {
    expect(ago(ms)).toBe(text);
  });
});

describe("nextLink", () => {
  it("finds the rel=next URL", () => {
    const header = '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=9>; rel="last"';
    expect(lib("nextLink")(header)).toBe("https://api.github.com/x?page=2");
  });

  it("returns null on the last page", () => {
    expect(lib("nextLink")('<https://api.github.com/x?page=1>; rel="prev"')).toBeNull();
    expect(lib("nextLink")(null)).toBeNull();
  });
});

describe("fetchOrgMembers with a token", () => {
  const fetchMembers = () => lib("fetchOrgMembers")("acme", "secret");

  it("follows Link pages and returns sorted, unique logins", async () => {
    fetch
      .mockResolvedValueOnce(
        response({ body: members("zed", "Bob"), headers: { Link: '<https://api.github.com/p2>; rel="next"' } }),
      )
      .mockResolvedValueOnce(response({ body: members("alice", "zed") }));

    expect([...(await fetchMembers())]).toEqual(["alice", "Bob", "zed"]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://api.github.com/orgs/acme/members?per_page=100",
      "https://api.github.com/p2",
    ]);
  });

  it("sends the token as a bearer header", async () => {
    fetch.mockResolvedValueOnce(response({ body: [] }));
    await fetchMembers();
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer secret");
  });

  it("doesn't need the github.com permission", async () => {
    fetch.mockResolvedValueOnce(response({ body: [] }));
    await fetchMembers();
    expect(browser.permissions.contains).not.toHaveBeenCalled();
  });

  it("stops after 50 pages", async () => {
    fetch.mockImplementation(async () =>
      response({ body: [], headers: { Link: '<https://api.github.com/again>; rel="next"' } }),
    );
    await fetchMembers();
    expect(fetch).toHaveBeenCalledTimes(50);
  });

  context("on a flaky network", () => {
    it("survives two network errors and a 502", async () => {
      fetch
        .mockRejectedValueOnce(new TypeError("NetworkError"))
        .mockRejectedValueOnce(new TypeError("NetworkError"))
        .mockResolvedValueOnce(response({ status: 502 }))
        .mockResolvedValueOnce(response({ body: members("alice") }));

      expect([...(await fetchMembers())]).toEqual(["alice"]);
      expect(fetch).toHaveBeenCalledTimes(4);
    });

    it("retries a truncated JSON body", async () => {
      fetch
        .mockResolvedValueOnce(response({ body: '[{"login":' }))
        .mockResolvedValueOnce(response({ body: members("alice") }));

      expect([...(await fetchMembers())]).toEqual(["alice"]);
    });

    it("reports a timeout after the last attempt", async () => {
      const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
      fetch.mockRejectedValue(abort);

      await expect(fetchMembers()).rejects.toThrow("Request timed out");
      expect(fetch).toHaveBeenCalledTimes(4);
    });

    it("gives up after 4 server errors", async () => {
      fetch.mockResolvedValue(response({ status: 503 }));
      await expect(fetchMembers()).rejects.toThrow("GitHub returned 503");
      expect(fetch).toHaveBeenCalledTimes(4);
    });

    it("waits out a short retry-after", async () => {
      fetch
        .mockResolvedValueOnce(response({ status: 429, headers: { "retry-after": "1" } }))
        .mockResolvedValueOnce(response({ body: members("alice") }));

      expect([...(await fetchMembers())]).toEqual(["alice"]);
    });
  });

  context("when the browser is offline", () => {
    it("doesn't call fetch and reports offline", async () => {
      Object.defineProperty(page.navigator, "onLine", { get: () => false });
      await expect(fetchMembers()).rejects.toThrow("Offline");
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  context("with errors that won't fix themselves", () => {
    it.each([
      [401, {}, "rejected the token"],
      [404, {}, "Org not found"],
      [403, {}, "SSO"],
      [403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "2000000000" }, "Rate limited until"],
    ])("stops at once on %d", async (status, headers, message) => {
      fetch.mockResolvedValue(response({ status, headers }));

      const error = await fetchMembers().catch((e) => e);
      expect(error.constructor.name).toBe("FatalError");
      expect(error.message).toContain(message);
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });
});

describe("fetchOrgMembers without a token", () => {
  const fetchMembers = () => lib("fetchOrgMembers")("acme", "");
  const page1 = "https://github.com/orgs/acme/people";

  it("reads the People page with the browser's github.com login", async () => {
    fetch.mockResolvedValueOnce(response({ url: page1, body: peoplePage({ logins: ["bob", "alice"] }) }));

    expect([...(await fetchMembers())]).toEqual(["alice", "bob"]);
    expect(fetch.mock.calls[0][0]).toBe(page1);
    expect(fetch.mock.calls[0][1].credentials).toBe("include");
    expect(fetch.mock.calls[0][1].headers).toBeUndefined();
  });

  it("follows the relative next link", async () => {
    fetch
      .mockResolvedValueOnce(
        response({ url: page1, body: peoplePage({ logins: ["alice"], next: "/orgs/acme/people?page=2" }) }),
      )
      .mockResolvedValueOnce(response({ url: `${page1}?page=2`, body: peoplePage({ logins: ["bob"] }) }));

    expect([...(await fetchMembers())]).toEqual(["alice", "bob"]);
    expect(fetch.mock.calls[1][0]).toBe(`${page1}?page=2`);
  });

  it("ignores links that aren't member rows", async () => {
    const body = peoplePage({ logins: ["alice"] }).replace(
      "</ul>",
      '</ul><a id="member-ghost" href="/ghost">outside a row</a><li class="member-list-item"><a href="/about">x</a></li>',
    );
    fetch.mockResolvedValueOnce(response({ url: page1, body }));

    expect([...(await fetchMembers())]).toEqual(["alice"]);
  });

  it("retries a network error", async () => {
    fetch
      .mockRejectedValueOnce(new TypeError("NetworkError"))
      .mockResolvedValueOnce(response({ url: page1, body: peoplePage({ logins: ["alice"] }) }));

    expect([...(await fetchMembers())]).toEqual(["alice"]);
  });

  context("without the github.com permission", () => {
    it("asks for it and makes no request", async () => {
      browser.permissions.contains.mockResolvedValue(false);

      await expect(fetchMembers()).rejects.toThrow("Allow github.com access");
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  context("when signed out of github.com", () => {
    it("says to sign in", async () => {
      fetch.mockResolvedValueOnce(response({ url: page1, body: peoplePage({ logins: ["alice"], viewer: "" }) }));

      const error = await fetchMembers().catch((e) => e);
      expect(error.constructor.name).toBe("FatalError");
      expect(error.message).toContain("Sign in to github.com");
    });
  });

  context("when the org's SSO session expired", () => {
    it("says to sign in with SSO", async () => {
      fetch.mockResolvedValueOnce(response({ url: "https://github.com/orgs/acme/sso?return_to=x", body: "" }));
      await expect(fetchMembers()).rejects.toThrow("Sign in to acme with SSO");
    });
  });

  context("when the page has no member rows", () => {
    it("points to typing names or adding a token", async () => {
      fetch.mockResolvedValueOnce(response({ url: page1, body: peoplePage({ logins: [] }) }));
      await expect(fetchMembers()).rejects.toThrow("add a token in Options");
    });
  });
});
