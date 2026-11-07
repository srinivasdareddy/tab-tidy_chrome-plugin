# Privacy Policy for Tab Tidy

Last updated: November 7, 2026

Tab Tidy helps you find, organize, deduplicate, and save browser tabs. This policy describes the extension’s handling of information on your device.

## Information handled

Tab Tidy reads open-tab titles, URLs, tab and window identifiers, tab positions, pinned and active state, audio and loading state, incognito state, and last-accessed timestamps. It uses this information to show and search tabs, identify duplicates, group tabs by hostname, prevent newly opened duplicates, and find inactive tabs to park.

When you park a tab, Tab Tidy stores its title, original URL, saved time, original window and position, and an entry identifier. Cleanup recovery stores the original tab information needed to reopen closed tabs. Preferences include matching mode, Duplicate Shield, domain grouping, and parking cutoff. Shield keeps temporary tab identifiers, candidate URLs, and a caught-duplicate count.

Tab titles and URLs can contain personal information. Tab Tidy does not inspect page bodies, form entries, passwords, cookies, or page screenshots. It does not request access to Chrome’s browsing-history database.

## Storage and purpose

All extension processing occurs on your device. Preferences and normal parked links are stored using Chrome’s local extension storage. Cleanup recovery, pending cleanup records, Shield tracking, and private parked links use temporary session storage. Open-tab information is read as needed for the tab-management features.

Tab Tidy does not use Chrome storage synchronization, an account system, advertising, analytics, tracking cookies, or remote code. It does not transmit tab data to the developer or to third parties. The developer has no access to the extension’s locally stored data.

## Sharing and external websites

Tab Tidy does not sell, rent, or share user data. Information is used only for the extension’s tab-management functions, never for advertising, profiling, creditworthiness, or lending.

When you reopen or switch to a website, Chrome loads or displays that website normally. The destination website’s own privacy practices apply. If you contact the developer through GitHub, GitHub processes what you submit under its own privacy policy. Public issue reports are visible to others; do not include private URLs, credentials, or personal browsing information.

## Retention and deletion

Normal parked links remain until you reopen or delete them, clear extension data, or uninstall Tab Tidy. Preferences remain until changed, cleared, or the extension is uninstalled.

Cleanup Undo is replaced by the next cleanup that closes tabs. Successfully restored entries are removed; failed restores remain available to retry. Temporary recovery, Shield tracking, and private parked links clear when the browser restarts or the extension is reloaded, disabled, or updated. Shield’s enabled preference is stored locally and persists separately.

Use Delete in Parking lot to remove individual saved links. Uninstalling Tab Tidy removes its extension storage. Closing the popup alone does not delete parked links or current-session recovery data.

## Incognito browsing

Incognito access is disabled unless you enable it in Chrome’s extension settings. If enabled, regular and private tabs are kept separate for matching and reopening. Private parked links are kept only in temporary session storage.

## Permissions

- **tabs:** read tab metadata and manage tabs for finding, deduplication, organization, Shield, parking, and Undo.
- **storage:** retain preferences, parked links, and temporary feature state on your device.

## Policy changes

This page will be updated if the extension’s data practices change. Its Last updated date identifies the current policy. Material changes will also be described in the project’s release notes.

## Contact

For privacy questions, contact Srinivas Reddy through the [Tab Tidy issue tracker](https://github.com/srinivasdareddy/tab-tidy_chrome-plugin/issues). Avoid posting sensitive information in a public issue.
