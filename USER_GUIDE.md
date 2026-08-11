# JotKeep User Guide

This guide gives simple instructions for the important JotKeep features.

JotKeep keeps your notes on your device. You do not need an account.

> WARNING: Browser storage is not an external backup. Browser settings can
> remove this storage.

Keep at least one tested JSON backup or Safety File outside the browser.

## Start JotKeep

1. Open JotKeep in a supported browser.
2. Wait until the status shows **Local: Saved**.
3. Select the notes-panel button if the notes panel is closed.

On a small screen, select **More** to find the file and editor commands.

## Write a note

1. Select **New note**.
2. Type a title in the title field.
3. Type the note in the editor.
4. Wait until the status shows **Local: Saved**.

JotKeep saves changes after you stop typing. The status bar shows the word and
character counts when the status bar is visible.

The browser spellchecker operates in the editor. Browser settings control the
spellchecker language.

## Find and organize notes

- Select a note in the notes panel to open it.
- Type text in **Search notes** to search titles and note content.
- Use **Sort notes** to sort by modification date, creation date, or title.
- Use **Note list view** to select the detailed view or compact view.
- Change the title in the title field to rename a note.

### Clear a note

1. Open the note.
2. Select **Clear**.
3. Confirm the operation.

This operation removes the title and content. It does not remove the note
record.

### Delete a note

1. Find the note in the notes panel.
2. Select the delete button for the note.
3. Confirm the operation.

JotKeep saves a restore point before it deletes the note.

## Edit note content

Use the toolbar commands for these operations:

- **Undo** and **Redo**
- **Cut**, **Copy**, and **Paste**
- **Delete** and **Select all**
- **Find** and **Replace**
- **Insert → Date and time**
- **Insert → Special character**
- **Insert → Emoji**

The **Find** window can find the next match or the previous match. You can
also match case or match a whole word.

The **Replace** window can replace one match or all matches.

## Use text files

### Open a text file

1. Select **File → Open text file…**.
2. Select a UTF-8 `.txt` file.
3. Wait until JotKeep creates a new note.

JotKeep uses the file name as the note title.

### Download one note

1. Open the note.
2. Select **File → Download note**.
3. Confirm that the browser completed the download.

The text file contains the note content. It does not contain notebook
preferences or history.

## Make a JSON backup

A JSON backup contains all notes, timestamps, and notebook preferences.

1. Wait until the local status shows **Saved**.
2. Select **File → Export JSON backup…**.
3. Confirm that the browser completed the download.
4. Move the file to a safe location.
5. Do the backup test.

The export operation cannot prove that the downloaded file stays on your
device.

## Test a backup

This test does not change the current notebook or the selected backup file.

1. Select **File → Test my backup…**.
2. Select a JotKeep `.json` or `.jotkeep` file.
3. Wait for the test result.
4. Make sure that the result shows **Test passed**.

A successful test proves that the selected file was recoverable at test time.

JotKeep shows the age of the last verified external backup. JotKeep shows a
warning when the backup content is more than seven days old.

## Restore a JSON backup

1. Select **File → Restore JSON backup…**.
2. Select the backup file.
3. Read the file summary.
4. Select **Merge** or **Replace**.
5. Confirm the restore operation.
6. Check the restored notes.

**Merge** adds copies of the backup notes. It keeps the current preferences
and active note.

**Replace** replaces all local notes and preferences with the backup data.

JotKeep validates the backup before the restore. JotKeep also saves the
current notebook as a restore point.

## Use a Safety File

A Safety File has the `.jotkeep` file extension. It contains the current
notebook and its restore points.

Safety Files use plain JSON. They are not encrypted. Anyone who can access a
Safety File can read its note titles and content.

### Create a connected Safety File

Use this procedure when the browser supports direct file access.

1. Select **File → Create Safety File…**.
2. Select a file name and location.
3. Give file access when the browser asks for it.
4. Wait until the status shows **Backed up**.

JotKeep updates a connected Safety File after each successful local save.
JotKeep verifies the file after each write.

Wait for **Backed up** before you close JotKeep.

### Download a Safety File

Use this procedure when direct file access is not available.

1. Wait until the local status shows **Saved**.
2. Select **File → Download Safety File…**.
3. Confirm that the browser completed the download.
4. Move the file to a safe location.
5. Do the backup test.

JotKeep cannot automatically update a downloaded Safety File. Download a new
file after important changes.

### Open a Safety File

1. Select **File → Open Safety File…**.
2. Select the `.jotkeep` file.
3. Read the file summary.
4. Select **Replace** or **Merge**.
5. Confirm the operation.

**Replace** uses the Safety File notes, preferences, and history.

**Merge** adds its notes and keeps the local preferences.

### Verify a connected Safety File

1. Select **File → Verify Safety File…**.
2. Wait for the verification result.

Verification checks the file format, checksum, notebook, and restore points.
JotKeep reports when the Safety File does not match the local notebook or history.

### Restore file permission

1. Select **File → Grant Safety File access…**.
2. Give file access when the browser asks for it.
3. Wait for the verification result.

### Resolve a Safety File conflict

JotKeep pauses automatic updates when another program changes the Safety
File.

1. Select **File → Resolve Safety File conflict…**.
2. Read what each operation changes.
3. Select one of the available operations.
4. If you select **Overwrite with local**, review the final warning and select
   **Overwrite Safety File**.

Use these operation rules:

- Select **Use Safety File** to save the current local notebook as a restore
  point and then replace it with the file's notes, preferences, and history.
- Select **Overwrite with local** to replace the external file's notes,
  preferences, and history with the current local data.
- Select **Disconnect** to keep both files unchanged and stop automatic updates.

> WARNING: **Overwrite with local** removes the current content of the Safety
> File. Make sure that the local notebook is correct.

### Disconnect a Safety File

1. Select **File → Disconnect Safety File**.
2. Check that the Safety File status shows **Not connected**.

This operation removes the remembered connection. It does not delete or
change the external file.

## Restore notebook history

JotKeep keeps automatic restore points in browser storage. Local history is
not an external backup.

1. Select **File → Browse history…**.
2. Select a restore point.
3. Select a note.
4. Read the earlier note in the preview.
5. Select the necessary restore operation.

Use these restore operations:

- **Restore note** replaces that note or recovers a deleted note.
- **Restore a copy** creates a new note from the earlier note.
- **Restore full notebook** replaces all current notes and preferences.

JotKeep saves the current notebook before each restore. Thus, you can reverse
a restore operation.

JotKeep rejects an incomplete or damaged restore point. This rejection does
not change the current notebook.

### History retention

JotKeep keeps these automatic restore points:

- One restore point for each hour in the most recent 24 hours
- One restore point for each day in the next 30 days
- One restore point for each week in the next 12 weeks
- Recent restore points that occur before restores and note deletions

JotKeep limits browser history to 25 MiB. It removes the oldest restore points
when this limit is necessary.

## Understand the status bar

### Local status

- **Local: Saving…** means that a browser save is in progress.
- **Local: Saved** means that IndexedDB contains the current notebook.
- **Storage full** means that the browser cannot save more data.
- **Storage unavailable** means that JotKeep cannot use IndexedDB.
- **Changed in another tab** means that another JotKeep tab changed the data.

If a save fails, keep the tab open. Make an external backup as soon as
possible.

### Safety File status

- **Waiting for local save** means that JotKeep must complete the browser save.
- **Backing up…** means that JotKeep is writing the Safety File.
- **Backed up** means that JotKeep wrote and verified the Safety File.
- **Permission needed** means that JotKeep cannot access the file.
- **File unavailable** means that the file moved, changed name, or was deleted.
- **Changed outside JotKeep** means that the external file is different.
- **Backup failed; local copy is safe** means that the external write failed.

## Keep browser data

1. Select **File → Keep data on this device**.
2. Give permission when the browser asks for it.
3. Read the storage status at the bottom of the editor.

Persistent browser storage decreases automatic removal risk. It does not make
an external backup.

## Use JotKeep offline

Open JotKeep online one time. The service worker stores the application files
for later offline use.

Use the browser install command to install JotKeep as an application. Browser
support and command names can differ.

Select **Update ready — refresh** when JotKeep shows this button.

## Change the theme

Select the theme button in the title bar. Each selection changes the mode in
this sequence:

1. System theme
2. Light theme
3. Dark theme

You can also select a mode directly in **View → Appearance…**. System mode
follows the operating-system or browser color preference.

## Change the editor appearance

Select **View → Appearance…**. You can select these properties for the note
body:

- Newsreader, system sans-serif, or system monospace font
- Font size
- Regular or semibold weight
- Normal or italic style
- Line spacing

Changes apply to every note and stay in this browser after a reload. They do
not change note text, text-file downloads, JSON backups, Safety Files, or note
timestamps. Select **Reset to defaults** to restore the original appearance.

Use **View → Word wrap** to let long lines fit the editor width or to keep each
line on one horizontal row. Printed output always wraps to the paper width.

Use **View → Status bar** to hide or show routine save, backup, count, and
storage information. JotKeep shows the bar temporarily if a local save or
storage operation fails.

## Use fullscreen mode

Select the fullscreen button in the title bar or **View → Enter fullscreen**.
The browser must permit the request. Select the visible exit button or press
`Escape` to leave fullscreen. The browser controls `F11` separately.

## Use the command palette

Select **Commands** or press `Ctrl/Command + /`. Type one or more words to
search file, edit, insert, view, backup, history, and storage actions. Use the
arrow keys to select a command and press `Enter` to run it. Press `Escape` to
close the palette. Commands that remove data still open their normal
confirmation window.

## Print or save a note as PDF

1. Open the note.
2. Select **File → Print note…** or press `Ctrl/Command + P`.
3. Select a printer, or select the browser's **Save as PDF** destination.
4. Complete the browser print operation.

The print view contains the complete title and body. It does not contain the
notes panel, menus, toolbar, status bar, or other application controls. It uses
the selected editor typography, always wraps long lines, and prints black text
on white paper. Browser print settings control optional page headers and
footers.

## Clear all local data

> WARNING: This operation removes local notes, history, preferences, backup
> status, and the remembered Safety File connection.

1. Make and test an external backup.
2. Select **File → Clear all local data…**.
3. Read the number of notes that JotKeep will remove.
4. Select **Clear all data**.

This operation does not change external Safety Files or downloaded files.

## Keyboard shortcuts

Use `Ctrl` on Windows and Linux. Use `Command` on macOS.

| Operation | Shortcut |
| --- | --- |
| New note | `Ctrl/Command + N` |
| Open a text file | `Ctrl/Command + O` |
| Download the active note | `Ctrl/Command + S` |
| Print the active note | `Ctrl/Command + P` |
| Open the command palette | `Ctrl/Command + /` |
| Find | `Ctrl/Command + F` |
| Find and replace | `Ctrl/Command + H` |
| Undo | `Ctrl/Command + Z` |
| Redo | `Ctrl/Command + Shift + Z` |
| Select all | `Ctrl/Command + A` |
| Close a window or menu | `Escape` |

Use the fullscreen button or command palette to enter fullscreen. `Escape`
exits it. JotKeep does not override the browser's `F11` behavior.

## File limits

- A text file can be a maximum of 5 MiB.
- A JSON backup can be a maximum of 25 MiB.
- The current Safety File notebook can be a maximum of 25 MiB.
- Safety File history can be a maximum of 25 MiB.
- A version 2 Safety File can be a maximum of 50 MiB.

## Important recovery rule

Use more than one backup location for important notes. Test your backups at
regular intervals.

Local history helps you correct mistakes. An external backup protects you
when the browser removes local data.

---

This guide applies the writing principles in
[ASD-STE100 Issue 9](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf).
