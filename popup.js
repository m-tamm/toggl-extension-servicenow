import { TimeEntryService } from "./app/time-entry-service.js";
import { SuperProductivityProvider } from "./adapters/super-productivity-provider.js";
import { TogglProvider } from "./adapters/toggl-provider.js";
import { SERVICENOW_TARGET, STORAGE_KEYS, TRACKER_PROVIDER } from "./config.js";
import { durationToParts, formatEntryLine, getEntryKey, resolveRateSelection } from "./domain/time-entry.js";
import { clearCache, getStorage, isCacheValid, setStorage } from "./storage/chrome-storage.js";

const ui = {
  openSettings: document.getElementById("open-settings"),
  settingsSection: document.getElementById("settings-section"),
  trackerSelect: document.getElementById("tracker-select"),
  saveSettings: document.getElementById("save-settings"),
  closeSettings: document.getElementById("close-settings"),
  activeTrackerIndicator: document.getElementById("active-tracker-indicator"),
  tokenSection: document.getElementById("token-section"),
  setupTitle: document.getElementById("setup-title"),
  apiTokenLabel: document.getElementById("api-token-label"),
  dataSection: document.getElementById("data-section"),
  apiToken: document.getElementById("api-token"),
  saveToken: document.getElementById("save-token"),
  clearToken: document.getElementById("clear-token"),
  showTokenForm: document.getElementById("show-token-form"),
  targetDate: document.getElementById("target-date"),
  fetchEntries: document.getElementById("fetch-entries"),
  clearCache: document.getElementById("clear-cache"),
  cacheInfo: document.getElementById("cache-info"),
  entries: document.getElementById("entries"),
  status: document.getElementById("status")
};

let currentEntries = [];

function showStatus(message, isError = false) {
  ui.status.textContent = message;
  ui.status.classList.toggle("error", isError);
}

const providers = {
  [TRACKER_PROVIDER.toggl]: new TogglProvider(),
  [TRACKER_PROVIDER.superProductivity]: new SuperProductivityProvider()
};

const timeEntryServices = {
  [TRACKER_PROVIDER.toggl]: new TimeEntryService(providers[TRACKER_PROVIDER.toggl]),
  [TRACKER_PROVIDER.superProductivity]: new TimeEntryService(providers[TRACKER_PROVIDER.superProductivity])
};

const providerMeta = {
  [TRACKER_PROVIDER.toggl]: {
    label: "Toggl",
    requiresToken: true,
    tokenKey: STORAGE_KEYS.togglToken,
    cacheKey: STORAGE_KEYS.togglCache,
    tokenLabel: "Toggl API Token",
    tokenPlaceholder: "Paste token",
    saveButtonText: "Save Token",
    clearButtonText: "Clear Token",
    setupTitle: "Toggl Access"
  },
  [TRACKER_PROVIDER.superProductivity]: {
    label: "Super Productivity",
    requiresToken: false,
    tokenKey: null,
    cacheKey: STORAGE_KEYS.superProductivityCache,
    tokenLabel: "",
    tokenPlaceholder: "",
    saveButtonText: "Continue",
    clearButtonText: "Clear",
    setupTitle: "Super Productivity Access"
  }
};

let activeProviderId = TRACKER_PROVIDER.toggl;

function setEntryImportedInCurrentList(entryToMark) {
  const keyToMark = getEntryKey(entryToMark);
  currentEntries = currentEntries.map((entry) => {
    if (getEntryKey(entry) !== keyToMark) {
      return entry;
    }
    return {
      ...entry,
      imported: true
    };
  });
  renderEntries(currentEntries);
}

async function markImportedInCacheByKey(keyToMark) {
  const cacheKey = providerMeta[activeProviderId].cacheKey;
  const { [cacheKey]: cache } = await getStorage([cacheKey]);
  if (!cache || !Array.isArray(cache.entries)) {
    return;
  }

  let changed = false;
  const updatedEntries = cache.entries.map((entry) => {
    if (getEntryKey(entry) !== keyToMark) {
      return entry;
    }
    if (entry.imported) {
      return entry;
    }
    changed = true;
    return {
      ...entry,
      imported: true
    };
  });

  if (!changed) {
    return;
  }

  await setStorage({
    [cacheKey]: {
      ...cache,
      entries: updatedEntries
    }
  });
}

function renderEntries(entries) {
  currentEntries = entries;
  ui.entries.innerHTML = "";

  if (!entries.length) {
    const li = document.createElement("li");
    li.className = "entry-item";
    li.textContent = "No entries stored for this day.";
    ui.entries.appendChild(li);
    return;
  }

  for (const entry of entries) {
    const li = document.createElement("li");
    li.className = "entry-item";

    const title = document.createElement("p");
    title.className = "entry-title";

    const importDot = document.createElement("span");
    importDot.className = `import-dot ${entry.imported ? "imported" : "not-imported"}`;

    const titleText = document.createElement("span");
    titleText.textContent = entry.description;

    const titleLeft = document.createElement("span");
    titleLeft.className = "entry-title-left";
    titleLeft.append(importDot, titleText);

    const infoButton = document.createElement("button");
    infoButton.type = "button";
    infoButton.className = "tiny secondary info-toggle";
    infoButton.textContent = "i";
    infoButton.setAttribute("aria-label", "Toggle entry details");
    infoButton.setAttribute("aria-expanded", "false");
    infoButton.addEventListener("click", () => {
      const isHidden = meta.classList.toggle("hidden-meta");
      infoButton.setAttribute("aria-expanded", String(!isHidden));
      infoButton.classList.toggle("active", !isHidden);
    });

    title.append(titleLeft, infoButton);

    const project = document.createElement("p");
    project.className = "entry-project";

    const projectLeft = document.createElement("span");
    projectLeft.className = "project-left";

    const swatch = document.createElement("span");
    swatch.className = "project-swatch";
    if (entry.projectColor) {
      swatch.style.backgroundColor = entry.projectColor;
    }

    const projectLabel = entry.projectName || (entry.projectId ? `Project ${entry.projectId}` : "No Project");
    const projectText = document.createElement("span");
    projectText.className = "project-text";
    projectText.textContent = projectLabel;
    projectText.title = projectLabel;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary tiny";
    button.textContent = `Import ${entry.importDateValue}`;
    button.addEventListener("click", () => {
      const entryKey = getEntryKey(entry);
      // Optimistic imported flag update: popup can close before async continuation runs.
      setEntryImportedInCurrentList(entry);
      markImportedInCacheByKey(entryKey)
        .catch(() => {});

      importEntryToActiveTab(entry);
    });

    projectLeft.append(swatch, projectText);
    project.append(projectLeft, button);

    const meta = document.createElement("p");
    meta.className = "entry-meta";
    meta.textContent = formatEntryLine(entry);
    meta.classList.add("hidden-meta");

    li.append(title, project, meta);
    ui.entries.appendChild(li);
  }
}

function setAuthedUI(isAuthed) {
  const meta = getActiveProviderMeta();
  ui.tokenSection.classList.toggle("hidden", isAuthed);
  ui.dataSection.classList.toggle("hidden", !isAuthed);
  ui.showTokenForm.classList.toggle("hidden", !isAuthed || !meta.requiresToken);
  ui.apiToken.value = "";
}

function getActiveProviderMeta() {
  return providerMeta[activeProviderId];
}

function getActiveProvider() {
  return providers[activeProviderId];
}

function getActiveTimeEntryService() {
  return timeEntryServices[activeProviderId];
}

function applyProviderVisualState() {
  const meta = getActiveProviderMeta();
  ui.activeTrackerIndicator.textContent = `Active tracker: ${meta.label}`;
  ui.fetchEntries.textContent = `Fetch From ${meta.label}`;
  ui.setupTitle.textContent = meta.setupTitle;
  ui.trackerSelect.value = activeProviderId;

  if (meta.requiresToken) {
    ui.apiTokenLabel.textContent = meta.tokenLabel;
    ui.apiToken.placeholder = meta.tokenPlaceholder;
    ui.saveToken.textContent = meta.saveButtonText;
    ui.clearToken.textContent = meta.clearButtonText;
    ui.showTokenForm.textContent = "Change Access";
    ui.apiTokenLabel.classList.remove("hidden");
    ui.apiToken.classList.remove("hidden");
    ui.saveToken.classList.remove("hidden");
    ui.clearToken.classList.remove("hidden");
  } else {
    ui.apiTokenLabel.classList.add("hidden");
    ui.apiToken.classList.add("hidden");
    ui.saveToken.classList.add("hidden");
    ui.clearToken.classList.add("hidden");
    ui.showTokenForm.classList.add("hidden");
  }
}

function getAuthSuccessStatus() {
  const meta = getActiveProviderMeta();
  if (!meta.requiresToken) {
    return `${meta.label} selected.`;
  }
  return `${meta.label} token saved.`;
}

async function getCurrentProviderAuthAndCache() {
  const meta = getActiveProviderMeta();
  const keys = [meta.cacheKey];
  if (meta.tokenKey) {
    keys.push(meta.tokenKey);
  }

  const values = await getStorage(keys);
  return {
    token: meta.tokenKey ? values[meta.tokenKey] : null,
    cache: values[meta.cacheKey] || null
  };
}

async function applyProviderAuthState() {
  const meta = getActiveProviderMeta();
  const { token, cache } = await getCurrentProviderAuthAndCache();
  const isAuthed = meta.requiresToken ? Boolean(token) : true;

  setAuthedUI(isAuthed);

  if (!isAuthed) {
    renderEntries([]);
    ui.cacheInfo.textContent = "";
    showStatus(`Enter your ${meta.label} token to get started.`);
    return;
  }

  if (!isCacheValid(cache)) {
    if (cache) {
      await clearCache(meta.cacheKey);
    }
    renderEntries([]);
    ui.cacheInfo.textContent = "No valid cached day yet. Fetch a date.";
    showStatus(`${meta.label} selected. Choose a date and fetch entries.`);
    return;
  }

  ui.targetDate.value = cache.date;
  renderEntries(cache.entries);
  ui.cacheInfo.textContent = `Loaded cached entries for ${cache.date}.`;
  showStatus(`Loaded ${meta.label} entries from local cache.`);
}

function revealTokenForm() {
  if (!getActiveProviderMeta().requiresToken) {
    return;
  }
  ui.tokenSection.classList.remove("hidden");
  ui.apiToken.focus();
}

async function saveToken() {
  const meta = getActiveProviderMeta();
  if (!meta.requiresToken || !meta.tokenKey) {
    setAuthedUI(true);
    showStatus(getAuthSuccessStatus());
    return;
  }

  const token = ui.apiToken.value.trim();
  if (!token) {
    showStatus(`Please provide a ${meta.label} API token.`, true);
    return;
  }

  await setStorage({ [meta.tokenKey]: token });
  setAuthedUI(true);
  showStatus(getAuthSuccessStatus());
}

async function removeToken() {
  const meta = getActiveProviderMeta();
  if (meta.tokenKey) {
    await chrome.storage.local.remove(meta.tokenKey);
  }
  await clearCache(meta.cacheKey);
  setAuthedUI(false);
  ui.entries.innerHTML = "";
  ui.cacheInfo.textContent = "";
  showStatus(`${meta.label} access and cached entries cleared.`);
}

async function fetchEntriesForDate() {
  const meta = getActiveProviderMeta();
  const provider = getActiveProvider();
  const timeEntryService = getActiveTimeEntryService();
  const { token, cache } = await getCurrentProviderAuthAndCache();

  if (meta.requiresToken && !token) {
    setAuthedUI(false);
    showStatus(`Please save your ${meta.label} API token first.`, true);
    return;
  }

  const targetDate = ui.targetDate.value;
  if (!targetDate) {
    showStatus("Please select a date.", true);
    return;
  }

  if (cache && cache.date !== targetDate) {
    await clearCache(meta.cacheKey);
  }

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  showStatus(provider.getFetchStatusMessage());

  let entries;
  try {
    entries = await timeEntryService.fetchNormalizedEntries({
      token,
      targetDate,
      timezone,
      previousEntries: cache && cache.date === targetDate ? cache.entries : []
    });
  } catch (error) {
    showStatus(error.message || "Request failed.", true);
    return;
  }

  const newCache = {
    date: targetDate,
    fetchedAt: Date.now(),
    timezone,
    entries
  };

  await setStorage({ [meta.cacheKey]: newCache });
  renderEntries(entries);
  ui.cacheInfo.textContent = `Stored ${entries.length} entries for ${targetDate}.`;
  showStatus("Entries fetched and cached.");
}

async function importEntryToActiveTab(entry) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    showStatus("No active tab found.", true);
    return;
  }

  try {
    const safeDuration =
      entry.importDuration &&
      typeof entry.importDuration.hours === "string" &&
      typeof entry.importDuration.minutes === "string" &&
      typeof entry.importDuration.seconds === "string"
        ? entry.importDuration
        : durationToParts(entry.duration, entry.start, entry.stop);

    const safeTitle =
      typeof entry.importTitle === "string"
        ? entry.importTitle
        : entry.description || "";

    const safeRateSelection = entry.importRateSelection || resolveRateSelection(entry.tags);

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: async (
        dateValue,
        inputId,
        targetFrameId,
        hoursId,
        minutesId,
        secondsId,
        noteId,
        duration,
        title,
        rateTypeId,
        rateCategoryId,
        rateSelection
      ) => {
        const frameElement = window.frameElement;
        const currentFrameId = frameElement?.id || "";
        const currentFrameName = frameElement?.getAttribute?.("name") || "";

        // If we know the host iframe id/name, restrict writes to that frame and top-level fallback.
        const isTopWindow = window === window.top;
        const isTargetFrame =
          currentFrameId === targetFrameId || currentFrameName === targetFrameId;
        if (!isTopWindow && !isTargetFrame) {
          return { ok: false, skipped: true, reason: "Frame skipped (not target iframe)." };
        }

        const setValue = (el, value) => {
          const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
          if (setter) {
            setter.call(el, value);
          } else {
            el.value = value;
          }

          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new Event("blur", { bubbles: true }));
        };

        const setSelectValue = (selectEl, wantedValue) => {
          const options = Array.from(selectEl.options || []);
          const wanted = String(wantedValue ?? "").trim().toLowerCase();
          const directMatch = options.find((opt) => String(opt.value).trim().toLowerCase() === wanted);
          const textMatch = options.find((opt) => String(opt.textContent).trim().toLowerCase() === wanted);
          const matched = directMatch || textMatch;
          if (!matched) {
            return false;
          }

          selectEl.value = matched.value;
          selectEl.dispatchEvent(new Event("input", { bubbles: true }));
          selectEl.dispatchEvent(new Event("change", { bubbles: true }));
          selectEl.dispatchEvent(new Event("blur", { bubbles: true }));
          return true;
        };

        const waitForCategoryOption = async (selectEl, wantedValue, timeoutMs = 2000) => {
          const started = Date.now();
          while (Date.now() - started < timeoutMs) {
            if (setSelectValue(selectEl, wantedValue)) {
              return true;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          return false;
        };

        const writtenIds = [];
        const missingIds = [];

        const fromCandidates = [inputId, `sys_display.${inputId}`];
        const fromInputs = fromCandidates
          .map((id) => document.getElementById(id))
          .filter(Boolean)
          .filter((el) => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement);

        if (!fromInputs.length) {
          missingIds.push(...fromCandidates);
        } else {
          for (const input of fromInputs) {
            setValue(input, dateValue);
            writtenIds.push(input.id);
          }
        }

        const durationFieldMap = [
          [hoursId, duration?.hours ?? "0"],
          [minutesId, duration?.minutes ?? "0"],
          [secondsId, duration?.seconds ?? "0"]
        ];

        for (const [id, value] of durationFieldMap) {
          const field = document.getElementById(id);
          if (!field || !(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) {
            missingIds.push(id);
            continue;
          }
          setValue(field, value);
          writtenIds.push(field.id);
        }

        const noteField = document.getElementById(noteId);
        if (!noteField || !(noteField instanceof HTMLInputElement || noteField instanceof HTMLTextAreaElement)) {
          missingIds.push(noteId);
        } else {
          setValue(noteField, title || "");
          writtenIds.push(noteField.id);
        }

        if (rateSelection?.rateTypeValue && rateSelection?.categoryValue) {
          const rateTypeSelect = document.getElementById(rateTypeId);
          const rateCategorySelect = document.getElementById(rateCategoryId);

          if (!rateTypeSelect || !(rateTypeSelect instanceof HTMLSelectElement)) {
            missingIds.push(rateTypeId);
          } else {
            const setTypeOk = setSelectValue(rateTypeSelect, rateSelection.rateTypeValue);
            if (!setTypeOk) {
              missingIds.push(`${rateTypeId}:option(${rateSelection.rateTypeValue})`);
            } else {
              writtenIds.push(rateTypeSelect.id);
            }
          }

          if (!rateCategorySelect || !(rateCategorySelect instanceof HTMLSelectElement)) {
            missingIds.push(rateCategoryId);
          } else {
            const setCategoryOk = await waitForCategoryOption(rateCategorySelect, rateSelection.categoryValue);
            if (!setCategoryOk) {
              missingIds.push(`${rateCategoryId}:option(${rateSelection.categoryValue})`);
            } else {
              writtenIds.push(rateCategorySelect.id);
            }
          }
        }

        if (!writtenIds.length) {
          return {
            ok: false,
            reason: `No target fields found. Missing: ${missingIds.join(", ")}`
          };
        }

        return {
          ok: true,
          writtenIds,
          missingIds,
          frame: currentFrameId || currentFrameName || "top"
        };
      },
      args: [
        entry.importDateValue,
        SERVICENOW_TARGET.importInputId,
        SERVICENOW_TARGET.targetIframeId,
        SERVICENOW_TARGET.durationHoursInputId,
        SERVICENOW_TARGET.durationMinutesInputId,
        SERVICENOW_TARGET.durationSecondsInputId,
        SERVICENOW_TARGET.externalNoteTextareaId,
        safeDuration,
        safeTitle,
        SERVICENOW_TARGET.rateTypeSelectId,
        SERVICENOW_TARGET.rateCategorySelectId,
        safeRateSelection
      ]
    });

    const success = results.find((r) => r.result?.ok);
    if (!success) {
      const firstError = results.find((r) => r.result?.reason)?.result?.reason;
      showStatus(firstError || "Could not import into active page.", true);
      return;
    }

    const ids = success.result.writtenIds?.join(", ") || SERVICENOW_TARGET.importInputId;
    const frameInfo = success.result.frame ? ` (frame: ${success.result.frame})` : "";
    const missingInfo =
      success.result.missingIds?.length > 0
        ? ` Missing fields: ${success.result.missingIds.join(", ")}.`
        : "";
    const rateInfo = safeRateSelection
      ? ` Rate by tag '${safeRateSelection.matchedTag}' -> '${safeRateSelection.categoryValue}'.`
      : " No matching tag for rate mapping.";

    showStatus(`Imported ${entry.importDateValue} into ${ids}${frameInfo}.${missingInfo}${rateInfo}`);
  } catch (error) {
    showStatus(`Import failed: ${error.message}`, true);
  }
}

async function hydrate() {
  const today = new Date().toISOString().slice(0, 10);
  ui.targetDate.value = today;

  const { [STORAGE_KEYS.activeProvider]: storedProvider } = await getStorage([STORAGE_KEYS.activeProvider]);
  if (storedProvider && providerMeta[storedProvider]) {
    activeProviderId = storedProvider;
  }

  applyProviderVisualState();
  await applyProviderAuthState();
}

async function saveSettings() {
  const selected = ui.trackerSelect.value;
  if (!providerMeta[selected]) {
    showStatus("Unknown tracker selected.", true);
    return;
  }

  activeProviderId = selected;
  await setStorage({ [STORAGE_KEYS.activeProvider]: selected });
  applyProviderVisualState();
  await applyProviderAuthState();
  showStatus(`Switched tracker to ${providerMeta[selected].label}.`);
}

ui.saveToken.addEventListener("click", () => {
  saveToken().catch((error) => showStatus(error.message, true));
});

ui.clearToken.addEventListener("click", () => {
  removeToken().catch((error) => showStatus(error.message, true));
});

ui.fetchEntries.addEventListener("click", () => {
  fetchEntriesForDate().catch((error) => showStatus(error.message, true));
});

ui.clearCache.addEventListener("click", () => {
  const cacheKey = getActiveProviderMeta().cacheKey;
  clearCache(cacheKey)
    .then(() => {
      renderEntries([]);
      ui.cacheInfo.textContent = "Cached day cleared.";
      showStatus("Cache cleared.");
    })
    .catch((error) => showStatus(error.message, true));
});

ui.showTokenForm.addEventListener("click", () => {
  revealTokenForm();
  showStatus("You can update access settings below.");
});

ui.openSettings.addEventListener("click", () => {
  ui.settingsSection.classList.toggle("hidden");
});

ui.closeSettings.addEventListener("click", () => {
  ui.settingsSection.classList.add("hidden");
});

ui.saveSettings.addEventListener("click", () => {
  saveSettings().catch((error) => showStatus(error.message, true));
});

hydrate().catch((error) => showStatus(error.message, true));
