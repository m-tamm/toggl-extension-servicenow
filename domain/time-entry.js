import { RATE_CATEGORY_VALUES, RATE_TYPE_VALUES, TAG_TO_CATEGORY } from "../config.js";
import { formatForTargetInput, toIsoDateInTimezone } from "../lib/date-time.js";

function resolveCategoryForTag(tag) {
  const directMatch = TAG_TO_CATEGORY[tag];
  if (directMatch) {
    return directMatch;
  }

  // Some providers may replace spaces in tags with hyphens.
  const withSpaces = tag.replace(/-/g, " ");
  return TAG_TO_CATEGORY[withSpaces] || null;
}

export function resolveRateSelection(rawTags) {
  const tags = (Array.isArray(rawTags) ? rawTags : [])
    .filter((t) => typeof t === "string")
    .flatMap((t) => t.split(","))
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  const hasKundenProjekttermin = tags.includes("kunden/projekttermin");
  if (hasKundenProjekttermin) {
    // Subtags override the parent tag mapping when both are present.
    const subTagOverride = tags.find((tag) => tag === "abrechenbar" || tag === "b-solution");
    if (subTagOverride) {
      const categoryValue = resolveCategoryForTag(subTagOverride);
      if (categoryValue) {
        return {
          matchedTag: subTagOverride,
          rateTypeValue:
            categoryValue === RATE_CATEGORY_VALUES.billable
              ? RATE_TYPE_VALUES.billable
              : RATE_TYPE_VALUES.businessSolution,
          categoryValue
        };
      }
    }
  }

  for (const tag of tags) {
    const categoryValue = resolveCategoryForTag(tag);
    if (!categoryValue) continue;

    let rateTypeValue = RATE_TYPE_VALUES.administrative;
    if (categoryValue === RATE_CATEGORY_VALUES.businessSolution) {
      rateTypeValue = RATE_TYPE_VALUES.businessSolution;
    } else if (categoryValue === RATE_CATEGORY_VALUES.presales) {
      rateTypeValue = RATE_TYPE_VALUES.presales;
    } else if (categoryValue === RATE_CATEGORY_VALUES.billable) {
      rateTypeValue = RATE_TYPE_VALUES.billable;
    }

    return {
      matchedTag: tag,
      rateTypeValue,
      categoryValue
    };
  }

  return null;
}

export function durationToParts(durationSeconds, startIso, stopIso) {
  let totalSeconds = Number.isFinite(durationSeconds) ? durationSeconds : 0;

  // Running entries can have negative duration; derive from start->stop when possible.
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

export function getEntryKey(entry) {
  if (entry?.id !== undefined && entry?.id !== null) {
    return `id:${entry.id}`;
  }
  return `fallback:${entry?.start || ""}:${entry?.description || ""}:${entry?.duration || ""}`;
}

export function preserveImportedFlags(newEntries, oldEntries) {
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

export function formatEntryLine(entry) {
  const stop = entry.stop || "running";
  const project = entry.projectName || (entry.projectId ? `project:${entry.projectId}` : "project:-");
  const tags = entry.tags?.length ? ` | tags:${entry.tags.join(",")}` : "";
  return `${entry.start} -> ${stop} | ${entry.duration}s | ${project}${tags}`;
}

export function normalizeEntries(rawEntries, targetDate, timeZone) {
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
    }))
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

export function normalizeEntriesWithProjects(rawEntries, targetDate, timeZone, projectMap) {
  return normalizeEntries(rawEntries, targetDate, timeZone).map((entry) => {
    const projectMeta = entry.projectId ? projectMap.get(String(entry.projectId)) : null;
    return {
      ...entry,
      projectName: projectMeta?.name || null,
      projectColor: projectMeta?.color || null
    };
  });
}
