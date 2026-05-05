export function toIsoDateInTimezone(isoDateTime, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(isoDateTime));

  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function toUtcIsoBoundary(dateStr, dayOffset, endOfDay = false) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  if (endOfDay) {
    d.setUTCHours(23, 59, 59, 999);
  }
  return d.toISOString();
}

export function formatForTargetInput(isoDateTime, timeZone) {
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
