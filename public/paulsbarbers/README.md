# Paul's Barbers — image drop

Four files go here, named exactly:

| file | what it is |
|---|---|
| `logo.jpg` | the round PB monogram on black |
| `1-skin-fade.jpg` | high skin fade, textured top, full beard |
| `2-textured-crop.jpg` | textured crop with a fringe, beard blended in |
| `3-taper-back.jpg` | taper from behind, showing the neckline |

Same convention as `public/aaronquinn/`.

Once they are committed and deployed, run
`supabase/migrations/20260819_pauls_barbers_media.sql` — **in that order**.
Running it first points the live partner card at URLs that 404, and a broken
image on a featured placement reads as "this business is not really here".

Delete this file when the images land.
