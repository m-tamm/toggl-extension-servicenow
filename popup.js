const STORAGE_KEYS = {
  token: "togglApiToken",
  cache: "togglDayCache"
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_IMPORT_INPUT_ID = "task_time_worked.u_from";
const TARGET_IFRAME_ID = "gsft_main";
const DURATION_HOURS_INPUT_ID = "ni.task_time_worked.time_workeddur_hour";
const DURATION_MINUTES_INPUT_ID = "ni.task_time_worked.time_workeddur_min";
const DURATION_SECONDS_INPUT_ID = "ni.task_time_worked.time_workeddur_sec";
const EXTERNAL_NOTE_TEXTAREA_ID = "task_time_worked.u_time_booking_external_note";
const RATE_TYPE_SELECT_ID = "sys_select.task_time_worked.rate_type";
const RATE_CATEGORY_SELECT_ID = "task_time_worked.u_rate_type_category";

const RATE_TYPE_VALUES = {
  administrative: "43007796db2c41108e647806f4961932",
  businessSolution: "40407b96db2c41108e647806f496192b"
};

const RATE_CATEGORY_VALUES = {
  administrative: "administrative Tätigkeiten",
  trainingColleagues: "Ausbildung",
  meetings: "Fachspezifische Meetings",
  learning: "Weiterbildung",
  businessSolution: "Business Solution"
};

// Example mapping: short Toggl tags -> ServiceNow category.
const TAG_TO_CATEGORY = {
  admin: RATE_CATEGORY_VALUES.administrative,
  train: RATE_CATEGORY_VALUES.trainingColleagues,
  meet: RATE_CATEGORY_VALUES.meetings,
  learn: RATE_CATEGORY_VALUES.learning,
  code: RATE_CATEGORY_VALUES.businessSolution,
  dev: RATE_CATEGORY_VALUES.businessSolution
};

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

function toIsoDateInTimezone(isoDateTime, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(isoDateTime));

  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function toUtcIsoBoundary(dateStr, dayOffset, endOfDay = false) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  if (endOfDay) {
    d.setUTCHours(23, 59, 59, 999);
  }
  return d.toISOString();
}

function formatForTargetInput(isoDateTime, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23"
  }).formatToParts(new Date(isoDateTime));

  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

function normalizeEntries(rawEntries, targetDate, timeZone) {
  return rawEntries
    .filter((entry) => entry.start && toIsoDateInTimezone(entry.start, timeZone) === targetDate)
    .map((entry) => ({
      id: entry.id,
      description: entry.description || "(no description)",
      start: entry.start,
      stop: entry.stop,
      duration: entry.duration,
      tags: Array.isArray(entry.tags) ? entry.tags : [],
      projectId: entry.project_id || null,
      imported: false,
      importDuration: durationToParts(entry.duration, entry.start, entry.stop),
      importTitle: entry.description || "",
      importRateSelection: resolveRateSelection(entry.tags),
      importDateValue: formatForTargetInput(entry.start, timeZone)
    }));
}

function getEntryKey(entry) {
  if (entry?.id !== undefined && entry?.id !== null) {
    return `id:${entry.id}`;
  }
  return `fallback:${entry?.start || ""}:${entry?.description || ""}:${entry?.duration || ""}`;
}

function preserveImportedFlags(newEntries, oldEntries) {
  const importedKeys = new Set(
    (oldEntries || [])
      .filter((entry) => Boolean(entry?.imported))
      .map((entry) => getEntryKey(entry))
  );

  return newEntries.map((entry) => ({
    ...entry,
    imported: importedKeys.has(getEntryKey(entry))
  }));
}

function normalizeEntriesWithProjects(rawEntries, targetDate, timeZone, projectMap) {
  return normalizeEntries(rawEntries, targetDate, timeZone).map((entry) => {
    const projectMeta = entry.projectId ? projectMap.get(String(entry.projectId)) : null;
    return {
      ...entry,
      projectName: projectMeta?.name || null,
      projectColor: projectMeta?.color || null
    };
  });
}

function resolveProjectColor(project) {
  const raw = project?.hex_color || project?.color_hex || project?.color || null;
  if (typeof raw !== "string") return null;

  const value = raw.trim();
  if (!value) return null;
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value;
  if (/^[0-9a-fA-F]{6}$/.test(value)) return `#${value}`;
  return null;
}

function collectWorkspaceIds(entries) {
  const ids = new Set();
  for (const entry of entries) {
    const workspaceId = entry.workspace_id ?? entry.wid ?? null;
    if (workspaceId !== null && workspaceId !== undefined) {
      ids.add(String(workspaceId));
    }
  }
  return Array.from(ids);
}

async function fetchProjectsForEntries(token, rawEntries) {
  const projectMap = new Map();
  const workspaceIds = collectWorkspaceIds(rawEntries);

  if (!workspaceIds.length) {
    return projectMap;
  }

  const auth = btoa(`${token}:api_token`);

  await Promise.all(
    workspaceIds.map(async (workspaceId) => {
      const url = new URL(`https://api.track.toggl.com/api/v9/workspaces/${workspaceId}/projects`);
      const response = await fetch(url, {
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json"
        }
      });

      if (!response.ok) {
        return;
      }

      const projects = await response.json();
      if (!Array.isArray(projects)) {
        return;
      }

      for (const project of projects) {
        if (!project || project.id === undefined || project.id === null) {
          continue;
        }
        projectMap.set(String(project.id), {
          name: project.name || null,
          color: resolveProjectColor(project)
        });
      }
    })
  );

  return projectMap;
}

function resolveRateSelection(rawTags) {
  const tags = (Array.isArray(rawTags) ? rawTags : [])
    .filter((t) => typeof t === "string")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  for (const tag of tags) {
    const categoryValue = TAG_TO_CATEGORY[tag];
    if (!categoryValue) continue;

    const rateTypeValue =
      categoryValue === RATE_CATEGORY_VALUES.businessSolution
        ? RATE_TYPE_VALUES.businessSolution
        : RATE_TYPE_VALUES.administrative;

    return {
      matchedTag: tag,
      rateTypeValue,
      categoryValue
    };
  }

  return null;
}

function durationToParts(durationSeconds, startIso, stopIso) {
  let totalSeconds = Number.isFinite(durationSeconds) ? durationSeconds : 0;

  // Running Toggl entries can have negative duration; in that case derive from start->stop when possible.
  if (totalSeconds < 0 && startIso && stopIso) {
    const diff = Math.floor((new Date(stopIso).getTime() - new Date(startIso).getTime()) / 1000);
    totalSeconds = Number.isFinite(diff) ? diff : 0;
  }

  totalSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return {
    hours: String(hours),
    minutes: String(minutes),
    seconds: String(seconds)
  };
}

function formatEntryLine(entry) {
  const stop = entry.stop || "running";
  const project = entry.projectName || (entry.projectId ? `project:${entry.projectId}` : "project:-");
  const tags = entry.tags?.length ? ` | tags:${entry.tags.join(",")}` : "";
  return `${entry.start} -> ${stop} | ${entry.duration}s | ${project}${tags}`;
}

function isCacheValid(cache) {
  if (!cache || !cache.fetchedAt || !cache.date || !Array.isArray(cache.entries)) {
    return false;
  }
  const age = Date.now() - cache.fetchedAt;
  return age >= 0 && age <= CACHE_TTL_MS;
}

async function getStorage(keys) {
  return chrome.storage.local.get(keys);
}

async function setStorage(values) {
  return chrome.storage.local.set(values);
}

async function clearCache() {
  await chrome.storage.local.remove(STORAGE_KEYS.cache);
}

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

    title.append(importDot, titleText);

    const project = document.createElement("p");
    project.className = "entry-project";

    const swatch = document.createElement("span");
    swatch.className = "project-swatch";
    if (entry.projectColor) {
      swatch.style.backgroundColor = entry.projectColor;
    }

    const projectText = document.createElement("span");
    projectText.textContent = entry.projectName || (entry.projectId ? `Project ${entry.projectId}` : "No Project");

    project.append(swatch, projectText);

    const meta = document.createElement("p");
    meta.className = "entry-meta";
    meta.textContent = formatEntryLine(entry);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    button.textContent = `Import ${entry.importDateValue}`;
    button.addEventListener("click", () => {
      const entryKey = getEntryKey(entry);
      // Optimistic imported flag update: popup can close before async continuation runs.
      setEntryImportedInCurrentList(entry);
      markImportedInCacheByKey(entryKey)
        .catch(() => {});

      importEntryToActiveTab(entry);
    });

    li.append(title, project, meta, button);
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
  const startDate = toUtcIsoBoundary(targetDate, -1, false);
  const endDate = toUtcIsoBoundary(targetDate, 1, true);

  const url = new URL("https://api.track.toggl.com/api/v9/me/time_entries");
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);

  const auth = btoa(`${token}:api_token`);
  showStatus("Fetching entries from Toggl...");

  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    const text = await response.text();
    showStatus(`Toggl request failed (${response.status}): ${text.slice(0, 140)}`, true);
    return;
  }

  const rawEntries = await response.json();
  const projectMap = await fetchProjectsForEntries(token, rawEntries);
  const normalizedEntries = normalizeEntriesWithProjects(rawEntries, targetDate, timezone, projectMap);
  const entries = cache && cache.date === targetDate
    ? preserveImportedFlags(normalizedEntries, cache.entries)
    : normalizedEntries;

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
        DEFAULT_IMPORT_INPUT_ID,
        TARGET_IFRAME_ID,
        DURATION_HOURS_INPUT_ID,
        DURATION_MINUTES_INPUT_ID,
        DURATION_SECONDS_INPUT_ID,
        EXTERNAL_NOTE_TEXTAREA_ID,
        safeDuration,
        safeTitle,
        RATE_TYPE_SELECT_ID,
        RATE_CATEGORY_SELECT_ID,
        safeRateSelection
      ]
    });

    const success = results.find((r) => r.result?.ok);
    if (!success) {
      const firstError = results.find((r) => r.result?.reason)?.result?.reason;
      showStatus(firstError || "Could not import into active page.", true);
      return;
    }

    const ids = success.result.writtenIds?.join(", ") || DEFAULT_IMPORT_INPUT_ID;
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
