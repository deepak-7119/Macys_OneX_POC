import { createRoot, type Root } from 'react-dom/client';
import type { ComponentType } from 'react';
import type { AppProps } from '../../contracts/index.ts';

export function createLifecycles(Application: ComponentType<AppProps>) {
  let root: Root | undefined;
  return {
    bootstrap: async () => {},
    mount: async (props: AppProps) => {
      const container = document.getElementById('application-root');
      if (!container) throw new Error('Application mount point missing');
      root = createRoot(container);
      root.render(<Application manifest={props.manifest} session={props.session} />);
    },
    unmount: async () => {
      root?.unmount();
      root = undefined;
    },
  };
}
