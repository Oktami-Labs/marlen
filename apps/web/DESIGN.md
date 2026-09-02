# Marlen design rules

Borderless neutral minimalism: a document, not a dashboard. Structure comes
from space and surface tone, never from lines. Color is scarce and means something.

Binding. To break a rule, change it here first. When a rule names an export, use
it. Named helpers keep the effect consistent across call sites.

## The three hard constraints

1. **No borders, outlines, or strokes at rest.** No `border`, no `divide-*`, no
   outlined buttons, no hairline dividers. Separation is tone and whitespace.
   Five exceptions, and nothing else: the `:focus-visible` ring; `border-border`
   as a divider *inside* dense content (thread rails, markdown tables/blockquotes/
   hr, an expanded row's meta); `CardShell`, so agent work products read as
   discrete blocks on the white chat rail; `.surface-pop`, because a
   scrimless panel over same-tone content has no other edge; and `.field-paper`,
   the draft's own fields, which must stay bare paper and so can only say "type
   here" with a writing line under them. Always the plain hairline, never with
   an opacity modifier.
2. **No card-in-card.** A surface is never nested in a surface. Group with a
   heading and whitespace. One elevated panel holds plain rows, not more panels.
3. **No drop shadows.** Nothing casts a blur, at rest or floating. Elevation is
   tone: the `.scrim` backdrop, and `.surface-pop`'s brighter dark-mode tone. The
   `--shadow-*` tokens are nulled in `index.css` so a stray utility renders
   nothing. Only the `:focus-visible` ring uses `box-shadow`, at zero blur.

## Component conventions

Reach for these before writing markup. A new primitive earns its place at two
clean call sites; when you add one, add it to this list.

- **Buttons:** `default` = accent fill (the CTA); `secondary`/`ghost` = tonal
  fills; `outline` is a tonal fill too, despite the name. Compact icon actions
  use `icon-sm`/`icon-xs`. Never hand-roll `h-8 w-8` or restate ghost colors.
  Destructive row actions are `ghost-danger` + `Trash2`, one action one icon,
  whether the row is deleted or only moved to a terminal status. `X` is the
  non-destructive counterpart (close, clear) and stays `ghost`.
- **Spinners:** the shared `Spinner`. A busy button takes `loading` (which
  disables it and swaps its icon). Never use a raw `Loader2` or a spin-class ternary.
- **Inputs / textareas / selects:** filled `surface-2`, no border; focus lightens
  the fill and adds the ring. `.field-paper` is the single exception (see
  **Draft as a letter**).
- **Badges:** pill, pastel tonal fill, no border.
- **Account dots:** `AccountDot` (`ui/account-dot.tsx`) for every round dot marker.
  Never hand-mix a dot fill or repeat `UNASSIGNED_ACCOUNT_COLOR`.
- **Person marks:** `AvatarMark` (`ui/avatar-mark.tsx`), the round initials mark
  standing for a person on a message, a draft row, or a card header. Its tone is
  the item's type color, never a per-sender color: mail stays as neutral as the
  rest of the app.
- **Mail header:** `MessageHeader` + `RecipientLine` (`components/MessageHeader.tsx`).
  Every email surface opens the same way: the counterpart's avatar and name, the
  recipient lines under it, the timestamp on the right. Addresses are read as
  people (`lib/addresses.ts`) and the raw list stays in the tooltip; the account's
  own address reads as "me".
- **Draft as a letter:** a draft sets its mail headers over a hairline and its
  prose below, on the bare surface, in the chat card and on the reading screen
  alike (`features/drafts/DraftReader.tsx`, which replaces the Home agenda while
  `?draft=<accountId>:<draftId>` is set). Its subject and body are `.field-paper`:
  no fill and no box, just the paper, with a writing line that surfaces under
  the text on hover and turns accent while the caret is in it. A fill or a box
  would stop the letter reading as a letter; the line alone still says which
  parts you type in. Every other control in the app stays a filled `surface-2`
  field. An approval row never edits in place; it opens the letter.
- **App logos:** `AppIcon` with a mail-glyph fallback.
- **Received message body:** `EmailBody` (`components/EmailBody.tsx`). It renders the
  sender's own HTML in a sandboxed frame that sizes itself to its content,
  blocks remote images until the reader asks, and collapses quoted history.
  Provider HTML reaches the screen this way and no other: it is never markup
  in the app document.
- **Agent cards vs chips:** a card (`CardShell`) is a work product of the turn.
  A note *about* the turn (what the agent saved to the wiki) is a chip instead:
  one recessed `rounded-xl` row, mono overline, text, one action. Never give a
  chip a card's outline, and never make a work product a chip.
- **Chat reading column:** `.thread-column`. Everything that lines up in the
  thread (transcript, queued messages, composer, version line) carries it; the
  width itself is `--thread-max-width`, set once by `.thread-page` on the chat
  root and unset in the side panel, where the thread runs full bleed. Never
  restate a `max-w-*` ladder at a thread call site.
- **Agent avatar:** `AgentAvatar` (`features/chat/AgentAvatar.tsx`). This is the
  assistant's round mark chip fronting assistant turns and the empty chat;
  `active` breathes its bloom while the turn is live. It sits above the turn's
  prose, which is a plain full-width block: only the user's message is a bubble.
- **Icon tiles:** `IconChip`, the tinted square fronting palette rows and
  typed list rows; it sizes the icon. Never on a section title.
- **Section titles:** `SectionTitle` (`ui/section-header.tsx`) for every
  top-level page section: plain text, with the section's meta and icon
  actions in the trailing slot; `SectionHeader`/`Section` for settings/setup
  pages.
- **Headers:** page and settings-section headers contain only the title plus
  relevant status or actions. Do not add a subtitle or description line. Put
  necessary guidance beside the control or state it explains.
- **Group labels:** `GroupLabel`, the uppercase muted overline over a group of
  rows; `sm` for dense meta lists. Its `count` shows from two rows up: a one
  over one visible row says nothing.
- **Settings rows:** `SettingRow`, with label and description left and control right. Use `bare`
  inside a raised card, `ListRow`-raised otherwise. A related group is one card
  of bare rows, never a card per row. Below the row's container breakpoint, the
  control moves under the copy instead of squeezing it. Separate settings never
  share a horizontal row, even when the canvas is wide. Settings auto-save;
  secrets save on Enter/blur. The Pipedream credentials form is the one verify exception.
- **Settings navigation:** four or more distinct settings jobs use a URL-backed
  left rail. Below the rail breakpoint, replace it with one compact category
  selector. Setup links open the relevant category; switching categories must
  survive reload and browser back/forward.
- **Menu/picker rows:** `OptionRow`, with a leading mark, truncated label, optional
  detail and trailing slot.
- **Scrollable pickers:** `ScrollEdges`, which keeps the native scrollbar and adds
  a tonal fade only at an edge with more content.
- **Row actions:** `HoverActions` (always visible below `sm`); external links use
  `OpenExternalButton`.
- **Filter chips:** `Chip`, with ink fill when active and `surface-2` otherwise.
- **Search filters:** `SearchField` for every list filter box.
- **Show more/less:** `DisclosureToggle` (omit `open` for a one-way reveal);
  `ExpandButton` for a row's trailing chevron; paged lists use `usePagedVisible`
  + `ShowMoreButton`.
- **Notices:** `Notice` (`ui/feedback.tsx`) for inline status. No hand-rolled
  tint containers.
- **Empty states:** `EmptyState`.
- **Step marks:** `StepCircle`. **Keyboard hints:** `Kbd`.
- **Draft rows:** `SentRow`, `RefineInChatButton`, `EditSaveActions`
  (`components/draftActions.tsx`) provide the shared parts of an approve/send row.
- **Icon verbs:** `.icon-send`/`.icon-discard`/`.icon-refine` move a glyph in its
  verb's direction on hover. Transform only, so hover never reflows.
- **Lists:** rows separated by spacing or a hover fill, never a divider. A long
  chat runs under centered day headings (`text-2xs` uppercase, no rule).
- **Panel controls** are icon buttons in the panel header, never control rows in
  the content area. No suggestion/template chips.
- **Form actions** are right-aligned, primary rightmost.

## Surfaces

The canvas is true grey in both themes, so raised things lift and recessed things
sink. Standalone rises, tucked-inside sinks. That alternation is the whole model.

| Token | Role | Use for |
| --- | --- | --- |
| `surface` | **Raised** (white / lighter dark panel) | Anything standing on its own: a feed row, an empty state, a grouped block, an agent card |
| `background` | The canvas | Page body, main column, chat column |
| `surface-2` / `muted` | **Recessed** | Inputs, chips, hover fills, code blocks, anything inside a raised surface |

Never stack `surface` on `surface`. Sibling rows on the canvas each rise; rows
*inside* a grouped card stay bare. Raised holds recessed holds raised is the max
depth. A Home section is one raised panel holding plain rows with their group
labels inside (`surface-hover` on the row), never a card per row: five cards
under five overlines is what makes a short list read as clutter.

A neutral control's fill is relative to what is behind it, and this is automatic
via derived variables (`--surface-2-fill`, `--secondary-fill`). Use
`bg-surface-2`/`bg-secondary`/`.field`/`.tint-neutral`. Never hand-pick a grey to
make a control read; if contrast is short, fix the fill variables in `index.css`.

Anchored floating panels (select menus, color picker) use `.surface-pop`, not
`.surface`. Dialogs keep `.surface`; the scrim separates them.

The cursor tooltip is the exception to both: no scrim, no border, so it carries
its own `.tooltip-chip` tone, a fill far enough from white panels and the grey
canvas to read over either.

## Color

- **Neutrals are true grey**, chroma 0, never tinted toward the accent.
- **Slate-violet is the single accent.** The CTA and the user's chat bubble are
  filled with it (the bubble face is the `.bubble-accent` gradient). Beyond that it marks only the logo, the nav rail's active item
  and hover tint, links, the switch's on-state, matched search text, and the
  focus ring. Never wash a panel or page in it.
- **Ink** (`--primary`) is the selected/pressed tone: the active `Chip`, the
  skip-link. Not a CTA fill.
- **Type tints on icon chips**, one tone per type, chip only, never the row
  background: accent = email draft, emerald = outbound message, amber =
  needs-attention, neutral = schedule/log/to-dos. Urgency reads from the rows
  and their group label, never from a section title, and it is said once: an
  urgent tier heading is not repeated as a badge or a triangle on its rows.
- **Semantic colors are muted pastels**, status only: emerald = success, amber =
  attention/paused, red = destructive/error. One token per colour is both the
  tint fill and the text on it (`.tint-*`), so each is set dark enough to clear
  4.5:1 on its own wash. Never wash a row background in one: the tint belongs on
  the icon chip or the `Badge`.
- Body text is cool charcoal (`foreground`), never pure black; secondary is
  `muted-foreground`. Both clear 4.5:1 on every ground they meet, canvas and
  recessed fills included, not only on white.

## Type

- **Geist Sans** for UI, **Geist Mono** for schedules, model ids, codes, and
  the work log's time gutter (plus `tabular-nums`). A date or count on an
  ordinary row stays in the sans, `tabular-nums`: mono on every row is a
  second texture the page does not need.
- Hierarchy is weight and color, not size jumps. Section titles are
  `text-sm font-semibold`, descriptions `text-xs`/`text-sm text-muted-foreground`.
- The ladder is `text-3xs` (10, tiny marks), `text-2xs` (11, meta/overline),
  `text-xs`, `text-sm`, `text-base`. There is no 13px step. Resolve to `text-xs`
  or `text-sm`. Never write an arbitrary `text-[13px]`.
- Tighten tracking on headings (`tracking-tight`).

## Shape

Radius `--radius` (0.7rem) for panels/inputs/buttons, smaller for chips. No
`rounded-full` on primary buttons or in-flow containers. Pills are for status
badges, filter chips, and tiny marks.

## Motion

- Content rises `6px` and fades over ~360ms. Animate only `transform`/`opacity`.
  One exception: `.stream-word`, where a newly generated word also lands in the
  accent and settles into ink over its fade. Colour, on a span, with no layout
  effect; nothing else animates a paint property.
- **One easing curve**: `cubic-bezier(0.22, 1, 0.36, 1)`. Don't invent new ones.
- **Every animation needs a `prefers-reduced-motion` entry** in `index.css`'s
  reduce block. No exceptions.
- **List entrance:** `stagger(i)` (`lib/utils.ts`). It caps the delay so a long
  list still finishes inside the budget. Never hand-write `animationDelay`.
- **A list never snaps.** Rows that leave or move ride `withViewTransition` +
  `rowTransition(id)` (`lib/utils.ts`) so the list closes its own gaps.
  `rowTransition(id)` names the row; `withViewTransition` wraps the
  **synchronous** write. An `invalidateQueries` refetch lands too late to
  animate, so a row that must leave sets local state and lets the refetch
  reconcile behind it. A row reaching a **terminal state keeps its name**: the
  sent line carries the same `rowTransition(id)` as the live row, so sending
  morphs in place while discarding lets it go. The one outward, irreversible
  action must not read like a discard.
- **Expanding in place is a morph.** A row's open/edit toggle is a synchronous
  write wrapped in `withViewTransition`; the row (named via `rowTransition(id)`)
  grows to its new height and its siblings slide, never snap.
- **In-flight labels shimmer.** The thinking line and a running tool's name use
  `.text-shimmer`, a sweeping text highlight. Never use `animate-pulse`.
- **The agent's presence is ambient.** While a chat turn is live, the chat panel
  sets `data-agent-busy` on `<html>` and the aurora breathes toward full
  strength. Nothing else keys off this attribute, and no other surface gets a
  busy tint.
- **Route motion:** panel switches run through `withViewTransition` too (the
  sidebar `<Link>` and `select()` in `App.tsx`). `BrowserRouter` is not a data
  router, so react-router's `viewTransition` prop does nothing. Drive it from
  the helper. Leave modified clicks (cmd/ctrl/shift/alt) to the browser. One
  duration for every group is what keeps a leaving row from outliving its canvas.

## State, loading, and failure

The UI is a function of live state, never of a page load. If seeing the new truth
needs a refresh, a remount, or reopening a panel, the wiring is wrong.

- Server data lives in TanStack Query, invalidated by its SSE topic; view state
  lives in React state or the URL. A key's first element is its topic.
- **Mutations reflect immediately.** The handler that writes also updates or
  invalidates the cache, so the row appears, changes, or leaves right away.
- **Loading:** `LoadingSweep` (`ui/feedback.tsx`) adds one delayed accent strip on
  the canvas edge. Never a per-panel spinner for a refetch; a busy *control*
  takes `loading`. Refetches keep previous data on screen, never a blank flash.
- **Failure has one policy per shape, and silence is not one of them:**
  - A failed **panel fetch** renders `RetryableError` (`ui/feedback.tsx`).
  - A failed **user-initiated mutation** toasts.
  - An **inline form** shows its error in the form.
  - Never swallow a fetch whose result is a **baseline for a later write**. A
    write merged into an empty set silently destroys what it should have merged
    with. Refuse the write instead.
  - An **armed confirm dialog closes only on success.** Report the outcome from
    the persist call; a dialog that closes on failure claims work it didn't do.
- Sibling loaders in one file get the same policy. Two policies for one endpoint
  is a bug.

## Layers

Floating things stack in a fixed order. Pick the existing rung, don't invent one.

| z | Layer |
| --- | --- |
| `z-10`/`z-20` | Sticky headers and overlays inside a panel |
| `z-40` | Chrome scrim, splitter |
| `z-50` | App chrome (sidebar drawer), anchored panels (select, date picker) |
| `z-[110]` | Modal scrim |
| `z-[120]` | Modal panel (dialog, palette) |
| `z-[130]` | Anchored panel opened above a modal |
| `z-[140]` | Toasts (overrides sonner's own z-index) |
| `z-[150]` | Cursor tooltip, the top rung; non-interactive, so nothing may sit above it |

Everything modal shares the `.scrim` backdrop: a light dim plus a **2px** blur.
The page stays readable through it, never frosted. Zones inside a floating panel
separate by tone, never by line (the palette footer is a recessed fill). Matched
text uses the same pale accent tint as `::selection`, so "found" and "selected"
read as one idea.

## Layout

- Lead with macro-whitespace; sections separate by `gap-8`/`gap-10`, not rules.
- Content columns are constrained according to the job. Settings uses a
  leading-aligned `max-w-7xl` workspace because its chat panel starts closed;
  its rail stays at the leading edge and its content remains one vertical
  reading column at every width. Other pages start at `max-w-3xl` and relax to
  `max-w-6xl` on large canvases. Home can reach `max-w-7xl`. The canvas decides,
  not the viewport, since the sidebar and chat panel eat variable width. Home is the one
  two-column page (what waits on you, what the agent does itself): it steps up
  from `@3xl` instead, so the second column appears as soon as the canvas can
  hold two rows rather than only on a wide display. The agenda is one time
  axis: Missed, the days ahead, Anytime. Every kind of item sits on it, a
  draft awaiting approval under the day it was drafted; never a group per
  kind, which would wedge a second axis into the first.
- Chrome frames the canvas: the nav rail, chat column, and the frame behind the
  working canvas are `sidebar`. On desktop the grey canvas is inset and rounded
  (`rounded-2xl`); on mobile it runs edge to edge.
- Three columns need room: the chat panel docks from `lg` and is a drawer below
  it, and the header's controls size against the canvas (`@container` on `main`),
  never the window.
- **A row yields its actions, never its content.** A list row is `flex-wrap`:
  its title takes `basis-full` and the trailing actions fall to their own line
  once the column is under `@md`. Truncating the subject to keep five icons on
  one line is the bug this prevents.
- Scrollbars are thin, trackless, rounded; `scrollbar-gutter: stable` wherever a
  list can grow.

## File size

`pnpm check` caps source files at 800 lines. Split by concern, in this order: the
row component, the form dialog, the data hook, then presentational helpers. A
panel that is a list plus a form is two files.
