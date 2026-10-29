// "My lists" (SRC-08, docs/UX_UI.md §4.1b): every saved list as a card — active first, then by
// name — with use / refresh / edit / remove, and "Add list". No limit on the number of lists.
import AddRounded from '@mui/icons-material/AddRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router';
import type { Source } from '@/core/db';
import { log } from '@/core/log';
import { t } from '@/i18n';
import { DelayedLoading, SkeletonContainer, StateView, errorDetails, useToast } from '@/ui/state';
import { setActiveSource, useActiveSource } from './activeSource';
import { AddListDialog } from './AddListDialog';
import { removeSource } from './manage';
import { RemoveSourceDialog } from './RemoveSourceDialog';
import { SourceCard } from './SourceCard';
import {
  cancelSourceSync,
  getSourceSyncSnapshot,
  startSourceSync,
  subscribeSourceSync,
  type SyncWorker,
} from './sourceSync';
import { effectiveActiveId, reloadSources, sortSources, useSourcesList } from './sourcesList';

export const ONBOARDING_PATH = '/onboarding';

export interface SourcesScreenProps {
  /** Tests: the worker used by "Refresh". */
  worker?: () => Promise<SyncWorker>;
}

export function SourcesScreen({ worker }: SourcesScreenProps = {}) {
  const text = t.sources.myLists;
  const toast = useToast();
  const navigate = useNavigate();
  const { sources, error, readAt } = useSourcesList();
  const active = useActiveSource();
  const syncs = useSyncExternalStore(subscribeSourceSync, getSourceSyncSnapshot);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Source | undefined>();
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removed, setRemoved] = useState(false);
  const headings = useRef(new Map<string, HTMLHeadingElement>());
  const titleRef = useRef<HTMLHeadingElement>(null);
  /**
   * List whose heading gets the focus once it is shown as active: after "Use this" the cards
   * re-order, so focus follows the list that became active.
   */
  const pendingFocusId = useRef<string | undefined>(undefined);

  // Always a fresh read when the page opens (counts may have changed since the last one).
  useEffect(() => {
    reloadSources('shared').catch(() => undefined);
  }, []);

  const ready = sources !== undefined && active.known;
  const activeId = sources ? effectiveActiveId(sources, active.id) : undefined;
  const ordered = ready ? sortSources(sources, activeId) : [];

  useEffect(() => {
    const pending = pendingFocusId.current;
    if (pending === undefined) return;
    const heading = headings.current.get(pending);
    if (heading && pending === activeId) {
      pendingFocusId.current = undefined;
      heading.focus();
    }
  });

  async function use(source: Source) {
    pendingFocusId.current = source.id;
    try {
      await setActiveSource(source.id);
      toast.show({ message: text.toasts.switched(source.name) });
    } catch (failure) {
      pendingFocusId.current = undefined;
      log.warn('Switching the active source failed', { error: failure });
      toast.show({ message: t.lists.switchFailed, severity: 'error' });
    }
  }

  async function refresh(source: Source) {
    const run = await startSourceSync(source, worker);
    if (run.dispatch === 'unavailable') {
      log.warn('Refresh could not be started', { sourceId: source.id, error: run.error });
      toast.show({ message: text.toasts.refreshUnavailable, severity: 'error' });
      return;
    }
    if (run.dispatch !== 'started') return;
    const outcome = await run.done;
    switch (outcome.status) {
      case 'ok':
        toast.show({ message: text.toasts.refreshed(source.name), severity: 'success' });
        break;
      case 'partial':
        toast.show({ message: text.toasts.refreshPartial(source.name) });
        break;
      case 'error':
      case 'failed':
        if (outcome.status === 'failed') {
          log.warn('Refresh failed', { sourceId: source.id, error: outcome.error });
        }
        toast.show({ message: text.toasts.refreshFailed(source.name), severity: 'error' });
        break;
      case 'cancelled':
        break;
    }
  }

  async function confirmRemove() {
    const target = removing;
    if (!target || removeBusy) return;
    setRemoveBusy(true);
    setRemoved(false);
    try {
      const result = await removeSource(target.id);
      toast.show({ message: text.toasts.removed(target.name) });
      setRemoved(true);
      setRemoving(undefined);
      setRemoveBusy(false);
      // Otherwise the dialog's `onExited` moves the focus to the page heading.
      if (result.remaining === 0) void navigate(ONBOARDING_PATH, { replace: true });
    } catch (failure) {
      log.warn('Removing the source failed', { sourceId: target.id, error: failure });
      toast.show({ message: text.toasts.removeFailed(target.name), severity: 'error' });
      setRemoving(undefined);
      setRemoveBusy(false);
    }
  }

  let content;
  if (sources === undefined && error !== undefined) {
    content = (
      <StateView
        variant="error"
        title={text.loadError.title}
        message={text.loadError.message}
        details={errorDetails(error)}
        actions={
          <Button variant="contained" onClick={() => void reloadSources().catch(() => undefined)}>
            {t.state.actions.retry}
          </Button>
        }
      />
    );
  } else if (!ready) {
    content = (
      <DelayedLoading>
        <SkeletonContainer>
          {[0, 1].map((i) => (
            <Skeleton key={i} variant="rounded" height={160} sx={{ mb: 2 }} />
          ))}
        </SkeletonContainer>
      </DelayedLoading>
    );
  } else if (ordered.length === 0) {
    content = (
      <StateView
        variant="empty"
        title={text.empty.title}
        message={text.empty.message}
        actions={
          <Button variant="contained" onClick={() => setAdding(true)}>
            {text.add}
          </Button>
        }
      />
    );
  } else {
    content = (
      <Stack component="ul" spacing={2} sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {ordered.map((source) => (
          <li key={source.id}>
            <SourceCard
              source={source}
              active={source.id === activeId}
              now={readAt}
              sync={syncs.get(source.id)}
              onUse={(s) => void use(s)}
              onRefresh={(s) => void refresh(s)}
              onCancelRefresh={(s) => void cancelSourceSync(s.id)}
              onRemove={setRemoving}
              headingRef={(el) => {
                if (el) headings.current.set(source.id, el);
                else headings.current.delete(source.id);
              }}
            />
          </li>
        ))}
      </Stack>
    );
  }

  return (
    <Box sx={{ maxWidth: 720, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <Typography
          ref={titleRef}
          tabIndex={-1}
          variant="h1"
          sx={{ flex: 1, minWidth: 0, outline: 'none' }}
        >
          {text.title}
        </Typography>
        <Button variant="outlined" startIcon={<AddRounded />} onClick={() => setAdding(true)}>
          {text.add}
        </Button>
      </Box>
      {content}
      <AddListDialog open={adding} onClose={() => setAdding(false)} />
      <RemoveSourceDialog
        name={removing?.name}
        busy={removeBusy}
        onCancel={() => setRemoving(undefined)}
        onConfirm={() => void confirmRemove()}
        removed={removed}
        onExited={() => {
          // The removed list's card (and its Remove button) is gone: focus the page heading.
          if (removed) titleRef.current?.focus();
          setRemoved(false);
        }}
      />
    </Box>
  );
}
