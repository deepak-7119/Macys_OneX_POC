export type BinderMenuAction = 'training-alerts' | 'communication-menu' | 'exit';

export interface BinderMenuItem {
  key: number;
  label: string;
  hint?: string;
  action?: BinderMenuAction;
  disabled: boolean;
}

export interface BinderMenu {
  appId: 'associate-communications';
  source: 'mock';
  context: {
    division: string;
    store: string;
    presentation: 'pos';
  };
  items: BinderMenuItem[];
}
