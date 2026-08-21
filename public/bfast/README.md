# BFAST partner assets

Cropped on 21 Aug 2026 from screenshots Marty sent, with BFAST's permission —
Adam at BFAST, over Instagram DM: *"Thanks for the support"*, and Marty's reply
naming exactly this: *"I'll be fine to grab the logo & a few products & then
link them to the website for people too."*

| File | Source | What it is |
|---|---|---|
| `logo.png` | @bfastofficial profile picture | The circle, cropped to its bounding box and the corners filled black, so the 28px tile on the card is a clean square rather than a circle on a blurred backdrop. |
| `1-champions.jpg` | @bfastofficial post, "The face of Irish Muay Thai" | Niall McGreevy and Garrett Smylie in BFAST tees. Leads the strip: it is the brand's own strongest image and it is the two world champions wearing the kit. |
| `2-birthday-cake-tee.jpg` | bfastofficial.com shop | £34.99 |
| `3-moon-rock-tee.jpg` | bfastofficial.com shop | £35.00 |
| `4-moon-rock-shorts.jpg` | bfastofficial.com shop | £44.99 |
| `5-birthday-cake-shorts.jpg` | bfastofficial.com shop | £44.99 |
| `6-shorts-detail.jpg` | @bfastofficial post, 28 May | Birthday Cake shorts worn, sledgehammer in hand. **Photograph by @darraghbarry309**, posted as a collab with BFAST. Held back in the first pass on attribution grounds and added once Marty confirmed on 21 Aug 2026 that Darragh is happy for it to be used. |
| `7-drop-moon-rock-birthday-cake.jpg` | @bfastofficial post, 20 April | "Moon Rock & Birthday Cake — our first drop of the year." Both colourways worn. |

The number prefix is the order of the photo strip, matching the convention
`partner_photos_sync()` uses for the `partner-photos` bucket, so the two routes
behave the same way.

**Attribution.** Everything here is BFAST's own material except
`6-shorts-detail.jpg`, which @darraghbarry309 shot and posted as a collab with
BFAST. It was held back in the first pass for exactly that reason, and added
after Marty confirmed on 21 Aug 2026 that Darragh is happy for it to be used.
Recorded here because a permission nobody wrote down is a permission nobody can
find later.

Instagram furniture — carousel pills, the ≡ menu, the mute and tag buttons — is
cropped out where it sits at an edge, and painted out where it sits over white
beside something worth keeping (the wordmark on `7-`). Nothing inside a
photograph has been altered.

Product tiles were cut by detecting the non-white bounding box inside each
quadrant of the shop page rather than by eye, so nothing is clipped and the
padding is even.

## Adding to these later

Two routes now, and they agree:

* **This folder** — commit, deploy, then set `partners.logo_url` / `photo_urls`
  to `https://parkeasy.uk/bfast/...`. Never set the URLs before the deploy: that
  is how Jack Daniels Fitness showed a broken-image icon for two days.
* **The `partner-photos` bucket** — drop files in `partner-photos/bfast/` from
  the Supabase dashboard and run `select * from partner_photos_sync('bfast');`.
  No deploy, and the URL is derived from the bucket so it cannot name a file
  that is not there.
