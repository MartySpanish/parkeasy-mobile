# Partner tiers (F3)

| Tier | Price | What it buys |
|---|---|---|
| `listed` | Free | Name and pin. **No card.** |
| `featured` | £25/mo | Card with logo, tagline, photo and link. |
| `sponsored` | £60/mo | Featured, plus sorts first inside `radius_m`, plus the booking-confirmation slot. |

Rules live in `src/partnerTiers.js` — three places have to agree about them (the
card query, the sort, and the admin screen), and a tier that renders in one and
not another is a partner ringing about a card they can't see.

**An unknown tier renders nothing.** The opposite default means a typo, or a
tier added to the database before the app knows about it, hands out a £25
placement for free.

## Setup

Create two recurring products in Stripe and put their price IDs in Vercel:

```
STRIPE_PRICE_PARTNER_FEATURED    £25/month
STRIPE_PRICE_PARTNER_SPONSORED   £60/month
```

Price IDs are never in source (wrong in test mode, wrong after a price change)
and never taken from the request body (anybody could buy a £60 card for
whatever they sent).

## Selling one

Admin dashboard → **Partners** → *Sell Featured/Sponsored*. The link is
**copied**, not opened — opening it starts you paying for their card yourself.

The tier travels in the subscription's metadata, not inferred from the price ID:
a price can be duplicated in the Stripe dashboard, and a partner quietly
dropping from sponsored to featured because of it is a bug nobody finds until
the partner does.

## The subscription lifecycle

| Event | What happens |
|---|---|
| `checkout.session.completed` | Records `stripe_subscription_id` — **the only moment it exists**, since subscription mode creates it at payment |
| `invoice.paid` | Sets tier, `renewal_due_at`, clears the failure clock. `sold_at` written once and never again |
| `invoice.payment_failed` | Starts a 7-day clock. Tier drops to `listed` only after it elapses |
| `customer.subscription.deleted` | Tier → `listed`. **The row stays** — the pin and impression history are worth keeping |

A card expiring on a Tuesday is not a cancellation. The clock starts on the
first failure and is deliberately *not* reset by retries — resetting it means
the window never elapses and the tier never drops.

## Grandfathering

Eleven partners were live with `tier` null. A default of `listed` would have
pulled every card on deploy. `20260907_partner_tiers.sql` sets them to
`featured` explicitly and **raises** if any active partner comes out without a
card. New partners default to `listed`.

The column previously meant `local | town | county | event | founding` — reach
pricing, never populated. If that comes back it belongs beside `radius_m`.

## The stats

`partner_stats()` — every partner, `service_role` only (the whole book of
business). Reached through `POST /api/admin {action:'partner-stats'}`.

`partner_stats_for_token()` — one partner, anon-readable, at
`/api/partners/stats?token=…`. The audience is a barber with a phone being asked
to keep paying £25; making him create an account is how that conversation stops.
The token reaches one function returning a name and two counts. If one leaks,
rotate that partner's `stats_token`.

**LEFT join, not inner.** A partner with no impressions is exactly the one worth
looking at; an inner join hides them.
