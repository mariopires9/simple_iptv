import Typography from '@mui/material/Typography';
import { useParams } from 'react-router';
import { t } from '@/i18n';

/** Placeholder (FND-04): series details, seasons and episodes. */
export function SeriesDetailsScreen() {
  const { seriesId } = useParams();
  const text = t.routes.screens.seriesDetails;
  return (
    <>
      <Typography variant="h1">{text.title}</Typography>
      {seriesId !== undefined && (
        <Typography>
          {t.routes.item}: {seriesId}
        </Typography>
      )}
      <Typography color="text.secondary">{text.empty}</Typography>
    </>
  );
}
