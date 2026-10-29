// Series screen (SER-01): categories, sort and the virtualised poster grid — the shared poster-grid
// screen (`@/ui/catalog/PosterGridScreen`) with the Series strings and routes. A card shows the
// number of seasons when known (`Series.seasonCount`, recorded when the details are fetched;
// a sync drops it), else the year. Grid pages read only the series rows.
import { catalogRepo, isProtectedItem, type Series } from '@/core/db';
import { t } from '@/i18n';
import { formatInteger } from '@/ui/catalog/format';
import { PosterGridScreen } from '@/ui/catalog/PosterGridScreen';
import { seriesBrowse } from './browseState';

const loadSeries = (keys: readonly string[]) => catalogRepo.getMany('series', keys);

const externalIdOf = (item: Series) => item.externalId;
const posterOf = (item: Series) => item.cover;
function captionOf(item: Series): string | undefined {
  if (item.seasonCount !== undefined && item.seasonCount > 0) {
    return t.series.seasonCount(item.seasonCount, formatInteger(item.seasonCount));
  }
  return item.year === undefined ? undefined : String(item.year);
}

export function SeriesScreen() {
  return (
    <PosterGridScreen
      type="series"
      base="/series"
      texts={t.series}
      browse={seriesBrowse}
      loadItems={loadSeries}
      externalIdOf={externalIdOf}
      posterOf={posterOf}
      captionOf={captionOf}
      isProtected={isProtectedItem}
      progress={false}
      gridTestId="series-grid"
    />
  );
}
