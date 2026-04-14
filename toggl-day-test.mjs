#!/usr/bin/env node

/**
 * Minimal Toggl day entries test.
 *
 * Usage:
 *   TOGGL_API_TOKEN=... node toggl-day-test.mjs 2026-04-13
 *
 * Optional:
 *   TOGGL_TIMEZONE=Europe/Berlin
 */

const [inputDate] = process.argv.slice(2);

if (!process.env.TOGGL_API_TOKEN) {
  console.error("Missing TOGGL_API_TOKEN environment variable.");
  process.exit(1);
}

if (!inputDate || !/^\d{4}-\d{2}-\d{2}$/.test(inputDate)) {
  console.error("Usage: TOGGL_API_TOKEN=... node toggl-day-test.mjs YYYY-MM-DD");
  process.exit(1);
}

const timezone = process.env.TOGGL_TIMEZONE || "UTC";

function isoDayInTimezone(isoDateTime, timeZone) {
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

async function main() {
  // Query a widened UTC range and then filter exactly by day in the requested timezone.
  const startDate = toUtcIsoBoundary(inputDate, -1, false);
  const endDate = toUtcIsoBoundary(inputDate, 1, true);

  const url = new URL("https://api.track.toggl.com/api/v9/me/time_entries");
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);

  const auth = Buffer.from(`${process.env.TOGGL_API_TOKEN}:api_token`).toString("base64");

  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`Toggl request failed: ${response.status} ${response.statusText}`);
    console.error(text);
    process.exit(1);
  }

  const entries = await response.json();
  const dayEntries = entries.filter((entry) => {
    if (!entry.start) return false;
    return isoDayInTimezone(entry.start, timezone) === inputDate;
  });

  console.log(`Date: ${inputDate} (${timezone})`);
  console.log(`Window UTC: ${startDate} -> ${endDate}`);
  console.log(`Entries returned: ${dayEntries.length}`);
  console.log("---");

  for (const entry of dayEntries) {
    const started = entry.start || "-";
    const stopped = entry.stop || "running";
    const duration = entry.duration ?? "-";
    const description = entry.description || "(no description)";
    const project = entry.project_id ? `project:${entry.project_id}` : "project:-";

    console.log(`${started} -> ${stopped} | ${duration}s | ${project} | ${description}`);
  }
}

main().catch((err) => {
  console.error("Unexpected error while requesting Toggl entries:");
  console.error(err);
  process.exit(1);
});
