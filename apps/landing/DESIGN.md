# VContext Landing Design System

This document is the source of truth for the visual and interaction design of
`apps/landing`. Read it before changing layout, styling, motion, content
hierarchy, or reusable UI components.

If an intentional change alters a rule below, update this document in the same
change. Do not introduce one-off colors, spacing values, or component patterns
without first deciding whether they belong in the system.

## Product direction

VContext is presented as **Git for AI context**: a local-first, versioned
context layer shared by CLI and MCP-compatible agents.

The landing should feel:

- Technical, editorial, and developer-focused.
- Precise rather than playful.
- High-contrast, spacious, and easy to scan.
- Code-native without looking like a generic terminal theme.
- Local-first, with Cloud clearly framed as an optional collaboration layer.

Never add fabricated customers, testimonials, usage metrics, security
certifications, or product limits.

## Visual principles

1. **Editorial scale:** use large condensed headlines and compact monospaced
   labels to create hierarchy.
2. **Visible structure:** thin borders, grids, numbered modules, and aligned
   columns should make the page feel versioned and inspectable.
3. **Generous breathing room:** content must never sit against the viewport
   edge. Use the shared page shell instead of local horizontal padding.
4. **Blue means VContext:** brand blue highlights product identity, primary
   actions, active states, and selected text.
5. **Color has meaning:** green is reserved for successful or connected states;
   yellow and red are reserved for warning and error semantics.
6. **Square, not soft:** prefer sharp corners and restrained geometry. Avoid
   pill-heavy or excessively rounded interfaces.
7. **Real product language:** terminal and Cloud mockups should use plausible
   VContext commands, branches, snapshots, and project concepts.

## Color system

The palette is derived from the
[Flat UI Colors Canadian Palette](https://flatuicolors.com/palette/ca).
Use the CSS custom properties in `src/globals.css`; do not duplicate raw hex
values in components.

| Token            | Value     | Use                                                                     |
| ---------------- | --------- | ----------------------------------------------------------------------- |
| `--brand`        | `#54a0ff` | Primary VContext color, key text, actions, focus and structural accents |
| `--brand-deep`   | `#2e86de` | Hover states and darker brand text on light surfaces                    |
| `--brand-cyan`   | `#48dbfb` | Optional secondary data or diagram accent                               |
| `--brand-teal`   | `#00d2d3` | Optional tertiary technical accent                                      |
| `--brand-purple` | `#5f27cd` | Rare secondary category accent; never a competing primary               |
| `--brand-mist`   | `#c8d6e5` | Cool tinted surfaces and quiet graphic backgrounds                      |
| `--brand-slate`  | `#576574` | Muted text                                                              |
| `--brand-ink`    | `#222f3e` | Primary dark text and dark surfaces                                     |
| `--success`      | `#1dd1a1` | Connected, synced, ready, or successful status only                     |
| `--warning`      | `#feca57` | Warning state only                                                      |
| `--danger`       | `#ff6b6b` | Error or destructive state only                                         |
| `--paper`        | `#f4f7fb` | Primary page background                                                 |
| `--paper-deep`   | `#e7edf5` | Secondary light surface                                                 |
| `--white`        | `#fbfbf7` | High-contrast text and elevated light cards                             |

`--accent` and `--accent-deep` are compatibility aliases for `--brand` and
`--brand-deep`. New styles should prefer the semantic brand tokens directly.

### Color usage

- Use brand blue selectively. A section should have one obvious blue focal
  point, not blue on every label.
- On light surfaces, pair `--brand` with `--brand-ink`.
- On dark surfaces, `--brand` may be used for text, rules, cursors, or shadows.
- Use `--success` for real status indicators, not decoration.
- Preserve readable contrast; never use brand blue for small text on a similar
  blue or low-contrast tinted surface.

## Typography

Three system stacks are defined:

- `--display`: condensed editorial headlines and product statements.
- `--sans`: body copy, navigation, buttons, and UI labels.
- `--mono`: commands, metadata, numbering, state labels, and code.

Rules:

- Display headings are uppercase, tightly tracked, and use short line lengths.
- Hero size: `clamp(3.8rem, 10.2vw, 9.5rem)`.
- Section heading size: `clamp(2.8rem, 5.5vw, 5.5rem)`.
- Feature card heading size: `clamp(1.4rem, 1.9vw, 1.8rem)`.
- Body copy generally stays between `0.8rem` and `1.35rem`.
- Eyebrows use monospace, uppercase, small type, and generous letter spacing.
- Commands must stay monospace and should remain on one line with horizontal
  overflow handling where necessary.
- Do not make all text large. Scale is reserved for the hero and section
  statements; supporting copy stays compact.

## Layout and spacing

All horizontally constrained content uses `.page-shell`.

```css
--page-gutter: clamp(2rem, 4vw, 4.5rem);
--page: min(calc(100% - (var(--page-gutter) * 2)), 1360px);
```

- Desktop content width is capped at `1360px`.
- Fluid page gutters range from `32px` to `72px`.
- Mobile gutters are `20px`.
- Full-bleed dark sections keep their background edge-to-edge and place a
  `.page-shell` inside.
- Standard section spacing is
  `padding-block: clamp(6rem, 11vw, 10rem)`.
- Prefer grid gaps and section-level spacing over margins on individual
  children.
- Align content to the same page-shell edges across the header, hero, sections,
  CTA, and footer.

### Responsive breakpoints

- `1100px`: complex two-column layouts stack; six-column grids reduce; pricing
  becomes two columns.
- `760px`: navigation hides, all primary content becomes one column, page
  gutters become `20px`, type scales down, and wide data rows simplify.

Do not add a new breakpoint unless existing layout behavior cannot express the
requirement.

## Component language

### Header

- Sticky, translucent paper surface with a thin bottom border.
- Wordmark left, primary navigation centered, **Open Cloud** right.
- Cloud always links to `https://app.vcontext.dev`.
- On mobile, keep the wordmark and Cloud CTA; hide the full navigation.

### Hero

- Lead with the one-line installer in the first viewport.
- Primary statement remains “Git for AI context.”
- Use brand blue on the word `context.` as the main color moment.
- The context graph should communicate multiple agents converging on one
  versioned repository.

### Install command

- Default to the Shell command.
- Keep the PowerShell alternative.
- Provide copy feedback through an `aria-live` region.
- Commands must remain:
  - `curl -fsSL https://vcontext.dev/install.sh | bash`
  - `irm https://vcontext.dev/install.ps1 | iex`

### Section headings

- Reuse `SectionHeading.astro`.
- Pair a small monospace eyebrow with one large editorial statement.
- Keep descriptions to one short paragraph.
- Cloud and Pricing eyebrows may use `--brand-deep`.

### Feature cards and integration tiles

- Use shared borders to create one continuous grid.
- Prefer numbered modules over decorative icons.
- Cards may lift slightly and reveal a brand-colored shadow on hover.
- Avoid isolated floating cards with unrelated radii or shadows.

### Terminal and Cloud mockups

- Use real-looking commands and data, but never imply live production metrics.
- Dark terminals use `--brand-ink` surfaces and brand blue accents.
- Cloud mockups use light surfaces, thin table rules, branches, snapshot IDs,
  and explicit sync status.

### Pricing

- Current public offer is Free at `$0 today`.
- State that pricing may evolve; never imply permanent free pricing.
- Do not invent storage, project, seat, or usage limits.

### Footer

- Preserve product, Cloud, and installer links.
- Preserve the `by veguidev` credit linking to `https://vegui.dev`.
- Keep the lower strip compact and monospaced.

## Motion

Motion is purposeful and concentrated in the initial hero:

- Use `cubic-bezier(0.22, 1, 0.36, 1)` for entrance motion.
- Hero elements enter in sequence: eyebrow, title, blue accent word, lede,
  installer, context graph.
- Entrance durations stay between `650ms` and `850ms`.
- Use translations between `24px` and `44px`; avoid dramatic zooms or spins.
- Hover motion is subtle: generally a `2px` button lift or a small card lift.
- Do not animate body copy continuously.
- Cursor blinking is acceptable inside terminal mockups.

Every animation must have a `prefers-reduced-motion: reduce` fallback. Hero
entrances must render immediately with animation disabled.

## Accessibility

- Preserve semantic `header`, `nav`, `main`, `section`, and `footer` landmarks.
- Every section using `aria-labelledby` must render the referenced heading ID.
- Keep the skip link and visible `:focus-visible` treatment.
- Interactive controls must be reachable and usable with a keyboard.
- External links opening a new tab use `target="_blank"` and
  `rel="noreferrer"`.
- Decorative imagery uses empty alt text; meaningful graphics need an
  accessible label.
- Do not communicate status using color alone.
- Check contrast whenever palette usage changes.

## Copy and content

- Public copy is English.
- Tone is direct, technical, concise, and confident.
- Prefer specific product nouns: context, branch, snapshot, project, CLI, MCP,
  sync, push, pull.
- Explain VContext as a shared context layer, not literal live
  model-to-model communication.
- Present the local product first and Cloud second.
- Avoid vague AI superlatives, hype, and generic SaaS language.

## Assets

- Use the existing VContext mark in `public/vcontext-iso.webp`.
- Keep `public/favicon.ico` and `public/og.png` aligned with the current brand.
- Avoid model-authored SVG illustrations. Build diagrams from HTML and CSS or
  use deliberate raster assets.
- If the brand palette or headline changes materially, review the Open Graph
  card for consistency.

## Validation

After a visual or component change:

1. Run `pnpm --filter landing build`.
2. Confirm `/`, `/install.sh`, and `/install.ps1` are generated.
3. Confirm the root installer files and generated installer routes stay
   identical.
4. Preserve keyboard focus, reduced-motion behavior, and responsive stacking.
5. Do not deploy unless the user explicitly asks.
