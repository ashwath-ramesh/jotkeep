# JotKeep design system

The values live in the token block at the top of `src/styles.css`. This
file records the intent behind them. Change the tokens only in ways that
keep these rules true.

## Identity

Quiet stationery. The light theme is a warm paper white (`#FBFAF7`) with
graphite ink (`#211E19`). The dark theme is the same object at night: the
graphite becomes the surface and the paper becomes the ink. Both themes are
defined together with the CSS `light-dark()` function, so every token has
its two values side by side.

## Typography

Three type families, with a fixed division of labor:

- **Writing is serif.** The note body, note title, and dialog titles use
  Newsreader (self-hosted, `fonts/`).
- **UI is grotesk.** Buttons, menus, inputs, and labels use the system
  sans-serif stack.
- **Receipts are mono.** Data the app reports — timestamps, word counts,
  save and backup status, file names, match counts, the sidebar footer —
  uses the monospace stack.

Do not mix these roles. A control never uses the serif; note text never
uses the sans-serif.

## Surfaces

Three steps, from content to chrome: `--surface` (page and editor),
`--panel` (toolbar and status bar), `--panel-deep` (sidebar and chips).
Borders are translucent ink (`--hairline`, `--line`, `--line-strong`), so
they work on every surface in both themes.

## The accent is rationed

The slate accent (`--accent`) marks **where the user is**, and nothing
else: the active-note bar, the caret, the text selection, form-control
accents, and the find match count. Buttons, links, icons, and headings do
not use it. Primary actions are solid ink (`--primary-btn-bg`), not
accent-colored.

## Semantic colors

Green (`--success`) only for confirmed persistence ("Saved", "Backed up").
Amber (`--warning`) only for states that need user attention. Red
(`--danger`) only for destructive actions and failures. Each has `-bg` and
`-border` companions for pills and cards.

## Accessibility floor

- All text, including `--quiet-ink`, must stay at or above a 4.5:1
  contrast ratio against every surface it appears on, in both themes. The
  quiet alphas (0.64 light, 0.52 dark) were chosen for this; do not lower
  them.
- Keyboard focus is always visible (`:focus-visible` outlines). The
  `forced-colors` and `prefers-reduced-motion` blocks at the end of the
  stylesheet must cover any new component.

## Shape and depth

Radii: 6 px controls, 10 px dialogs, full-round pills. Shadows exist only
on floating layers (menus, dialogs, the mobile drawer). Flat surfaces are
separated by borders, not elevation.

## Provenance

The visual direction comes from the "JotKeep 2027" design canvas (kept
outside the repository). The repository is the source of truth; if code
and canvas disagree, the tokens in `src/styles.css` win.
