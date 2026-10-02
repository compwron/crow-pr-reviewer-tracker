// Owns the member-list cache. The popup asks for refreshes through messages so
// only one fetch runs at a time even if the popup is closed mid-request.

const CHECK_ALARM = "members-check";
const RETRY_ALARM = "members-retry";
const FIRST_RETRY_MINUTES = 5;
const MAX_RETRY_MINUTES = 360;

let inFlight = null;

function refreshMembers({ force = false } = {}) {
  if (!inFlight) {
    inFlight = doRefresh(force).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function doRefresh(force) {
  const state = await getState();
  if (!state.org) {
    await setState({ lastError: "Set an organization in Options." });
    return { ok: false, error: "No organization set." };
  }
  const fresh = Date.now() - state.membersFetchedAt < DAY_MS;
  if (!force && fresh && state.members.length) return { ok: true, skipped: true };

  await setState({ lastAttemptAt: Date.now() });
  try {
    const members = await fetchOrgMembers(state.org, state.token.trim());
    await setState({
      members,
      membersFetchedAt: Date.now(),
      lastError: null,
      retryDelayMinutes: 0,
    });
    await browser.alarms.clear(RETRY_ALARM);
    return { ok: true, count: members.length };
  } catch (e) {
    // Keep the old cached list so the popup still works offline
    const fatal = e instanceof FatalError;
    const retryDelayMinutes = fatal
      ? 0
      : Math.min(MAX_RETRY_MINUTES, (state.retryDelayMinutes || FIRST_RETRY_MINUTES / 2) * 2);
    await setState({ lastError: e.message, retryDelayMinutes });
    if (!fatal) browser.alarms.create(RETRY_ALARM, { delayInMinutes: retryDelayMinutes });
    return { ok: false, error: e.message };
  }
}

function ensureCheckAlarm() {
  // Hourly check rather than a single 24h alarm, so a laptop asleep at the
  // scheduled time still refreshes soon after waking
  browser.alarms.create(CHECK_ALARM, { periodInMinutes: 60 });
}

browser.runtime.onInstalled.addListener(async ({ reason }) => {
  ensureCheckAlarm();
  const { org } = await getState();
  if (reason === "install" && !org) browser.runtime.openOptionsPage();
  else refreshMembers();
});

browser.runtime.onStartup.addListener(() => {
  ensureCheckAlarm();
  refreshMembers();
});

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CHECK_ALARM) refreshMembers();
  if (alarm.name === RETRY_ALARM) refreshMembers({ force: true });
});

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "refresh") return refreshMembers({ force: !!message.force });
  return undefined;
});
