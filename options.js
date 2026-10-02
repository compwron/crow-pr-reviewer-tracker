const orgInput = document.getElementById("org");
const tokenInput = document.getElementById("token");
const saveButton = document.getElementById("save");
const result = document.getElementById("result");

getState().then((state) => {
  orgInput.value = state.org;
  tokenInput.value = state.token;
});

saveButton.addEventListener("click", async () => {
  const org = orgInput.value.trim();
  if (!org) {
    result.className = "error";
    result.textContent = "Organization is required.";
    return;
  }

  // Firefox treats MV3 host permissions as optional. Ask here because a
  // permission prompt needs a click, and it must come before any await.
  if (!tokenInput.value.trim()) {
    const granted = await browser.permissions.request({ origins: [GITHUB_ORIGIN] });
    if (!granted) {
      result.className = "error";
      result.textContent = "Allow github.com access, or paste a token.";
      return;
    }
  }

  const previous = await getState();
  const patch = { org, token: tokenInput.value.trim() };
  // A different org's member list is useless, so drop it rather than show stale names
  if (org !== previous.org) Object.assign(patch, { members: [], membersFetchedAt: 0 });
  await setState({ ...patch, lastError: null });

  saveButton.disabled = true;
  result.className = "muted";
  result.textContent = "Testing…";
  try {
    const response = await browser.runtime.sendMessage({ type: "refresh", force: true });
    result.className = response.ok ? "" : "error";
    result.textContent = response.ok ? `Saved. Loaded ${response.count} people.` : `Saved, but: ${response.error}`;
  } catch (e) {
    result.className = "error";
    result.textContent = `Saved, but the test failed: ${e.message}`;
  } finally {
    saveButton.disabled = false;
  }
});
