# Tab Tidy

A Chrome extension to browse open tabs by domain and full page title, find and close duplicates across **all Chrome windows**, prevent new duplicates with Shield, and save inactive tabs in a searchable parking lot. Includes Undo, a live toolbar count, and optional tracking-parameter matching.

## Install

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder, `close-duplicate-tabs`.
4. Pin **Tab Tidy** from Chrome’s extensions menu, then click its icon.

No build or dependency installation needed. Chrome 127 or newer (for opening the popup from a shortcut).

The toolbar popup keeps a 420px minimum width and expands to 760px while the tab finder is open. Long titles and URLs wrap inside the available width.

Already installed? Reload Tab Tidy in `chrome://extensions`. Version 1.3 uses the existing `tabs` and `storage` permissions; no additional permissions are needed.

## Find a tab

Click **Find a tab** to browse your open tabs without remembering a search term. The finder starts with the current tab's domain selected; **All domains** is used when the current page has no listed domain.

Press **⌘⇧K** on Mac or **Ctrl+Shift+K** on Windows/Linux while Chrome is active to open the finder directly, with search focused. Customize **Open domain search** at `chrome://extensions/shortcuts` (use **In Chrome** scope). If another shortcut already uses that combination, assign an available one there. Reload the extension after updating to register the command.

- Select a domain on the left to see every matching tab's full title, URL, and window on the right. Long lists scroll; titles are never truncated or hidden behind Show more.
- Click a title to activate that existing tab and focus its window. The finder does not navigate, reload, close, or rearrange tabs.
- **Filter titles** optionally narrows the list by title, URL, or ticket ID. Hiding the filter clears it and restores all titles.
- Domains show tab counts. Current-tab, private, pinned, loading, and audio states appear on rows. Subdomains remain separate; internal browser pages and local files have their own categories. Tab Tidy's own pages are excluded.
- Titles and counts update as tabs open, close, navigate, or move. A vanished domain falls back to All domains. A closed selection shows an error and refreshes the list.
- Use **Tab** to reach controls. In the domain sidebar, **↑/↓** selects the previous/next domain and **Home/End** selects the first/last. In the title list, those keys move between titles; **Enter** switches to the focused tab. **Esc** or **×** closes the finder and restores the normal popup width.

All grouping and optional filtering happen locally using existing tab metadata. No page content is read or captured.

## Use

The popup shows how many **extra tabs** can be closed, grouped by URL. Three tabs with the same URL count as two duplicates.

- **Close** beside a tab closes that individual copy.
- **Close N** beside a URL closes that URL’s extra copies.
- **Close all duplicate tabs** closes all listed extra copies.
- **Undo last cleanup** reopens tabs closed by your most recent cleanup, including after you close and reopen the popup. A later cleanup replaces that Undo; a cleanup that closes nothing preserves it.
- The **toolbar badge** shows the current extra-tab count even when the popup is closed. It disappears when there are no duplicates; hover over the icon for the full count and matching mode.
- **Ignore tracking parameters** optionally groups HTTP(S) links that differ only by known tracking tags. The setting is remembered and also applies to the badge and cleanup.
- Hover over a truncated URL to see its full value; refresh to scan again.

## Domain siblings

Click **Group by domain** in Duplicates to place tabs from the same hostname next to each other, separately within every window. For example, A1, B1, A2, B2 becomes A1, A2, B1, B2. Domain order follows its first appearance; each domain's tabs keep their relative order. Different subdomains remain separate; HTTP and HTTPS pages with the same hostname are siblings.

**Keep same-domain tabs together** is checked by default and remembered on this device. It arranges tabs when they open, finish navigating, change domain, close, or move between windows, and at browser startup or extension installation/update. Turn it off for manual arrangement only; the button still works. Manual dragging is left alone until another tab event triggers arrangement.

Pinned tabs, existing Chrome tab groups, internal pages, and tabs with pending navigation stay in place and form boundaries: siblings are arranged within each uninterrupted run of ordinary web tabs. Tabs are moved, never closed or reloaded; active tabs and separate windows stay intact. This uses the existing [Chrome Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs) permission.

## Duplicate Shield

Enable **Duplicate Shield** in the Duplicates view. It is off by default. Opening a new HTTP(S) tab with a URL already open activates the existing copy and closes the new extra tab. Shield follows the exact/smart matching preference, favors existing pinned copies, and keeps regular and private browsing separate. It records a caught-duplicate count for the current browser session.

Shield handles new blank tabs as they receive their first web URL, including redirects during the first load. It stops watching once that first page finishes or has loaded for 30 seconds, so ordinary navigation in an existing tab is left alone. Newly pinned, audible, or discarded tabs are skipped. Undo and intentional parking-lot reopens bypass Shield during their initial navigation.

## Tab parking lot

Choose **Parking lot** in the popup. **Park inactive** defaults to tabs unused for **2+ days**, as requested. The selector also offers 24+ hours or any currently inactive tab. Active tabs in each window, pinned tabs, playing audio, pending navigation, and non-HTTP(S) pages stay open. The inactivity cutoff is rechecked immediately before closing a tab.

- Expand **Open tabs you can park** to park a newer inactive tab individually.
- Search saved links by title or URL.
- Open-tab and parked-link lists start with five rows; **Show more** reveals the next five. Long titles wrap, and long URLs show two wrapped lines with **Show more / Show less** for the full URL.
- **Reopen** opens the original URL, or focuses an existing exact-URL copy, then removes the saved entry.
- **Delete** removes a saved link without affecting open tabs.

A link is saved successfully before its tab is closed. Repeated copies of the same exact URL share one saved entry. Normal parked links remain on this device across popup closure, browser restarts, and extension updates until reopened, deleted, or the extension is uninstalled. Private parked links remain only in session memory and disappear on browser restart or extension reload/disable/update. Parking saves links, not page history, unsaved edits, scroll position, or tab groups. Parking and Shield do not replace the manual cleanup Undo.

## Matching and Undo

One copy stays open for each URL: pinned first, then active, then the lowest tab ID. If several pinned copies share a URL, only one is kept. Exact matching is the default: query strings, fragments, paths, and protocols must match exactly. Tabs with pending navigation are skipped until navigation finishes. Regular and incognito tabs are never combined. Incognito is excluded unless you enable it in Chrome’s extension settings.

Smart matching removes `utm_*`, `gclid`, `dclid`, `fbclid`, `msclkid`, `mc_cid`, `mc_eid`, `_ga`, and `_gl` parameters when comparing HTTP(S) URLs. Other parameters, their order and encoding, paths, protocols, and fragments stay significant. Tabs retain their actual URLs; Undo reopens those original URLs. The popup shows each tab’s URL when smart matching is enabled.

Undo preserves tab order, pinned state, and the original window where possible; if cleanup closed a window, Undo recreates it. Tabs reopen as new page loads: page history, unsaved form state, scroll positions, and tab groups are not restored. Failed restores remain available for retry. Undo data is cleared by browser restart or extension reload, disable, or update.

The list updates while the popup is open. Tabs are checked again before every close; tabs that navigated or became the last copy are skipped. Cleanup continues if the popup closes. Closing the last tab in a window may close that window. Chrome’s usual **Ctrl+Shift+T** / **Cmd+Shift+T** can reopen recently closed tabs.

## Privacy and permissions

The `tabs` permission reads URLs, titles, activity, and audio/pin state for matching, Shield, and parking ([Chrome Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)). The `storage` permission saves preferences and normal parked links (URL, title, saved time, original window/position) locally. The last cleanup’s recovery data, Shield’s candidate/bypass tab IDs and caught count, and private parked links stay in temporary session memory ([Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)). Successful Undo removes its temporary backup. All processing stays on your device. No content scripts, remote resources, analytics, or extension network requests.

## Verify

From the source folder, run `npm test` (Node.js 18+). Tests cover exact/smart matching, cross-window cleanup, Undo and interrupted-worker recovery, Shield navigation/bypass/protected tabs, parking storage failures and age revalidation, private-tab storage, and reopen/delete behavior.

For actual Chrome integration and accessibility checks, run `npm install`, `npx playwright install chromium`, then `npm run test:browser`. The test creates disposable pages on a local HTTP server and an isolated browser profile; your usual Chrome tabs are untouched. Optionally set `CHROME_PATH` to a Chrome for Testing executable. Browser tests also verify the badge, saved preferences, concurrency, popup closure, Shield, intentional Undo, the two-day parking default, manual/bulk parking, live search, and reopen/delete.

The matching checkbox follows Modern Web Guidance’s `forms` guidance: “always associate `<label>` with its input using `for` and `id`” and “use `accent-color` for quick branding of native radios/checkboxes.” It uses native keyboard interaction and a visible focus ring.

The `typography` guidance recommends “Use `overflow-wrap: break-word` (or `anywhere`) to contain long URLs.” Cards use `overflow-wrap: anywhere` and grid tracks that can shrink so long links cannot create a horizontal scrollbar.

`npm run test:finder` checks the finder with real Chrome tabs: current-domain selection, full titles, optional filtering, keyboard interaction, live updates, closed-tab recovery, cross-window switching without navigation, layout, and accessibility. `npm run test:popup-size` checks Chrome’s actual toolbar popup, including expansion to 760px and size/focus restoration after closing the finder.

The finder follows Modern Web Guidance's `dialog` guidance: “Use the native `<dialog>` element” and “DON'T add `role="dialog"`, `aria-modal`, a focus trap”. Chrome provides modal focus handling and Escape; the finder includes a visible close button, an accessible heading, and scroll containment.

Manual Chrome check: open three copies of one URL in two windows, plus a different query string or fragment. The popup should report two duplicates. Close one individually, then close all; the unique URL and one matching copy should remain. Repeat with a pinned copy, and check the empty state after cleanup.
