// Restricted-content gate (SEC-03): while parental control is locked, content of a restricted
// category is replaced by a "Restricted content" state with a PIN prompt. Nothing of the content
// is rendered (so nothing plays) until the right PIN is entered.
import Button from '@mui/material/Button';
import { useState, type ReactNode } from 'react';
import { isCategoryLocked } from '@/core/session/parental';
import { t } from '@/i18n';
import { StateView } from '@/ui/state';
import { PinDialog } from './PinDialog';
import { useParental } from './useParental';

export interface ParentalGateProps {
  /** The content's category key (undefined: never restricted). */
  categoryKey: string | undefined;
  /** Heading level of the gate's state view (1 when it replaces a whole screen). */
  headingLevel?: 1 | 2 | 3;
  children: ReactNode;
}

export function ParentalGate({ categoryKey, headingLevel = 2, children }: ParentalGateProps) {
  const parental = useParental();
  const [prompt, setPrompt] = useState(false);
  // Not read yet: render nothing rather than flash restricted content.
  if (!parental.known && categoryKey !== undefined) return null;
  if (!isCategoryLocked(categoryKey, parental)) return <>{children}</>;
  return <RestrictedState headingLevel={headingLevel} prompt={prompt} setPrompt={setPrompt} />;
}

function RestrictedState({
  headingLevel,
  prompt,
  setPrompt,
}: {
  headingLevel: 1 | 2 | 3;
  prompt: boolean;
  setPrompt: (open: boolean) => void;
}) {
  const text = t.parental.gate;
  return (
    <>
      <StateView
        variant="empty"
        headingLevel={headingLevel}
        title={text.title}
        message={text.message}
        actions={
          <Button variant="contained" onClick={() => setPrompt(true)}>
            {text.unlock}
          </Button>
        }
      />
      <PinDialog open={prompt} onClose={() => setPrompt(false)} />
    </>
  );
}
