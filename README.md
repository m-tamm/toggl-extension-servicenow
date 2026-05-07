# Tracker Chromium Extension Prototype

This repo now contains:

- a quick CLI test script (`toggl-day-test.mjs`)
- a Manifest V3 browser extension that supports Toggl and Super Productivity, fetches entries for a date, caches one day locally per provider, and imports a selected entry date into the active page.

## Architecture (Refactor Baseline)

The extension was refactored to a provider-ready architecture while keeping current behavior unchanged:

- `popup.js`: UI orchestration only (rendering, events, import trigger)
- `app/time-entry-service.js`: application service use case for fetching/normalizing entries
- `adapters/toggl-provider.js`: Toggl-specific API adapter
- `domain/time-entry.js`: business logic and domain transforms
- `storage/chrome-storage.js`: storage and cache helper functions
- `lib/date-time.js`: shared date/time helpers
- `config.js`: constants for storage keys, ServiceNow target fields, and mapping values

This structure is intentionally prepared for adding more providers (for example Super Productivity local REST) without rewriting UI/business logic.

Current providers:

- Toggl (`https://api.track.toggl.com`)
- Super Productivity local REST (`http://127.0.0.1:3876`)

## 1) Load the extension in Chromium
1. Open `chrome://extensions` (or the equivalent in your Chromium-based browser).
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project as folder.


## 2) Extension behavior
1. First startup:
	- You can choose the active tracker via **Settings** in the popup.
	- The active tracker is shown as a visual indicator below the title.

2. Toggl selected and no token exists:
	- You see a token input and **Save Token** button.
	- Toggl API-Token can be found at https://track.toggl.com/profile (bottom of profile page)

3. Toggl token saved, or Super Productivity selected:
	- You see a date input and a **Fetch From ...** button for the selected tracker.

4. After fetch:
	- Entries are stored in extension local storage for one day (`24h` TTL).
	- The popup lists stored entries below the date input.

5. Refetch behavior:
	- If selected date differs from cached date, old cache is cleared before writing new data.
	- If cache is older than 24h, it is considered outdated and removed.
	- Cache is tracked per provider, so switching provider does not overwrite the other provider's cache.

6. Provider switching behavior:
	- Switching from Toggl to Super Productivity does **not** delete the stored Toggl token.
	- Only the active provider fetch logic changes.

7. Import behavior:
	- The import is built for the `Book Time` page in ServiceNow
	- Each list item has an import button.
	- Import writes the selected entry start datetime into the target input field in the currently active page.
	- Current selector: element id `task_time_worked.u_from`.
	- Current output format: `DD/MM/YYYY HH:mm:ss` (example: `14/04/2026 15:48:21`).


## 3) Tag Mapping For Rate Type
The extension maps Toggl tags to ServiceNow rate selections.

Implemented example mapping in `popup.js`:

- `admin` -> rate type `administrative`, category `administrative Tätigkeiten`
- `train` -> rate type `administrative`, category `Ausbildung`
- `meet` -> rate type `administrative`, category `Fachspezifische Meetings`
- `learn` -> rate type `administrative`, category `Weiterbildung`
- `code` -> rate type `business solution`, category `Business Solution`
- `dev` -> rate type `business solution`, category `Business Solution`

If multiple tags are present, the first matching tag wins.

Change this to your real internal field id once known.


## 4) Optional CLI test (already verified)
```bash
TOGGL_API_TOKEN=your_token_here node toggl-day-test.mjs 2026-04-13
```

## 5) Smoke Test After Refactor

1. Reload extension in `chrome://extensions`.
2. Open popup and verify token form appears when no token is stored.
3. Save token and verify date/fetch section appears.
4. Fetch a day with known entries and verify list renders.
5. Close/reopen popup and verify cache is loaded.
6. Use one entry import button on the ServiceNow Book Time page and verify fields are filled.
