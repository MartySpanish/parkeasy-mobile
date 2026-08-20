# Spot photos

Photos of community spots that ParkEasy hosts itself, rather than serving from
the Supabase `listing-photos` bucket.

Same reasoning as `public/taralodge/`, `public/paulsbarbers/` and the rest: when
a photo arrives by email or by hand rather than through the in-app uploader, it
belongs in version control next to the row that references it, so it cannot be
deleted out from under a live spot by a storage tidy-up.

Photos submitted through the app go to the bucket and are referenced by their
storage URL. This directory is for the ones that did not.

| file | spot | source |
|---|---|---|
| `river-terrace.jpg` | River Terrace / Gasworks, Belfast | Marty's own submission, 14 July 2026. Cropped from the original 540×720 to keep the road, the kerb and the buildings in frame — a centre-crop of the portrait original, which is what the card would have done, shows nothing but tarmac. |
