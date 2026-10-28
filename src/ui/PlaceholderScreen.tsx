// Placeholder screen used by the routing skeleton (FND-04) until each feature story replaces it:
// title, an optional detail line (e.g. the route parameter) and an empty-state text.
import Typography from '@mui/material/Typography';

export interface PlaceholderScreenProps {
  title: string;
  message: string;
  /** Already-translated detail line, e.g. `t.routes.categoryLabel(categoryId)`. */
  detail?: string | undefined;
}

export function PlaceholderScreen({ title, message, detail }: PlaceholderScreenProps) {
  return (
    <>
      <Typography variant="h1">{title}</Typography>
      {detail !== undefined && <Typography>{detail}</Typography>}
      <Typography color="text.secondary">{message}</Typography>
    </>
  );
}
