import { useEffect, useRef } from 'react';

/**
 * Make the phone's back button close the thing that's open, instead of leaving.
 *
 * WHY. Installed to a home screen there is no browser chrome, so the hardware
 * back button is the ONLY back affordance a driver has. With nothing listening,
 * pressing it inside a full-screen sheet — a spot, a business page, the event
 * calendar — quit the app. That is the worst possible response: the person was
 * two taps into something and lost the lot.
 *
 * HOW, and why it is done this way. The obvious implementation pushes one
 * history entry per open layer and pops them as things close. That desynchs the
 * moment anything closes by a route other than the back button — an X button, a
 * backdrop tap, Escape — and once the count is wrong the back button starts
 * closing the wrong sheet, or two at once.
 *
 * So this keeps at most ONE history entry, ever:
 *
 *   nothing open → something open   push the guard
 *   back pressed                    guard is consumed; close the top layer;
 *                                   if anything is still open, push a new guard
 *   everything closed by the UI     consume the guard with a silent back()
 *
 * Because there is only ever one, the reconciliation is always a single step,
 * which is the entire reason it stays correct. The `skip` counter marks the
 * popstate events we caused ourselves so they are not mistaken for the user.
 *
 * @param layers ordered outermost → innermost. The LAST open one closes first,
 *               which is what "topmost" means to the person looking at it.
 *               Shape: [isOpen, close][]
 */
export default function useBackButton(layers) {
  // Read through refs so the popstate listener can be registered once and still
  // see current state. Re-registering on every render would drop events during
  // the gap and is how this kind of handler usually goes wrong.
  const layersRef = useRef(layers);
  layersRef.current = layers;

  const guarded = useRef(false);   // is our history entry currently on the stack
  const skip    = useRef(0);       // popstate events we caused, to be ignored

  const depth = layers.filter(([open]) => open).length;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (depth > 0 && !guarded.current) {
      window.history.pushState({ peBack: true }, '');
      guarded.current = true;
    } else if (depth === 0 && guarded.current) {
      // Everything was closed some other way. Take our entry back off the
      // stack, or the next back press would be swallowed doing nothing.
      guarded.current = false;
      skip.current += 1;
      window.history.back();
    }
  }, [depth]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPop = () => {
      if (skip.current > 0) { skip.current -= 1; return; }
      guarded.current = false;
      const open = layersRef.current.filter(([isOpen]) => isOpen);
      if (!open.length) return;                 // nothing to close: let it go
      open[open.length - 1][1]();               // close the topmost
      if (open.length > 1) {
        window.history.pushState({ peBack: true }, '');
        guarded.current = true;
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
}
