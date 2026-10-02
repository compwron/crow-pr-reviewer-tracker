const els = {
  open: document.getElementById("open"),
  count: document.getElementById("count"),
  clear: document.getElementById("clear"),
  includeDrafts: document.getElementById("includeDrafts"),
  limitToOrg: document.getElementById("limitToOrg"),
  orgName: document.getElementById("orgName"),
  filter: document.getElementById("filter"),
  list: document.getElementById("list"),
  status: document.getElementById("status"),
  refresh: document.getElementById("refresh"),
  options: document.getElementById("options"),
};

let state = null;
let refreshing = false;

async function load() {
  state = await getState();
  els.includeDrafts.checked = state.includeDrafts;
  els.limitToOrg.checked = state.limitToOrg;
  els.orgName.textContent = state.org;
  document.getElementById("limitToOrgLabel").hidden = !state.org;
  render();
  if (!state.members.length || Date.now() - state.membersFetchedAt >= DAY_MS) refresh(false);
}

function render() {
  renderHeader();
  renderList();
  renderStatus();
}

function renderHeader() {
  const n = state.selected.length;
  els.open.disabled = n === 0;
  els.count.textContent = n ? `${n} selected` : "Pick people below";
  els.clear.hidden = n === 0;
}

function renderList() {
  const query = els.filter.value.trim().toLowerCase();
  const selected = new Set(state.selected);
  const pinned = new Set([...state.pinned, ...state.selected]);
  const members = new Set(state.members);
  const matches = (login) => login.toLowerCase().includes(query);

  const picked = [...pinned].filter(matches).sort(byLogin);
  const rest = state.members.filter((login) => !pinned.has(login) && matches(login));

  els.list.replaceChildren(
    ...picked.map((login) =>
      row(login, selected.has(login), members.has(login) ? "" : "not in org list", false, true),
    ),
    ...rest.map((login, i) => row(login, false, "", i === 0 && picked.length > 0)),
  );
}

function row(login, checked, tag, divider = false, removable = false) {
  const li = document.createElement("li");
  if (divider) li.className = "divider";
  const label = document.createElement("label");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = checked;
  box.addEventListener("change", () => toggle(login, box.checked));
  const name = document.createElement("span");
  name.textContent = login;
  label.append(box, name);
  if (tag) {
    const tagEl = document.createElement("span");
    tagEl.className = "tag";
    tagEl.textContent = tag;
    label.append(tagEl);
  }
  li.append(label);
  const solo = document.createElement("button");
  solo.className = "link solo";
  solo.title = `Open PRs by ${login} only`;
  solo.textContent = "↗";
  solo.addEventListener("click", () => openPrs([login]));
  li.append(solo);
  if (removable && !checked) {
    const remove = document.createElement("button");
    remove.className = "link remove";
    remove.title = `Remove ${login} from the list`;
    remove.textContent = "×";
    remove.addEventListener("click", () => unpin(login));
    li.append(remove);
  }
  return li;
}

function renderStatus() {
  const { members, membersFetchedAt, lastError } = state;
  els.status.className = "muted";
  if (refreshing) {
    els.status.textContent = members.length ? `${members.length} people · refreshing…` : "Loading people…";
    return;
  }
  if (lastError) {
    els.status.className = members.length ? "warn" : "error";
    els.status.textContent = members.length
      ? `${lastError} Using list from ${formatAge(membersFetchedAt)}.`
      : `${lastError} You can still type usernames.`;
    return;
  }
  els.status.textContent = members.length
    ? `${members.length} people · updated ${formatAge(membersFetchedAt)}`
    : "No people cached yet.";
}

async function toggle(login, on) {
  const next = new Set(state.selected);
  if (on) next.add(login);
  else next.delete(login);
  state.selected = [...next].sort(byLogin);
  state.pinned = [...new Set([...state.pinned, login])].sort(byLogin);
  await setState({ selected: state.selected, pinned: state.pinned });
  render();
}

async function unpin(login) {
  state.pinned = state.pinned.filter((l) => l !== login);
  state.selected = state.selected.filter((l) => l !== login);
  await setState({ selected: state.selected, pinned: state.pinned });
  render();
}

async function refresh(force) {
  refreshing = true;
  renderStatus();
  try {
    await browser.runtime.sendMessage({ type: "refresh", force });
  } catch (e) {
    // Background page restarting; the storage listener will pick up any result
  } finally {
    refreshing = false;
    state = await getState();
    render();
  }
}

async function openPrs(selected) {
  await browser.tabs.create({ url: buildSearchUrl({ ...state, selected }) });
  window.close();
}

els.open.addEventListener("click", () => openPrs(state.selected));

// Clear only unchecks; the names stay pinned so they're easy to re-pick
els.clear.addEventListener("click", async () => {
  state.pinned = [...new Set([...state.pinned, ...state.selected])].sort(byLogin);
  state.selected = [];
  await setState({ selected: [], pinned: state.pinned });
  render();
});

els.includeDrafts.addEventListener("change", () => {
  state.includeDrafts = els.includeDrafts.checked;
  setState({ includeDrafts: state.includeDrafts });
});

els.limitToOrg.addEventListener("change", () => {
  state.limitToOrg = els.limitToOrg.checked;
  setState({ limitToOrg: state.limitToOrg });
});

els.filter.addEventListener("input", renderList);

// Enter adds a typed username, so the tool still works before the org list ever loads
els.filter.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") return;
  const typed = els.filter.value.trim().replace(/^@/, "");
  const existing = state.members.find((login) => login.toLowerCase() === typed.toLowerCase());
  const login = existing || typed;
  if (!isValidUsername(login)) return;
  els.filter.value = "";
  await toggle(login, true);
});

els.refresh.addEventListener("click", () => refresh(true));
els.options.addEventListener("click", () => browser.runtime.openOptionsPage());

browser.storage.onChanged.addListener(async (_changes, area) => {
  if (area !== "local") return;
  state = await getState();
  renderHeader();
  renderStatus();
});

load();
