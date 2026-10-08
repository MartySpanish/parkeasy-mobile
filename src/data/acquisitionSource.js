// Where a visitor came from — the one thing app_events could not answer.
//
// WHAT WAS MISSING. 239 events across 47 sessions, and no way to say whether a
// single one came from Google, Facebook, a printed QR code or Marty's own
// phone. Every marketing decision — which post worked, whether a flyer is
// worth printing, whether to pay for a click — was unmeasurable, because the
// referrer was never recorded anywhere.
//
// IT GOES ON THE FIRST EVENT OF A SESSION, NOT EVERY EVENT. Attribution is a
// property of the visit, so repeating it on all 79 searches would spend the
// props budget (20 keys / 200 chars, capped server-side) to say the same thing
// seventy-nine times.
//
// THE KEYS ARE SHORT ON PURPOSE: ch, src, cmp. Same reason.
//
// WHAT THIS IS NOT. It is not a person, a profile or a cross-site identifier.
// It is the referring host and any utm_* the link already carried — the same
// facts in every server access log — attached to a session id that identifies
// a browsing session, not a human. No cookie is set beyond the session id that
// already exists, and nothing is sent to a third party.

/** Hosts that mean somebody searched and clicked a result. */
const SEARCH = [
  'google.', 'bing.', 'duckduckgo.', 'search.yahoo.', 'ecosia.org',
  'startpage.com', 'qwant.com', 'brave.com', 'baidu.com', 'yandex.',
];

/**
 * Assistants and answer engines.
 *
 * Kept separate from SEARCH deliberately. Section 9 of the growth brief is
 * about being a source an AI can recommend, and that is not measurable if a
 * referral from an assistant is filed under "organic" with Google.
 */
const AI = [
  'chatgpt.com', 'chat.openai.com', 'openai.com',
  'perplexity.ai', 'claude.ai', 'gemini.google.com', 'bard.google.com',
  'copilot.microsoft.com', 'you.com', 'phind.com', 'poe.com',
];

const SOCIAL = [
  'facebook.', 'fb.com', 'm.facebook.', 'l.facebook.', 'lm.facebook.',
  'instagram.', 'l.instagram.', 'tiktok.', 'twitter.', 'x.com', 't.co',
  'linkedin.', 'lnkd.in', 'reddit.', 'pinterest.', 'youtube.', 'youtu.be',
  'whatsapp.', 'wa.me', 'snapchat.', 'threads.net', 'nextdoor.',
];

/** utm_medium values that mean money changed hands. */
const PAID_MEDIUM = ['cpc', 'ppc', 'paid', 'paidsearch', 'paid_search', 'cpm', 'display', 'banner'];

const hostOf = (url) => {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
};

const matches = (host, list) => list.some(h => host === h.replace(/\.$/, '') || host.includes(h));

/**
 * Classify one visit.
 *
 * ORDER MATTERS, and paid wins. A Facebook ad arrives with a facebook.com
 * referrer AND utm_medium=cpc; filing it under "social" would make paid spend
 * invisible, which is the one channel where being wrong costs money directly.
 *
 * @param referrer  document.referrer (may be '')
 * @param search    location.search (may be '')
 * @param selfHost  our own hostname, so an in-site navigation is not a referral
 * @returns {{ch:string, src?:string, cmp?:string}}
 */
export function classify(referrer = '', search = '', selfHost = '') {
  const q = new URLSearchParams(String(search || ''));
  // ParkEasy's own printed-source parameter, which predates any utm here.
  //
  // All 26 QR codes in qr_codes land on `?src=<code>` and api/q.js redirects
  // them there. The stickers are ON A WALL IN A BARBER'S and cannot be edited
  // — api/q.js makes that point about never dead-ending a physical code — so
  // reading `src` is the only fix that reaches the print runs already out
  // there. A scan is therefore 'offline' with the sticker's code as its
  // source, which is what links "the Falls Road sticker" to what that session
  // then did.
  const srcParam = (q.get('src') || '').trim().toLowerCase().slice(0, 40);
  const utmSource = (q.get('utm_source') || '').trim().toLowerCase().slice(0, 40);
  const utmMedium = (q.get('utm_medium') || '').trim().toLowerCase().slice(0, 40);
  const utmCampaign = (q.get('utm_campaign') || '').trim().toLowerCase().slice(0, 40);
  const host = hostOf(referrer);
  const me = String(selfHost || '').toLowerCase().replace(/^www\./, '');

  const out = {};
  if (utmCampaign) out.cmp = utmCampaign;

  // 1. Paid, if the link says so. Checked first — see the note above.
  if (utmMedium && PAID_MEDIUM.includes(utmMedium)) {
    return { ch: 'paid', src: utmSource || host || 'unknown', ...out };
  }

  // 2. A QR code or a printed flyer. These have no referrer at all, so without
  //    a marker they are indistinguishable from somebody typing the address —
  //    which is exactly why every flyer needs one.
  //
  //    `src` is checked alongside the utm forms and BEFORE the referrer, because
  //    api/q.js issues a 302 and some browsers set the referrer to the /q/ URL
  //    on the hop; classifying by host first would file a sticker scan as an
  //    internal navigation and lose it.
  if (srcParam || utmMedium === 'qr' || utmSource === 'qr'
      || utmMedium === 'print' || utmMedium === 'flyer') {
    return { ch: 'offline', src: srcParam || utmSource || utmMedium, ...out };
  }

  // 3. An explicit utm_source with no referrer we recognise: trust the link.
  //    Email and newsletter are their own channel, not "referral".
  if (utmMedium === 'email' || utmMedium === 'newsletter') {
    return { ch: 'email', src: utmSource || 'unknown', ...out };
  }

  if (host) {
    if (me && (host === me || host.endsWith(`.${me}`))) return { ch: 'internal', ...out };
    if (matches(host, AI)) return { ch: 'ai', src: host, ...out };
    if (matches(host, SEARCH)) return { ch: 'organic', src: host, ...out };
    if (matches(host, SOCIAL)) return { ch: 'social', src: host, ...out };
    return { ch: 'referral', src: host, ...out };
  }

  // 4. No referrer and no utm. Typed, bookmarked, or a link from an app that
  //    strips the referrer. "direct" is honest about not knowing.
  if (utmSource) return { ch: 'other', src: utmSource, ...out };
  return { ch: 'direct', ...out };
}

/** Read the current page's attribution. Returns {} where there is no window. */
export function currentSource() {
  try {
    return classify(document.referrer || '', window.location.search || '', window.location.hostname || '');
  } catch {
    return {};
  }
}
