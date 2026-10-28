import { useParams } from 'react-router';
import { t } from '@/i18n';
import { PlaceholderScreen } from '@/ui/PlaceholderScreen';

/** Placeholder (FND-04): series grid, optionally filtered by category. */
export function SeriesScreen() {
  const { categoryId } = useParams();
  const text = t.routes.screens.series;
  return (
    <PlaceholderScreen
      title={text.title}
      message={text.empty}
      detail={categoryId === undefined ? undefined : t.routes.categoryLabel(categoryId)}
    />
  );
}
