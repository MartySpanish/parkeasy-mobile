# ParkEasy design system

Applied 4 August 2026. Rollback point: branch **`snapshot/pre-redesign-2026-08-04`**.

```bash
# put everything back exactly as it was
git checkout snapshot/pre-redesign-2026-08-04 -- src/ tailwind.config.js
npm run build
```

---

## Why this shape

ParkEasy is one 6,700-line `src/App.jsx` with roughly forty hand-rolled button
styles and font sizes typed as Tailwind arbitrary values (`text-[13.5px]`,
`p-3.5`). That is how a product ends up looking *assembled* rather than
designed — not through bad taste, but because nothing made the consistent
choice easier than the ad-hoc one.

So the system is built to make the right thing the easy thing:

- **Tokens are JS, not classes.** `text-[13.5px]` is exactly how drift happens.
  A value that must come from the scale should be impossible to type by hand.
- **Type has roles, not sizes.** Components ask for `role="h2"`, never `19px`,
  so changing the scale lands everywhere at once.
- **Colour defers to the existing CSS variables.** `--ink`, `--sheet`,
  `--hairline` are what make light mode work. Replacing them with hexes would
  have silently broken light mode across the whole app. Only brand and semantic
  colours — identical in both themes — are literal values.

## Files

```
src/theme/tokens.js               spacing, type, colour, radii, elevation, motion
src/components/ui/index.jsx       Text, Overline, Button, Card, Badge, SectionHeader,
                                  Spinner, Skeleton, SkeletonCard, Banner, EmptyState
src/components/home/CategoryGrid  category tiles (LIVE)
src/components/event/EventLanding scaffold — official-parking event page
src/components/host/index.jsx     scaffold — HostDashboard, AvailabilityCalendar,
                                  ListingWizard
src/index.css                     pe-spin / pe-shimmer keyframes, .pe-pressable
```

## The scales

| | |
|---|---|
| **Spacing** | strict 8pt. `space[2]`=8, `[3]`=12, `[4]`=16, `[5]`=24, `[6]`=32. `0.5` and `1` exist only for icon/label gaps. |
| **Type** | one family (Manrope), weights 400/600/700/800. Roles: `hero, h1, h2, h3, body, bodySm, label, overline, caption`. |
| **Radii** | `sm 8, md 12, lg 16, xl 20, xxl 24, pill`. |
| **Elevation** | four steps. A shadow not on the list is a shadow nobody chose. |
| **Motion** | press scale **0.985**, not 0.95 — a card that visibly shrinks feels like a toy. |
| **Tap target** | 44px floor. This app is used one-handed, in the rain, beside moving traffic. |

## What is live vs scaffolded

**Live now — the category grid.** It renders as the *landing state* of the
Search tab: the moment someone searches or filters, it disappears, because a
grid of other options on top of your own results is in the way.

It is **additive**. It sits above the existing list and replaces nothing, which
is why it was safe to ship during Fleadh week with two car parks taking money.

Every tile does real work — a category grid that scrolls you to the same
undifferentiated list is decoration:

| Tile | Action |
|---|---|
| Events & Games | opens the Fleadh event overlay |
| Airports | searches Belfast City Airport |
| Travel & Hotels | searches hotels |
| Nights & Weekends | filters to free spots |
| Daily & Commuting | filters to free-right-now |
| **Premium Hotspots** | upgrade flow, or the gems if already a member |

**"Monthly" is deliberately absent.** SpotHero sells monthly bays; ParkEasy
does not. The subscription buys access to founder-curated free spots and EV
picks. A "Monthly" tile would sell something we don't have.

**Scaffolded, not mounted:** `EventLanding`, `HostDashboard`,
`AvailabilityCalendar`, `ListingWizard`. Real components on the design system,
driven by props, no data layer. They replace nothing — the live host flow
(`ListSpaceForm`, `HostEarnings`, `EventPricingPanel`) and the live Fleadh
overlay keep running until these are wired deliberately. Wiring them is a
decision for a quiet week, not this one.

## Migrating the rest

Do it opportunistically, not as a big-bang rewrite. `App.jsx` is the live
booking path; a rewrite of it during trading is how you lose a Fleadh.

1. **When you touch a screen anyway**, swap its buttons for `<Button>` and its
   panels for `<Card>`. Both accept `style`, so they drop into existing layouts.
2. **Replace numbers with tokens as you go.** `p-3.5` → `padding: space[3]`.
   Do not sweep the file for these; the risk is not worth it.
3. **New screens use only the primitives.** No new arbitrary Tailwind values.
4. **Mount the scaffolds one at a time**, each behind its own PR, each verified
   in a browser before merge.

## House rules

- Money is always shown **all-in**. DMCCA 2024 s.230 applies wherever a price is
  shown to a consumer — including a price chip on a map pin.
- Errors must offer a way forward. `<Banner>` takes an `action` for exactly
  this; an error with no recovery is just bad news.
- Skeletons match the shape of what's coming. A placeholder of the wrong size
  makes the page jump when data lands.
- `prefers-reduced-motion` is honoured in `index.css`. Don't reintroduce
  animation that ignores it.

## Verified

Category grid: six tiles, all rendering at an identical 175×161, correct labels,
grid hides on filter, build clean. Screenshot-checked at 393×852.
