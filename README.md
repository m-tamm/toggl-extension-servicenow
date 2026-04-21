# Toggl Chromium Extension Prototype

This repo now contains:

- a quick CLI test script (`toggl-day-test.mjs`)
- a Manifest V3 browser extension that stores a Toggl API token, fetches entries for a date, caches one day locally, and imports a selected entry date into the active page.

## 1) Load the extension in Chromium
1. Open `chrome://extensions` (or the equivalent in your Chromium-based browser).
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project as folder.


## 2) Extension behavior
1. First startup (or when no token exists):
	- You see a token input and **Save Token** button.
	- Toggl API-Token can be found at https://track.toggl.com/profile (bottom of profile page)

2. After token is saved:
	- You see a date input and **Fetch From Toggl** button.

3. After fetch:
	- Entries are stored in extension local storage for one day (`24h` TTL).
	- The popup lists stored entries below the date input.

4. Refetch behavior:
	- If selected date differs from cached date, old cache is cleared before writing new data.
	- If cache is older than 24h, it is considered outdated and removed.

5. Import behavior:
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
