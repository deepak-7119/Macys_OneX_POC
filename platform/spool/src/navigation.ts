/** A completed single-spa reroute must not erase errors raised while loading it. */
export function bindNavigationEvents(
  target: EventTarget,
  readPath: () => string,
  onPath: (path: string) => void,
  onNavigationStart: () => void,
): () => void {
  const update = () => onPath(readPath());
  const begin = () => onNavigationStart();
  target.addEventListener('single-spa:before-routing-event', begin);
  target.addEventListener('single-spa:routing-event', update);
  target.addEventListener('popstate', update);
  return () => {
    target.removeEventListener('single-spa:before-routing-event', begin);
    target.removeEventListener('single-spa:routing-event', update);
    target.removeEventListener('popstate', update);
  };
}
