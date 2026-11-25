import { useEffect, useState } from 'react';

export type PresentationMode = 'web' | 'pos';
export const PRESENTATION_EVENT = 'overlock:presentation-change';

/** Presentation is a per-tab UI preference, never identity or an API permission. */
export function readPresentationMode(url: string): PresentationMode {
  try {
    const values = new URL(url, 'http://presentation.invalid').searchParams.getAll('view');
    return values.length === 1 && values[0] === 'pos' ? 'pos' : 'web';
  } catch {
    return 'web';
  }
}

/** Only reviewed, root-relative navigation may be decorated with a view mode. */
export function presentationUrl(url: string, mode: PresentationMode): string {
  if (
    typeof url !== 'string' ||
    !url.startsWith('/') ||
    url.startsWith('//') ||
    /[\\\u0000-\u0020\u007f]/.test(url) ||
    (mode !== 'web' && mode !== 'pos')
  ) {
    throw new Error('Presentation navigation requires an internal path and a known view.');
  }
  const result = new URL(url, 'http://presentation.invalid');
  if (result.origin !== 'http://presentation.invalid') {
    throw new Error('Presentation navigation cannot leave this application.');
  }
  result.searchParams.set('view', mode);
  return result.pathname + result.search + result.hash;
}

export function bindPresentationEvents(
  target: EventTarget,
  readUrl: () => string,
  onChange: (mode: PresentationMode) => void,
): () => void {
  const update = () => onChange(readPresentationMode(readUrl()));
  const events = [PRESENTATION_EVENT, 'popstate', 'single-spa:routing-event'];
  for (const event of events) target.addEventListener(event, update);
  return () => {
    for (const event of events) target.removeEventListener(event, update);
  };
}

export function usePresentationMode(): PresentationMode {
  const [mode, setMode] = useState<PresentationMode>(() =>
    typeof window === 'undefined' ? 'web' : readPresentationMode(window.location.href),
  );
  useEffect(() => bindPresentationEvents(window, () => window.location.href, setMode), []);
  return mode;
}

export function setPresentationMode(mode: PresentationMode): void {
  const path = window.location.pathname + window.location.search + window.location.hash;
  window.history.replaceState(window.history.state, '', presentationUrl(path, mode));
  window.dispatchEvent(new Event(PRESENTATION_EVENT));
}
