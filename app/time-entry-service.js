import { normalizeEntriesWithProjects, preserveImportedFlags } from "../domain/time-entry.js";

export class TimeEntryService {
  constructor(provider) {
    this.provider = provider;
  }

  async fetchNormalizedEntries({ token, targetDate, timezone, previousEntries }) {
    const rawEntries = await this.provider.fetchRawEntries({ token, targetDate, timezone });
    const projectMap = await this.provider.fetchProjectMap({ token, rawEntries });

    const normalizedEntries = normalizeEntriesWithProjects(rawEntries, targetDate, timezone, projectMap);
    return preserveImportedFlags(normalizedEntries, previousEntries);
  }
}
