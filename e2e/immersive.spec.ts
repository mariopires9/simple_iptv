// PLY-09: on a phone turned to landscape, the open player covers the viewport (CSS
// "pseudo-fullscreen") and the app shell is hidden and inert; portrait restores the layout.
import { addXtreamSource } from './support/app';
import { expect, test } from './support/test';

test('PLY-09: rotating a phone to landscape makes the player immersive', async ({ page }) => {
  test.skip(test.info().project.name !== 'chromium-mobile', 'touch phone emulation (Pixel 7)');

  await addXtreamSource(page); // ends on Live TV with the channel rows visible
  await page.getByRole('option', { name: /Example News HD/ }).click();
  const player = page.getByRole('region', { name: 'Player: Example News HD' });
  await expect(player).toBeVisible();
  const header = page.locator('header').first();
  await expect(header).toBeVisible();

  await page.setViewportSize({ width: 915, height: 412 });
  await expect(player).toHaveAttribute('data-immersive', 'true');
  const box = await player.boundingBox();
  expect(box).toEqual({ x: 0, y: 0, width: 915, height: 412 });
  await expect(header).toBeHidden();
  await expect(header).toHaveAttribute('inert', '');
  // Still the same named region for assistive technologies.
  await expect(page.getByRole('region', { name: 'Player: Example News HD' })).toBeVisible();

  await page.setViewportSize({ width: 412, height: 915 });
  await expect(player).not.toHaveAttribute('data-immersive');
  await expect(header).toBeVisible();
  await expect(header).not.toHaveAttribute('inert');
});
