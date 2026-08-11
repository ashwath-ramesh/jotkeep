# JotKeep website master checklist

Use this checklist to build and verify the JotKeep website. Mark an item
complete only after the site has the specified behavior and the applicable
tests pass. A task can describe behavior that already exists. The empty box
means that the behavior still needs verification.

All tasks use controlled English from
[ASD-STE100 Issue 9](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf).
Each task has one principal action. Exact interface labels are in bold.

## Scope

This checklist covers the JotKeep application, its dialogs and transient
states, its print view, and its essential public pages. It also covers narrow
screens, offline use, installation, accessibility, recovery, privacy,
security, compatibility, and release quality.

This checklist does not cover accounts, login, billing, subscriptions,
payments, e-commerce, teams, careers, affiliates, testimonials, social
features, administration, or collaboration.

## Terms

- **Browser storage:** Storage that the browser controls on the current
  device.
- **External backup:** A verified file that is outside browser storage.
- **IndexedDB:** The browser database that stores the local notebook.
- **HTML:** The markup language that a browser uses to structure a page.
- **JSON backup:** A user-owned text file that contains the complete notebook.
- **NVDA:** The NonVisual Desktop Access screen reader.
- **Restore point:** A saved notebook state that JotKeep can recover.
- **Safety File:** A user-owned `.jotkeep` file that contains the notebook and
  its restore points.
- **Service worker:** The browser process that stores the application files
  for offline use.
- **VoiceOver:** The Apple screen reader.

## Source map

The source checklist is
[Checklist Design](https://www.checklist.design/browse). The relevant source
groups are:

- Website: [Security](https://www.checklist.design/website/security),
  [Privacy](https://www.checklist.design/website/legal-privacy), and
  [404](https://www.checklist.design/website/404)
- Web app: [Help Center](https://www.checklist.design/web-app/help-center),
  [Settings](https://www.checklist.design/web-app/settings),
  [Single Item Detail](https://www.checklist.design/web-app/single-item-detail),
  [Empty State](https://www.checklist.design/web-app/empty-state),
  [Onboarding](https://www.checklist.design/web-app/onboarding),
  [Search Results](https://www.checklist.design/web-app/search-results), and
  [Version History](https://www.checklist.design/web-app/version-history)
- Design system:
  [Accessibility](https://www.checklist.design/design-system/accessibility),
  [Typography](https://www.checklist.design/design-system/typography),
  [Spacing and Grid](https://www.checklist.design/design-system/spacing-and-grid),
  [Color System](https://www.checklist.design/design-system/color-system),
  [Tokens](https://www.checklist.design/design-system/tokens),
  [Drawer](https://www.checklist.design/design-system/drawer),
  [Banner](https://www.checklist.design/design-system/banner),
  [Toast](https://www.checklist.design/design-system/toast),
  [Checkbox](https://www.checklist.design/design-system/checkbox),
  [Radio](https://www.checklist.design/design-system/radio),
  [Searchbar](https://www.checklist.design/design-system/searchbar),
  [Tooltip](https://www.checklist.design/design-system/tooltip),
  [Modal](https://www.checklist.design/design-system/modal),
  [Loading](https://www.checklist.design/design-system/loading),
  [Toggle](https://www.checklist.design/design-system/toggle),
  [Input Field](https://www.checklist.design/design-system/input-field),
  [Icon](https://www.checklist.design/design-system/icon),
  [Card](https://www.checklist.design/design-system/card),
  [Button](https://www.checklist.design/design-system/button), and
  [Dropdown Menu](https://www.checklist.design/design-system/dropdown-menu)
- Flows: [Uploading Media](https://www.checklist.design/flows/uploading-media)
  adapted to local files,
  [Filtering Items](https://www.checklist.design/flows/filtering-items),
  [Saving Changes](https://www.checklist.design/flows/saving-changes),
  [Showing Input Error](https://www.checklist.design/flows/showing-input-error),
  [Deleting Account](https://www.checklist.design/flows/deleting-account)
  adapted to local data removal,
  and [Submitting a Form](https://www.checklist.design/flows/submitting-a-form)

The tasks below adapt these sources to JotKeep. They do not copy generic
requirements that do not apply to this product.

## 1. Product entry and first use

- [x] State that JotKeep is a private, plain-text notepad before the first edit.
- [x] State that JotKeep does not require an account.
- [x] Explain that browser storage is not an external backup.
- [x] Put keyboard focus in the empty note body on the first visit.
- [x] Show a specific loading message until the notebook and event handlers are ready.
- [x] Prevent edits until JotKeep can keep or report each change.
- [ ] Show a specific failure message if application startup does not finish.
- [x] Provide a clear path from the first note to the backup instructions.

## 2. Application shell and navigation

- [x] Keep one page-level **JotKeep** heading in the accessibility tree.
- [x] Show the active note title at the top of the workspace.
- [x] Make the notes-panel control show its current expanded state.
- [x] Change the notes-panel control label when the panel state changes.
- [x] Show an overlay behind the notes panel on narrow screens.
- [x] Close the narrow notes panel when the user selects its overlay.
- [x] Close the narrow notes panel when the user presses `Escape`.
- [x] Move focus to a valid control after the narrow notes panel closes.
- [x] Prevent horizontal page scrolling at each supported viewport width.
- [x] Keep the title and primary toolbar controls visible at 200% zoom.

## 3. Notes list, search, and organization

- [x] Make **New note** create one selected blank note.
- [x] Show a useful fallback title for an untitled note.
- [x] Show a bounded content preview in the detailed note list.
- [x] Show the modification time in the detailed note list.
- [x] Identify the active note with text or structure in addition to color.
- [x] Make note search match titles and note bodies.
- [x] Keep the current search query visible while results change.
- [x] Show the number of notes that match the current search.
- [x] Show a no-results message when note search finds no match.
- [x] Provide a direct action that clears a no-results search.
- [ ] Use a different message when the notebook has no notes to show.
- [x] Keep the selected sort order after a reload.
- [x] Keep note deletion separate from note selection.
- [x] Request confirmation before JotKeep deletes a note.

## 4. Note editor and editing commands

- [x] Make the note title field edit the active note title.
- [x] Treat all note content as plain text.
- [x] Show a clear prompt in an empty note body.
- [x] Keep the text selection when a command temporarily moves focus.
- [x] Make **Undo** and **Redo** use the expected platform behavior.
- [x] Make **Cut**, **Copy**, and **Paste** report permission failures.
- [x] Make **Select all** select only the active note body.
- [x] Make **Find** move to the next or previous literal match.
- [x] Make **Find** support case matching and whole-word matching.
- [x] Make **Replace** change one selected match without changing other text.
- [x] Make **Replace all** report the number of changed matches.
- [x] Insert the date, a special character, or an emoji at the saved cursor.
- [x] Make the command palette search labels, categories, and related terms.
- [x] Update the word and character counts after each edit.

## 5. Automatic save, storage, and status

- [x] Show **Local: Saving…** while IndexedDB receives a change.
- [x] Show **Local: Saved** only after IndexedDB stores the current notebook.
- [x] Keep the unsaved state until a failed save succeeds.
- [x] Explain a storage failure without hiding the editor.
- [ ] Give a specific action when browser storage is full.
- [ ] Give a specific action when IndexedDB is unavailable.
- [x] Retry a failed save after the user makes another change.
- [x] Keep a bounded recovery journal for the most recent unsaved edit.
- [x] Recover a newer journal entry before the user edits the stored note.
- [x] Prevent an older tab from overwriting a newer notebook revision.
- [x] Report a conflicting change from another JotKeep tab.
- [x] Keep local-save status separate from Safety File status.
- [x] Keep external-backup status separate from browser-persistence status.
- [x] Show the browser-persistence result without calling it a backup.

## 6. Files, backups, and Safety Files

- [x] Reject a malformed or oversized text file without changing the notebook.
- [x] Keep the current note usable while JotKeep reads a text file.
- [x] Put only the note body in a downloaded text file.
- [x] Describe a browser download as requested until the user verifies the file.
- [ ] Export every note, timestamp, preference, and active selection in a JSON backup.
- [x] Include a format version and integrity check in each JSON backup.
- [ ] Validate the backup type, version, fields, size, and integrity before import.
- [x] Reject an invalid backup before JotKeep changes any local data.
- [x] Explain the result of **Merge** before the user confirms it.
- [x] Explain the result of **Replace** before the user confirms it.
- [x] Keep the notebook unchanged when the user cancels a restore.
- [x] Save a restore point before a confirmed backup restore.
- [x] Make **Test my backup…** validate a file without changing the notebook.
- [x] Show the age of the most recently verified external backup.
- [x] Warn when the verified external backup content is more than seven days old.
- [x] State that an unencrypted Safety File contains readable note content.
- [x] Update a connected Safety File only after the local save succeeds.
- [x] Read and verify a connected Safety File after each write.
- [x] Show **Backed up** only after the read-back verification succeeds.
- [x] Pause automatic Safety File writes after file permission is lost.
- [x] Pause automatic writes when another program changes the Safety File.
- [x] Explain each Safety File conflict action before the user selects it.
- [x] Request explicit confirmation before local data overwrites a Safety File.
- [x] Keep the external file unchanged when the user disconnects it.
- [x] Provide a Safety File download when direct file access is not available.
- [ ] Warn before notebook or history size prevents a complete external backup.

## 7. History, recovery, and local data removal

- [x] List restore points in reverse chronological order.
- [x] Show a read-only preview before a history restore.
- [x] Let the user select the note in the selected restore point.
- [x] Keep history actions disabled while the preview loads.
- [x] Report a damaged restore point without changing the notebook.
- [ ] Explain the difference between **Restore note** and **Restore a copy**.
- [x] Request confirmation before a full-notebook restore.
- [x] Save the current notebook before each confirmed history restore.
- [x] Keep unrelated notes unchanged during a single-note restore.
- [x] Explain that local history is not an external backup.
- [x] Put **Clear all local data…** in a separated danger area.
- [x] State each local data type that the clear operation removes.
- [x] State that the clear operation does not delete downloaded files.
- [x] Keep all local data when the user cancels the clear operation.

## 8. Menus, dialogs, forms, and feedback

- [x] Group related File-menu actions with visible separators.
- [x] Put destructive menu actions after non-destructive actions.
- [x] Keep each menu inside the visible viewport.
- [x] Support arrow-key navigation in each application menu.
- [x] Return focus to the menu trigger when `Escape` closes the menu.
- [x] Give each dialog one clear title.
- [x] Give each dialog one visible close or cancel action.
- [x] Keep keyboard focus inside an open modal dialog.
- [ ] Return focus to the opening control after a dialog closes.
- [x] Make each radio-option label select its radio control.
- [x] Disable a confirmation action until its required data is valid.
- [x] Show a specific loading message for a slow dialog action.
- [x] Keep an error message next to the action that caused the error.
- [x] Use text with each success, warning, and error color.
- [x] Keep important feedback visible when the status bar is hidden.

## 9. Appearance, fullscreen mode, and print

- [x] Provide explicit System, Light, and Dark appearance choices.
- [x] Apply the selected theme before the first visible paint.
- [x] Keep the selected editor typography after a reload.
- [x] Apply editor appearance changes without changing note content.
- [x] Make **Reset to defaults** restore every appearance setting.
- [x] Keep one visible fullscreen exit control while fullscreen mode is active.
- [x] Report a browser rejection of the fullscreen request.
- [x] Print the complete active note title and body.
- [x] Remove application controls from the print output.
- [x] Use black text on a white surface in the print output.
- [x] Wrap long lines to the printable page width.

## 10. Offline use, installation, and updates

- [x] Cache every required application-shell file for offline use.
- [x] Open the application offline after one successful online visit.
- [x] Keep existing notes editable while the device is offline.
- [x] Report a service-worker installation failure to the user.
- [ ] Provide a retry path after an offline setup failure.
- [x] Include valid application icons for regular and maskable installation.
- [x] Define a stable application identifier, start path, and scope.
- [x] Keep a new service worker waiting while an old application tab is active.
- [x] Show **Update ready — refresh** only when the update can activate safely.
- [ ] Save pending edits before JotKeep activates an accepted update.

## 11. Accessibility and input methods

- [ ] Meet Web Content Accessibility Guidelines level AA for the application.
- [x] Keep normal text contrast at 4.5 to 1 or higher.
- [ ] Keep large-text and control contrast at 3 to 1 or higher.
- [x] Show a visible focus indicator on every interactive control.
- [x] Keep the focus indicator visible in forced-color mode.
- [x] Make every core action available with a keyboard.
- [x] Give each icon-only button an accessible name.
- [x] Keep decorative icons out of the accessibility tree.
- [x] Use native headings in a logical order.
- [x] Use native labels for each input, select, and text area.
- [x] Use the correct role and state for each menu, listbox, and dialog.
- [x] Use one controlled live region for important application results.
- [x] Prevent routine save transitions from interrupting screen-reader output.
- [x] Preserve a logical reading order when the layout changes.
- [ ] Keep all content usable at 200% browser zoom.
- [ ] Keep the application usable at 400% browser zoom on a narrow viewport.
- [ ] Keep each touch target large enough for reliable selection.
- [x] Remove nonessential animation when reduced motion is requested.
- [ ] Test the core journeys with VoiceOver and Safari.
- [ ] Test the core journeys with NVDA and Chrome.

## 12. Visual system and component quality

- [ ] Use semantic color tokens instead of raw colors in components.
- [x] Define each feedback color for the Light and Dark themes.
- [x] Reserve green for verified success states.
- [x] Reserve amber for states that need user attention.
- [ ] Reserve red for failures and destructive actions.
- [ ] Use the slate accent only for selection and current location.
- [x] Use the documented type family for writing, controls, and status data.
- [ ] Define a minimum readable size for all interface text.
- [ ] Use the documented spacing scale for layout and component spacing.
- [ ] Use named, content-based breakpoints for responsive changes.
- [x] Use one base shape for each control family.
- [x] Give each button a default, hover, focused, pressed, and disabled state.
- [x] Use shadows only for menus, dialogs, and the narrow notes drawer.
- [ ] Keep icon stroke, size, and optical alignment consistent.

## 13. Essential public pages and trust content

- [x] Publish a privacy page in plain language.
- [x] Explain which data stays in browser storage.
- [x] Explain when JotKeep can read or write a user-selected file.
- [x] Explain how users can remove all local JotKeep data.
- [x] State whether the site uses cookies, analytics, or external requests.
- [x] Put a last-reviewed date on the privacy page.
- [x] Provide a contact method for privacy questions.
- [ ] Publish a security page in plain language.
- [ ] Explain the protection limits of browser storage and Safety Files.
- [ ] Explain that Safety File integrity checks do not provide encryption.
- [ ] Provide a responsible vulnerability-reporting method.
- [ ] Keep the security page free of unverified certification claims.
- [ ] Publish the user guide as accessible help content.
- [ ] Link related recovery and backup topics to each other.
- [ ] Create a branded not-found page for an invalid path.
- [ ] Explain that the requested page does not exist.
- [ ] Provide a direct link from the not-found page to JotKeep.

## 14. Performance, compatibility, testing, and release

- [x] Reserve the desktop notes-panel space before the application initializes.
- [x] Prevent self-hosted font loading from moving visible content.
- [x] Keep note-list previews bounded for large notes.
- [ ] Avoid whole-notebook work when one note changes.
- [ ] Keep the editor responsive with the maximum supported notebook size.
- [ ] Test startup with a slow network and an empty browser cache.
- [ ] Test the core journeys in the supported Chromium browsers.
- [x] Test file fallbacks in browsers without direct file access.
- [x] Verify that note content never becomes executable HTML.
- [x] Verify that the Content Security Policy permits only required resources.
- [ ] Serve JotKeep from an origin that no unrelated application uses.
- [x] Run all unit and end-to-end tests before release.
- [ ] Check the browser console for uncaught errors in each core journey.
