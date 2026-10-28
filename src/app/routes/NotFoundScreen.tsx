import Button from '@mui/material/Button';
import { Link } from 'react-router';
import { t } from '@/i18n';
import { StatusView } from './StatusView';

/** Unknown route (FND-04 AC3). */
export function NotFoundScreen() {
  return (
    <StatusView
      title={t.routes.notFound.title}
      message={t.routes.notFound.message}
      actions={
        <Button variant="contained" component={Link} to="/">
          {t.routes.goHome}
        </Button>
      }
    />
  );
}
