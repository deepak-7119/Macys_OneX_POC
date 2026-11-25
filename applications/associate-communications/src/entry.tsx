import { createLifecycles } from '../../../platform/spool/src/runtime.tsx';
import Application from './AssociateCommunicationsApp.tsx';
const lifecycles = createLifecycles(Application);
export const { bootstrap, mount, unmount } = lifecycles;
