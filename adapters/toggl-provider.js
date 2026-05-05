import { toUtcIsoBoundary } from "../lib/date-time.js";

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

export class TogglProvider {
  getProviderName() {
    return "toggl";
  }

  getAuthErrorMessage() {
    return "Please provide a Toggl API token.";
  }

  getFetchStatusMessage() {
    return "Fetching entries from Toggl...";
  }

  async fetchRawEntries({ token, targetDate }) {
    const startDate = toUtcIsoBoundary(targetDate, -1, false);
    const endDate = toUtcIsoBoundary(targetDate, 1, true);

    const url = new URL("https://api.track.toggl.com/api/v9/me/time_entries");
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("end_date", endDate);

    const auth = btoa(`${token}:api_token`);

    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Toggl request failed (${response.status}): ${text.slice(0, 140)}`);
    }

    return response.json();
  }

  async fetchProjectMap({ token, rawEntries }) {
    return fetchProjectsForEntries(token, rawEntries);
  }
}
