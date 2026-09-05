import '@testing-library/jest-dom/vitest';

/*
 * jsdom ships no ResizeObserver, so any component that re-measures itself on layout changes throws
 * on mount. It never fires here — jsdom does no layout — which is the right behaviour for a test:
 * components take their first measurement in the layout effect itself and only use the observer to
 * stay correct afterwards.
 */
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}
