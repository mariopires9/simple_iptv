import { useParams } from 'react-router';
import { t } from '@/i18n';
import { PlaceholderScreen } from '@/ui/PlaceholderScreen';

/** Placeholder (FND-04): series details, seasons and episodes. */
export function SeriesDetailsScreen() {
  const { seriesId } = useParams();
  const text = t.routes.screens.seriesDetails;
  return (
    <PlaceholderScreen
      title={text.title}
      message={text.empty}
      detail={seriesId === undefined ? undefined : t.routes.itemLabel(seriesId)}
    />
  );
}
