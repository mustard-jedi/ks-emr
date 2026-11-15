# Theming KS EMR

How the look of KS EMR is put together, and how to add a new theme.

## How it works

- The whole app is styled by one base stylesheet, `web/src/styles.css`. It holds layout and structure only. Every colour, the font and a few shapes are read from CSS custom properties, called **tokens** here.
- A **theme** is a block of token values selected by an attribute on the page: `<html data-theme="modern-dark">`.
- The default token values in `styles.css` are the `classic` theme. Other themes live in `web/src/themes.css`.
- `web/src/theme.ts` lists the themes the app offers and sets the attribute.
- Each person's choice is stored on their account (`users.theme`) and changed with `PATCH /api/me {"theme": "<id>"}`. The server accepts any id made of lowercase letters, digits and dashes, so a new theme needs no server change.

| Stored choice | What is shown |
|---|---|
| `auto` (default for new accounts) | `modern-light`, or `modern-dark` when the device is in dark mode |
| `classic`, `modern-light`, `modern-dark` | That theme |
| An id the app does not know | Same as `auto` |

The **Theme** button in the menu bar is a quick switch between `modern-light` and `modern-dark`. The full list is under **Account**.

## Add a theme in three steps

### 1. Add a token block to `web/src/themes.css`

Copy the `modern-light` block (or `modern-dark` for a dark theme), rename the selector, and change the values:

```css
[data-theme="forest"] {
  color-scheme: light;
  --desk: #dfe8df;
  --paper: #ffffff;
  --ink: #1b2a1f;
  --title: #1f5a3a;
  /* ...every other token from the block you copied... */
}
```

Set every token. A token you leave out falls back to the classic value, which rarely fits.

Use the selector exactly as shown: `[data-theme="id"]`, without `:root` or `html` in front. The theme picker previews a theme by putting that attribute on a small element inside the dialog, so the selector must match any element.

### 2. Register it in `web/src/theme.ts`

```ts
{ id: 'forest', label: 'Forest', description: 'Green and calm.', scheme: 'light' },
```

- `scheme` is `light` or `dark`. The quick switch in the menu bar uses it to decide what its label says.
- A dark theme should also name a light theme to print with: `printAs: 'modern-light'`. Printing the Face Sheet on a dark background wastes ink.

### 3. Build and check

```bash
npm run build
```

Open **Account**, pick the theme, then walk through the checklist at the end of this page.

## Getting the modern shapes

Tokens change colours and type. Shapes (rounded corners, flat buttons, larger touch targets, pill-shaped status labels) are a short set of rules at the bottom of `themes.css`, written for every theme whose id starts with `modern`:

```css
[data-theme^="modern"] .btn { border-radius: 8px; box-shadow: none; ... }
```

- Name a theme `modern-<something>` (for example `modern-forest`) and it gets those shapes for free. This is the easy route for a new colour scheme.
- Any other id starts from the classic shapes (bevels, square corners). Add your own shape rules under `[data-theme="your-id"]` if you want something else.

Keep shape rules few. If you find yourself restyling most of the app, the base stylesheet probably needs a new token instead.

## Token reference

### Surfaces and text

| Token | Used for |
|---|---|
| `--font`, `--font-size` | Typeface and base size |
| `--desk`, `--desk-ink` | Background behind the binder, and text placed directly on it |
| `--face` | Window chrome, table headers, section headings (classic) |
| `--paper` | The page, inputs, dialogs (modern) |
| `--ink`, `--muted`, `--label`, `--struck` | Main text, secondary text, field labels in stacked cards, struck-out entries |
| `--line`, `--line-soft` | Strong borders; table cell and box borders |
| `--bevel-light`, `--bevel-dark` | 3-D edges on classic buttons. Set both to `transparent` for a flat theme |

### Accent

| Token | Used for |
|---|---|
| `--title`, `--on-title` | Title bar (classic), main button (modern), logo; and the text on it |
| `--link` | Links |
| `--hover-bg`, `--hover-ink` | Table row under the pointer |

### Meaning

| Token | Used for |
|---|---|
| `--red`, `--green` | Error and success text, alert borders |
| `--note-bg` | Notices, totals, secrets shown once |
| `--alert-bg` | Allergy box, strike-out box |
| `--box-bg` | Face Sheet boxes, chart frame |
| `--note-paper` | A note on the Notes tab |
| `--code-bg` | Code and token boxes |
| `--disabled-bg`, `--disabled-ink` | Read-only inputs |
| `--ok-bg` | Given dose, normal lab result |
| `--due-bg` | Due dose |
| `--bad-bg` | Missed or refused dose, abnormal lab result |
| `--overdue-bg`, `--overdue-row` | Overdue label and its table row |

### The binder tabs

| Token | Used for |
|---|---|
| `--t0` to `--t6` | The seven tabs, in order: Face Sheet, History, Meds, Vitals, Labs, Notes, Visits & Docs |
| `--tab-ink` | Text on a tab |

The page behind the tabs takes the active tab's colour along its top edge. Keep the seven colours clearly different from each other, in lightness as well as hue, and light enough for `--tab-ink` to read on them. The built-in themes keep the tabs pastel even in the dark theme, with dark text.

### Charts

| Token | Used for |
|---|---|
| `--chart-plot` | Plot background |
| `--chart-grid` | Grid lines |
| `--chart-range` | Shaded normal range on lab charts |
| `--chart-select` | Selected column on the observation chart, and its row in the table |
| `--series-0` to `--series-2` | Line colours. On the observation chart `--series-1` is pulse and `--series-0` is respiration; temperature and blood pressure use `--ink`, pain uses `--muted` |

### Shapes

| Token | Used for |
|---|---|
| `--overlay` | Backdrop behind a dialog (any CSS `background` value) |
| `--close-glyph` | The character on a dialog's close button |
| `color-scheme` | Not a token but a CSS property: set it to `light` or `dark` so the browser's own controls (date pickers, scroll bars) match |

## Rules for new code

- Never write a colour in a component or in `styles.css` rules. Use a token. If none fits, add a token to the classic block in `styles.css`, give it a value in every theme, and add it to the tables above.
- SVG drawn in React takes colours through `style`, for example `style={{ fill: 'var(--chart-plot)' }}`.
- Keep text contrast at 4.5:1 or better against its background (3:1 for large headings).

## Checklist for a new theme

- [ ] Sign-in screen
- [ ] Face Sheet, including the red Alerts & Allergies box
- [ ] Meds: a due dose, a given dose, an overdue dose; the Given / Missed / Refused / Held buttons
- [ ] Vitals observation chart: all five marks, the selected column, the hover text; Labs chart with the shaded normal range and a High flag
- [ ] A form dialog (add a prescription): labels, inputs, date picker, disabled fields
- [ ] Share dialog: the yellow "copy this now" box
- [ ] An entry struck out as entered in error, with Show struck-out ticked
- [ ] Phone width (stacked cards) and desktop width (tables, row hover)
- [ ] Print the Face Sheet
- [ ] All seven tabs readable, and the active tab's colour on the page edge
