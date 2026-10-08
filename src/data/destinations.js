// The six destination pages, and what each one is actually about.
//
// WHY THEY NEEDED THIS. /area/qub.html, city-hospital, sse-arena,
// titanic-quarter, botanic and cathedral-quarter target the highest-intent
// queries ParkEasy owns — "parking near Queen's University Belfast", "parking
// near the O2 Belfast". All six shipped as ~130 words: a description, two
// paragraphs of boilerplate identical across all six, and a "Why ParkEasy?"
// card with the same text on every one.
//
// So PR #194 noindexed them, and that was right: six near-duplicate pages in
// the index under your best queries is worse than nothing. The fix is not to
// lift the tag, it is to make the pages worth indexing — which means naming
// the spots that are actually there, with their real restrictions and prices,
// out of the 787 surveyed spaces the app already renders.
//
// COORDINATES ARE THE DESTINATION, NOT A CAR PARK. Walking distances are
// computed from these, printed on the page, and read by crawlers, so a lazy
// pin becomes a published lie. Each one is the place a driver means when they
// type the query, with its postcode recorded so it can be checked.
//
// ⚠️ EVERY SENTENCE BELOW IS A PUBLISHED CLAIM, AND TWO RULES GOVERN IT.
//
// 1. NEVER NAME A HIDDEN GEM. Gems are what Premium sells. The first draft of
//    this file named Riddel Hall under Queen's and the Stranmillis Road free
//    car park under Botanic — both are hidden_gem rows, so both would have
//    given away a paid spot, permanently and to everyone, on a page built to
//    be crawled. inject-destination-pages.mjs now fails the build if any gem's
//    name appears anywhere in a generated page, prose included, rather than
//    trusting whoever edits this file to remember.
//
// 2. ONLY SAY WHAT THE DATA SAYS. Every restriction, price and opening time
//    below traces to a spot row in the app. Where a claim is derived (a
//    walking time from two coordinates) it is marked. Nothing is here because
//    it sounds plausible.

export const DESTINATIONS = [
  {
    slug: 'qub',
    name: "Queen's University Belfast",
    short: "Queen's",
    // The Lanyon Building, University Road BT7 1NN — what "Queen's" means to
    // somebody driving there, rather than the wider campus centroid.
    postcode: 'BT7 1NN',
    lat: 54.5845,
    lng: -5.9338,
    lede: 'The bays along University Road are pay-and-display Monday to Saturday, 8am to 6pm, '
      + 'and free outside those hours. That single rule is most of what you need: term-time '
      + 'evenings and Sundays are easy, weekday mornings are not.',
    faqs: [
      ['Is there free parking near Queen\'s University Belfast?',
        'Yes, mostly by time of day rather than by place. The pay-and-display bays on University '
        + 'Road are chargeable Monday to Saturday 8am to 6pm and free outside those hours, and '
        + 'Stranmillis Road is the same from 9am. The Lisburn Road side streets are residential '
        + 'and free, about eleven minutes away on foot.'],
      ['Where can I park at Queen\'s during the day?',
        'Weekday daytime is the hard case, because the nearby on-street bays are all chargeable. '
        + 'The nearest all-day covered option is NCP Dublin Road at £2.00 an hour, roughly a '
        + 'nine-minute walk.'],
      ['Can I park near Queen\'s on a Sunday?',
        'Yes. The pay-and-display bays on University Road and Stranmillis Road are outside their '
        + 'charged hours on a Sunday, so they are free.'],
    ],
  },
  {
    slug: 'botanic',
    name: "Botanic Gardens & the Queen's Quarter",
    short: 'Botanic',
    postcode: 'BT9 5AB',
    lat: 54.5840,
    lng: -5.9330,
    lede: 'There is no car park inside Botanic Gardens, so everyone parks on the streets around '
      + 'it. Those are pay-and-display Monday to Saturday and free outside the charged hours, '
      + 'which makes an evening visit free and a weekday afternoon not.',
    faqs: [
      ['Is there a car park at Botanic Gardens?',
        'There is no car park inside the gardens. Parking is on the surrounding streets — '
        + 'University Road and Stranmillis Road are the closest — or in one of the car parks '
        + 'around Dublin Road, under ten minutes away.'],
      ['Is parking at Botanic Gardens free?',
        'The on-street bays nearby are chargeable Monday to Saturday — from 8am on University '
        + 'Road and 9am on Stranmillis Road, both until 6pm — and free outside those hours. '
        + 'Ormeau Road, about an eight-minute walk, has free on-street parking with no '
        + 'restrictions.'],
      ['Where can I park for the Ulster Museum?',
        'The museum shares its setting with the gardens and has no visitor car park of its own, '
        + 'so the same on-street options apply. University Road is the nearest, a minute or two '
        + 'away.'],
    ],
  },
  {
    slug: 'city-hospital',
    name: 'Belfast City Hospital',
    short: 'the City Hospital',
    postcode: 'BT9 7AB',
    // 51 Lisburn Road, BT9 7AB. 54°35'16.2"N 5°56'32.0"W from the hospital's
    // published trial-site address, converted to decimal. SINGLE-SOURCED —
    // worth a second check before anything depends on it more than a walking
    // estimate does.
    lat: 54.5878,
    lng: -5.9422,
    lede: 'Appointments run long, which makes a time-limited bay the wrong choice here. The two '
      + 'options that suit a hospital visit are NCP Dublin Road, about seven minutes away and '
      + 'open around the clock, and the free 250-space car park at the Olympia Leisure Centre, '
      + 'about ten.',
    faqs: [
      ['Is there free parking near Belfast City Hospital?',
        'The nearest free off-street parking is the Olympia Leisure Centre car park — 250 spaces, '
        + 'free during centre hours, about a ten-minute walk. The on-street bays towards '
        + 'University Road and Dublin Road are chargeable Monday to Saturday.'],
      ['Where can I park near Belfast City Hospital for a long appointment?',
        'NCP Dublin Road is open 24 hours at £2.00 an hour and is roughly seven minutes on foot — '
        + 'the most reliable option when you do not know how long you will be. The time-limited '
        + 'on-street bays nearby are not suited to a long wait.'],
      ['Can I charge an electric car near Belfast City Hospital?',
        'Yes. There is an ultra-rapid charging hub on Boucher Road, about twelve minutes away, '
        + 'which is free to park at while charging is billed by the network.'],
    ],
  },
  {
    slug: 'sse-arena',
    name: 'The O2 Belfast',
    short: 'The O2 Belfast',
    postcode: 'BT3 9QQ',
    lat: 54.6037,
    lng: -5.9170,
    lede: 'The arena\'s own Lagan-side car park is two minutes from the door and is the one '
      + 'everybody tries first. City Quays is five minutes away and the Titanic Belfast car park '
      + 'six, with 520 spaces and a published tariff.',
    faqs: [
      ['Where do you park for The O2 Belfast?',
        'The arena\'s own Lagan-side car park is the closest, about two minutes on foot. City '
        + 'Quays is five minutes and the 520-space Titanic Belfast car park six, starting at '
        + '£2.20 for the first hour.'],
      ['Is there free parking near The O2 Belfast?',
        'Queens Road has free on-street parking all day and is about an eight-minute walk. It is '
        + 'limited, so it is a better bet off-peak than on a sold-out night.'],
      ['Is there covered parking near The O2 Belfast?',
        'Yes — two APCOA multi-storeys are within a ten-minute walk: Lanyon Place at £4.70 an '
        + 'hour and Oxford Street at £4.10, both open 24/7 and barrierless ANPR, so you pay by '
        + 'app or online rather than at a barrier. Lanyon Place has a 2.1-metre height limit.'],
    ],
  },
  {
    slug: 'titanic-quarter',
    name: 'Titanic Quarter',
    short: 'Titanic Quarter',
    postcode: 'BT3 9EP',
    lat: 54.6085,
    lng: -5.9095,
    lede: 'Queens Road runs alongside Titanic Belfast and is free on-street parking all day — a '
      + 'minute\'s walk, and the option most visitors drive straight past on their way into the '
      + 'paid car park.',
    faqs: [
      ['Is parking at Titanic Belfast free?',
        'The Titanic Belfast visitor car park is chargeable, from £2.20 for the first hour across '
        + '520 spaces. Queens Road, about a minute away on foot, is free on-street parking all '
        + 'day.'],
      ['Where is the cheapest parking in Titanic Quarter?',
        'The free on-street bays on Queens Road. They are limited, so they fill on a busy weekend '
        + 'or when there is an event at the arena nearby.'],
      ['Can I park in Titanic Quarter and walk into the city centre?',
        'It is about twenty-five minutes on foot to Belfast City Hall, measured in a straight '
        + 'line, so most people park in Titanic Quarter for the quarter itself rather than as a '
        + 'park-and-walk.'],
    ],
  },
  {
    slug: 'cathedral-quarter',
    name: 'Cathedral Quarter',
    short: 'the Cathedral Quarter',
    postcode: 'BT1 2DZ',
    // St Anne's Cathedral, which is what the quarter is named for and the
    // middle of the area people mean.
    lat: 54.6009,
    lng: -5.9281,
    lede: 'Five car parks sit within three minutes of each other here at prices from 60p to '
      + '£2.50 an hour, which makes the Cathedral Quarter the best-served part of Belfast for '
      + 'parking and the hardest to choose in.',
    faqs: [
      ['Where is the best parking for the Cathedral Quarter?',
        'Q-Park St Anne\'s Square is the closest covered parking to The MAC and St Anne\'s '
        + 'Cathedral, at £2.50 an hour. Little Donegall Street is two minutes further at 60p an '
        + 'hour with 105 spaces — the cheapest nearby — but it is charged Monday to Saturday, 8am '
        + 'to 6pm, rather than around the clock.'],
      ['Is there free parking in the Cathedral Quarter?',
        'The on-street bays around Exchange Street are chargeable Monday to Saturday 8am to 6pm '
        + 'and free outside those hours, which makes them the cheapest option for an evening out. '
        + 'York Street, about five minutes away, is free with no restrictions.'],
      ['Is the Corporation Square car park free in the evening?',
        'No, and this is the exception worth knowing. Unlike most Belfast City Council car parks, '
        + 'Corporation Square is not free outside its charged hours.'],
    ],
  },
];

export const bySlug = (slug) => DESTINATIONS.find(d => d.slug === slug) || null;
