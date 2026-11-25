import { createLifecycles } from '../../../platform/spool/src/runtime.tsx';
import Application from './TransactionHistoryApp.tsx';
const lifecycles = createLifecycles(Application);
export const { bootstrap, mount, unmount } = lifecycles;
