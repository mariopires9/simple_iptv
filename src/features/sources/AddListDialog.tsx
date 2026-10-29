// "Add list" chooser (SRC-08): Xtream / M3U URL / M3U file (coming soon), routing to the existing
// add screens, which return to "My lists" once done.
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import { useId } from 'react';
import { Link } from 'react-router';
import { t } from '@/i18n';

export const ADD_XTREAM_PATH = '/settings/sources/add/xtream';
export const ADD_M3U_URL_PATH = '/settings/sources/add/m3u-url';

export interface AddListDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AddListDialog({ open, onClose }: AddListDialogProps) {
  const text = t.lists.chooser;
  const titleId = useId();
  const options = [
    { key: 'xtream', to: ADD_XTREAM_PATH, ...text.xtream },
    { key: 'm3u-url', to: ADD_M3U_URL_PATH, ...text.m3uUrl },
  ];
  return (
    <Dialog open={open} onClose={onClose} aria-labelledby={titleId} fullWidth maxWidth="xs">
      <DialogTitle id={titleId}>{text.title}</DialogTitle>
      <DialogContent sx={{ px: 1 }}>
        <List>
          {options.map((option) => (
            <ListItem key={option.key} disablePadding>
              <ListItemButton component={Link} to={option.to} onClick={onClose}>
                <ListItemText primary={option.title} secondary={option.subtitle} />
                <ChevronRightRounded aria-hidden />
              </ListItemButton>
            </ListItem>
          ))}
          <ListItem disablePadding>
            {/* TODO(SRC-06): local M3U file. */}
            <ListItemButton disabled>
              <ListItemText primary={text.m3uFile.title} secondary={text.m3uFile.subtitle} />
            </ListItemButton>
          </ListItem>
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t.state.cancel}</Button>
      </DialogActions>
    </Dialog>
  );
}
