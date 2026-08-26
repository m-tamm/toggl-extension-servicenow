function normalizeDateInput(targetDate) {
  if (typeof targetDate !== "string") {
    return null;
  }

  const value = targetDate.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function normalizeHexColor(input) {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!value) return null;
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value;
  if (/^[0-9a-fA-F]{6}$/.test(value)) return `#${value}`;
  return null;
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const id = raw.id !== undefined && raw.id !== null ? String(raw.id) : null;
  const start = typeof raw.start === "string" ? raw.start : null;

  if (!id || !start) {
    return null;
  }

  return {
    id,
    description: typeof raw.description === "string" && raw.description.trim()
      ? raw.description
      : "(no description)",
    start,
    stop: typeof raw.stop === "string" ? raw.stop : null,
    duration: Number.isFinite(raw.duration) ? Math.max(0, Math.floor(raw.duration)) : 0,
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((tag) => typeof tag === "string" && tag.trim())
      : [],
    project_id: raw.project_id !== undefined && raw.project_id !== null
      ? String(raw.project_id)
      : null,
    project_name: typeof raw.project_name === "string" && raw.project_name.trim()
      ? raw.project_name
      : null,
    project_color: normalizeHexColor(raw.project_color)
  };
}

export class SuperProductivityProvider {
  constructor(baseUrl = "http://127.0.0.1:3876") {
    this.baseUrl = baseUrl;
  }

  getProviderName() {
    return "super-productivity";
  }

  getFetchStatusMessage() {
    return "Fetching entries from Super Productivity...";
  }

  async _fetchJson(path, query = null, token = null) {
    const url = new URL(path, `${this.baseUrl}/`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, String(value));
      }
    }

    const headers = {
      Authorization: `Bearer ${token}`
    };
    const response = await fetch(url, { headers });
    const text = await response.text();

    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const errorMessage =
        payload && payload.error && typeof payload.error.message === "string"
          ? payload.error.message
          : text.slice(0, 180) || `HTTP ${response.status}`;
      throw new Error(`Super Productivity request failed (${response.status}): ${errorMessage}`);
    }

    if (payload && typeof payload === "object" && "ok" in payload) {
      if (payload.ok === true) {
        return payload.data;
      }

      const errorMessage =
        payload.error && typeof payload.error.message === "string"
          ? payload.error.message
          : "Unknown Super Productivity API error.";
      throw new Error(`Super Productivity API error: ${errorMessage}`);
    }

    return payload;
  }

  async fetchRawEntries({ token, targetDate }) {
    if (!token || typeof token !== "string" || !token.trim()) {
      throw new Error("Super Productivity API token is required.");
    }

    const safeDate = normalizeDateInput(targetDate);
    if (!safeDate) {
      throw new Error("Invalid target date format. Expected YYYY-MM-DD.");
    }

    const data = await this._fetchJson("/time-entries", {
      date: safeDate,
      includeOpen: "false",
      limit: "2000"
    }, token.trim());

    if (!Array.isArray(data)) {
      return [];
    }

    return data.map(normalizeEntry).filter(Boolean);
  }

  async fetchProjectMap({ rawEntries }) {
    const projectMap = new Map();

    for (const entry of Array.isArray(rawEntries) ? rawEntries : []) {
      if (!entry || entry.project_id === undefined || entry.project_id === null) {
        continue;
      }

      const projectId = String(entry.project_id);
      const existing = projectMap.get(projectId);
      if (!existing) {
        projectMap.set(projectId, {
          name: entry.project_name || null,
          color: entry.project_color || null
        });
        continue;
      }

      if (!existing.name && entry.project_name) {
        existing.name = entry.project_name;
      }
      if (!existing.color && entry.project_color) {
        existing.color = entry.project_color;
      }
    }

    return projectMap;
  }
}
