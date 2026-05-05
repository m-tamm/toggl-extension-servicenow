import { TimeEntryService } from "./app/time-entry-service.js";
import { TogglProvider } from "./adapters/toggl-provider.js";
import { SERVICENOW_TARGET, STORAGE_KEYS } from "./config.js";
import { durationToParts, formatEntryLine, getEntryKey, resolveRateSelection } from "./domain/time-entry.js";
import { clearCache, getStorage, isCacheValid, setStorage } from "./storage/chrome-storage.js";

const ui = {
  tokenSection: document.getElementById("token-section"),
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

const provider = new TogglProvider();
const timeEntryService = new TimeEntryService(provider);

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
  const { [STORAGE_KEYS.cache]: cache } = await getStorage([STORAGE_KEYS.cache]);
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
    [STORAGE_KEYS.cache]: {
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
  ui.tokenSection.classList.toggle("hidden", isAuthed);
  ui.dataSection.classList.toggle("hidden", !isAuthed);
  ui.showTokenForm.classList.toggle("hidden", !isAuthed);
  ui.apiToken.value = "";
}

function revealTokenForm() {
  ui.tokenSection.classList.remove("hidden");
  ui.apiToken.focus();
}

async function saveToken() {
  const token = ui.apiToken.value.trim();
  if (!token) {
    showStatus("Please provide a Toggl API token.", true);
    return;
  }

  await setStorage({ [STORAGE_KEYS.token]: token });
  setAuthedUI(true);
  showStatus("API token saved.");
}

async function removeToken() {
  await chrome.storage.local.remove(STORAGE_KEYS.token);
  await clearCache();
  setAuthedUI(false);
  ui.entries.innerHTML = "";
  ui.cacheInfo.textContent = "";
  showStatus("Token and cached entries cleared.");
}

async function fetchEntriesForDate() {
  const { [STORAGE_KEYS.token]: token, [STORAGE_KEYS.cache]: cache } = await getStorage([
    STORAGE_KEYS.token,
    STORAGE_KEYS.cache
  ]);

  if (!token) {
    setAuthedUI(false);
    showStatus("Please save your API token first.", true);
    return;
  }

  const targetDate = ui.targetDate.value;
  if (!targetDate) {
    showStatus("Please select a date.", true);
    return;
  }

  if (cache && cache.date !== targetDate) {
    await clearCache();
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

  await setStorage({ [STORAGE_KEYS.cache]: newCache });
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

  const { [STORAGE_KEYS.token]: token, [STORAGE_KEYS.cache]: cache } = await getStorage([
    STORAGE_KEYS.token,
    STORAGE_KEYS.cache
  ]);

  setAuthedUI(Boolean(token));

  if (!token) {
    showStatus("Enter your Toggl API token to get started.");
    return;
  }

  if (!isCacheValid(cache)) {
    if (cache) {
      await clearCache();
    }
    renderEntries([]);
    ui.cacheInfo.textContent = "No valid cached day yet. Fetch a date.";
    showStatus("Token found. Choose a date and fetch entries.");
    return;
  }

  ui.targetDate.value = cache.date;
  renderEntries(cache.entries);
  ui.cacheInfo.textContent = `Loaded cached entries for ${cache.date}.`;
  showStatus("Loaded entries from local cache.");
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
  clearCache()
    .then(() => {
      renderEntries([]);
      ui.cacheInfo.textContent = "Cached day cleared.";
      showStatus("Cache cleared.");
    })
    .catch((error) => showStatus(error.message, true));
});

ui.showTokenForm.addEventListener("click", () => {
  revealTokenForm();
  showStatus("You can update your API token below.");
});

hydrate().catch((error) => showStatus(error.message, true));
