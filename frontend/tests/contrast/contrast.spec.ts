import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const THEMES = ['light', 'dark'] as const;

async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.addInitScript((value) => {
    window.localStorage.setItem('theme', value);
  }, theme);
}

for (const theme of THEMES) {
  test.describe(`contrast harness (${theme} mode)`, () => {
    test.beforeEach(async ({ page }) => {
      await setTheme(page, theme);
      await page.goto('/contrast-harness');
      await expect(page.locator('html')).toHaveClass(
        theme === 'dark' ? /dark/ : /^(?!.*dark).*$/,
      );
    });

    test('deployment status badges have no contrast violations', async ({
      page,
    }) => {
      const results = await new AxeBuilder({ page })
        .include('[data-testid="deployment-status-badges"]')
        .withRules(['color-contrast'])
        .analyze();

      expect(results.violations, JSON.stringify(results.violations, null, 2))
        .toEqual([]);
    });

    test('model metadata chips have no contrast violations', async ({
      page,
    }) => {
      const results = await new AxeBuilder({ page })
        .include('[data-testid="model-metadata-chips"]')
        .withRules(['color-contrast'])
        .analyze();

      expect(results.violations, JSON.stringify(results.violations, null, 2))
        .toEqual([]);
    });
  });
}
