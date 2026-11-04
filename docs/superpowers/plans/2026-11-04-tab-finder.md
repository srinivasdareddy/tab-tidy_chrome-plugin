# Tab Finder Implementation Plan

> Use superpowers:executing-plans. Execute in the current authorized project; leave changes reviewable and uncommitted.

**Goal:** Recognize and switch to an existing tab by browsing its full title under a domain.

**Architecture:** Add a native dialog launched from the popup. A small pure module groups/filter tabs and activates an existing tab; a separate UI module owns dialog state and live refresh. The service worker finishes activation and window focus even if the popup closes.

**Tech stack:** Existing vanilla HTML/CSS/ES modules, Chrome MV3, Node test runner, Playwright/axe.

**Spec:** Approved concept in this chat: domain sidebar/counts, current domain selected initially, full titles and smaller URLs, single-click activation, optional hidden filter, keyboard support.

## Constraints and decisions

- Existing `tabs` and `storage` permissions; Chrome 121 floor; no dependencies, content scripts, screenshots, or remote resources.
- Browse first: no typing, pagination, or title truncation required. Scroll long lists.
- Expand popup only while dialog is open; native Escape/Close restore popup size and focus.
- Keep hostnames separate, include browser/local pages in named categories, exclude this extension's pages.
- Show current-tab, pinned, audio, and private status; mark other windows explicitly.
- Preserve selected domain/filter during live changes. If a selected domain disappears, show All domains.
- Do not close, navigate, reload, or reorder tabs when selecting a title.

## Review focus

1. A tab closes or moves between listing and activation: refresh and show an error; use the updated tab's window.
2. Long titles, URLs, many domains: wrap and scroll without horizontal overflow.
3. Chrome toolbar popup resizing/top layer: verify actual toolbar bounds and focus restoration.
4. Async tab events: reject stale scans and preserve focused row and scroll.
5. User title/URL content: text nodes only, never HTML injection.

## Task 1: Grouping and activation

Files: `tab-finder.js`, `tests/tab-finder.test.js`.

- [x] Write failing tests for hostname groups, browser/local/missing URLs, empty title fallback, subdomains, own-page exclusion, optional filtering, activation without navigation, moved/closed tabs.
- [x] Run `node --test tests/tab-finder.test.js`; confirm feature missing.
- [x] Implement `finderDomain(tab)`, `groupFinderTabs(tabs, ownOrigin)`, `filterFinderTabs(groups, domain, query)`, `activateFinderTab(browser, tabId)`.
- [x] Run focused tests and `npm test`; expect all pass.

## Task 2: Dialog and worker integration

Files: `tab-finder-ui.js`, `popup.html`, `popup.css`, `popup.js`, `background.js`, `scripts/finder-smoke.cjs`.

- [x] Write browser smoke test for launch/current domain, all titles, optional filter, real cross-window activation without creating/closing tabs, live changes, keyboard, empty state, escaped titles, layout and axe.
- [x] Run smoke test before UI implementation; expect missing finder launch control.
- [x] Implement `initTabFinder(browser)` using the Task 1 module; register `focus-tab` message in worker, validate numeric ID.
- [x] Add native modal, wide layout, initial current-domain selection, full-title buttons, live events, refresh/error handling, focus and scroll preservation.
- [x] Unlock the launch control with existing popup controls after operations.
- [x] Run browser smoke test; expect all checks pass.

## Task 3: Native popup checks and release notes

Files: `scripts/popup-size-smoke.cjs`, `README.md`, `manifest.json`, `package.json` (no lockfile in this project).

- [x] Extend actual toolbar test to open/close finder, verify expanded width and bounds, and restore 420px.
- [x] Document usage, bump version consistently to 1.3.0, add `test:finder` script.
- [x] Run unit, finder browser, existing browser, and actual-popup checks using installed Chrome for Testing.
- [x] Request a semantic review of the final working diff; fix material issues, rerun affected checks.

## Evidence ledger

- Baseline: clean working tree; `npm test`: 47/47 pass.
- Authorization: user approved displayed concept with “lets build it”; execute without another design approval.
- Scope: additive feature in the existing checkout, no unrelated refactor or publishing.

- Final verification: `npm test` 53/53 pass; finder integration, existing extension integration, native toolbar sizing/focus, and axe checks pass. `git diff --check` clean.
- Review: semantic reviewer found one P2 keyboard-focus recovery issue after failed activation. Reproduced with a failing browser assertion, restored an enabled title/Refresh control on failure, and verified ArrowDown browsing continues.
- Test fixture correction: served Unicode titles as UTF-8. Native close dispatch is queued, so width verification waits for restoration rather than checking before the close listener runs.
- Release: 1.3.0; permissions unchanged (`tabs`, `storage`); no publishing or user-profile changes.
