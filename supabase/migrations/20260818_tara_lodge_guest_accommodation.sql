-- Tara Lodge: "hotel" -> "Guest Accommodation". APPLIED 18 Aug 2026.
--
-- Sinéad asked for this and called it trivial. It isn't. Tourism NI certifies
-- accommodation by category, and Tara Lodge is certified GUEST ACCOMMODATION,
-- not a Hotel. Describing a certified property as something it is not is the
-- kind of small inaccuracy a partner has to live with on someone else's page,
-- and she is the one who would field the question.
--
-- Worth noting what she actually saw: the word she objected to was
-- "guesthouse", and that word was never on the live page. It was in the
-- pitch mock-up sent to her on 12 August. The live row said "boutique hotel",
-- which nobody had queried and which was also wrong. Both are fixed here.
--
-- Capitalised mid-sentence on purpose — it is the classification's name, and
-- it is the form she asked for.
--
-- Everything else in the description is unchanged, including the line that
-- deliberately does NOT offer a bookable space near Cromwell Road, because
-- there isn't one: the nearest bookable listing is Davitt Park, 2km away on
-- the other side of the city.
update partners set
  tagline = '4-star boutique Guest Accommodation in the Queen’s Quarter — and one of the few places in central Belfast with free, secure parking of its own.',
  description = 'Thirty-four rooms of 4-star boutique Guest Accommodation on a quiet residential street off Botanic Avenue, five minutes from Queen’s University and the Ulster Museum and about fifteen minutes’ walk from the city centre.

The part that matters if you are driving: Tara Lodge has its own free, secure on-site car park, which almost nothing else this close to the middle of Belfast can say. Guests are not paying for parking and not circling for it. Breakfast is à la carte and made to order, and the WiFi is free throughout.

Visiting rather than staying? Cromwell Road sits in the middle of the Botanic and Queen’s parking that ParkEasy already maps — free evening and weekend kerbside on the side streets, and the University Road bays after 6pm.'
where slug = 'tara-lodge';
