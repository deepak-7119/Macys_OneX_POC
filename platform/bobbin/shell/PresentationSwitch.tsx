import React from 'react';
import type { PresentationMode } from '../../spool/src/presentation.ts';

export function PresentationSwitch({
  mode,
  onChange,
}: {
  mode: PresentationMode;
  onChange: (mode: PresentationMode) => void;
}) {
  return (
    <div className="presentation-switch" role="group" aria-label="Presentation mode">
      <button type="button" aria-pressed={mode === 'web'} onClick={() => onChange('web')}>
        Web view
      </button>
      <button type="button" aria-pressed={mode === 'pos'} onClick={() => onChange('pos')}>
        POS view
      </button>
    </div>
  );
}
