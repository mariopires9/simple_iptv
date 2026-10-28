import Typography from '@mui/material/Typography';
import { useParams } from 'react-router';
import { t } from '@/i18n';

/** Placeholder (FND-04): channel list, optionally filtered by category. */
export function LiveScreen() {
  const { categoryId } = useParams();
  const text = t.routes.screens.live;
  return (
    <>
      <Typography variant="h1">{text.title}</Typography>
      {categoryId !== undefined && (
        <Typography>
          {t.routes.category}: {categoryId}
        </Typography>
      )}
      <Typography color="text.secondary">{text.empty}</Typography>
    </>
  );
}
