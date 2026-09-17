// A one-line message to the driver, from anywhere in the app.
//
// THE BUG THIS FIXES. App.jsx already has the right thing — a `flash` banner
// pinned to the top, rendered near the bottom of the file — but it is local
// component state, so nothing outside the App function can reach it. Every
// component that needed to say something therefore reached for `notify()` from
// src/notify.js, which reads like a toast and is not: it POSTs to /api/notify,
// which EMAILS THE FOUNDER. So
//
//   notify('Alerts off')
//   notify('Reminder set on this device only')
//   notify('30 days of Premium added — thanks for the help')
//
// each sent an email to parkeasyuk@gmail.com with `type` set to the sentence,
// fell through to the contact template, and showed the driver nothing at all.
// Four features did it, because the first one to do it looked correct and the
// rest copied it.
//
// This is the missing half: a module-level bus that the App subscribes to and
// anything can publish on. Deliberately tiny — one listener, last writer wins,
// because the App is mounted once and two banners at once is a UI problem
// rather than a queue problem.

let listener = null;

/**
 * Subscribe. Returns the unsubscribe, so a remount cannot leave a dead
 * setState behind.
 */
export const onToast = (fn) => {
  listener = typeof fn === 'function' ? fn : null;
  return () => { if (listener === fn) listener = null; };
};

/**
 * Say something.
 *
 * @param msg  one line, already in the driver's words
 * @param tone 'ok' | 'warn' — warn for anything that did not work
 *
 * With nobody subscribed the message is logged rather than dropped silently:
 * a toast that vanishes because the bus was not wired up is the same class of
 * bug as the one this file exists to fix, and a console line is how it gets
 * noticed in development.
 */
export const toast = (msg, tone = 'ok') => {
  const text = String(msg ?? '').trim();
  if (!text) return false;
  if (!listener) {
    try { console.info('[toast]', text); } catch { /* nothing to do */ }
    return false;
  }
  listener({ msg: text, tone: tone === 'warn' ? 'warn' : 'ok' });
  return true;
};

export default toast;
