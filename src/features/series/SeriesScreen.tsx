// Series screen (SER-01): categories, sort and the virtualised poster grid — the shared poster-grid
// screen (`@/ui/catalog/PosterGridScreen`) with the Series strings and routes. A card shows the
// number of seasons when known (details already fetched and cached), else the year.
import { catalogRepo, type Series } from '@/core/db';
import { t } from '@/i18n';
import { formatInteger } from '@/ui/catalog/format';
import { PosterGridScreen } from '@/ui/catalog/PosterGridScreen';
import { seriesBrowse } from './browseState';

/** A grid card: the series and its number of seasons, when known. */
export interface SeriesCard extends Series {
  seasonCount?: number;
}

export async function loadSeriesCards(keys: readonly string[]): Promise<SeriesCard[]> {
  const [items, details] = await Promise.all([
    catalogRepo.getMany('series', keys),
    catalogRepo.getSeriesDetailsMany(keys),
  ]);
  const seasons = new Map(details.flatMap((d) => (d ? [[d.seriesKey, d.seasons.length]] : [])));
  return items.map((item) => {
    const count = seasons.get(item.key);
    return count !== undefined && count > 0 ? { ...item, seasonCount: count } : item;
  });
}

const externalIdOf = (item: SeriesCard) => item.externalId;
const posterOf = (item: SeriesCard) => item.cover;
function captionOf(item: SeriesCard): string | undefined {
  if (item.seasonCount !== undefined) {
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
      loadItems={loadSeriesCards}
      externalIdOf={externalIdOf}
      posterOf={posterOf}
      captionOf={captionOf}
      progress={false}
      gridTestId="series-grid"
    />
  );
}
