import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const THEMES = ['light', 'dark'] as const;

async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.addInitScript((value) => {
    window.localStorage.setItem('theme', value);
  }, theme);
}

async function goto(page: Page, theme: (typeof THEMES)[number], url: string) {
  await setTheme(page, theme);
  await page.goto(url);
  await expect(page.locator('html')).toHaveClass(
    theme === 'dark' ? /dark/ : /^(?!.*dark).*$/,
  );
}

/**
 * axe reports violations as raw CSS selectors, which aren't useful on their
 * own in a failure list. Resolve each violating node back to the nearest
 * `data-testid` ancestor (our harness sections are all wrapped in one) so a
 * failing test names the actual component, not a selector.
 */
async function componentLabelFor(page: Page, target: string[]): Promise<string> {
  const selector = target[target.length - 1];
  try {
    const label = await page
      .locator(selector)
      .first()
      .evaluate((el) => el.closest('[data-testid]')?.getAttribute('data-testid') ?? null);
    return label ?? selector;
  } catch {
    return selector;
  }
}

async function summarizeViolations(
  page: Page,
  violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations'],
): Promise<string[]> {
  const lines: string[] = [];
  for (const violation of violations) {
    for (const node of violation.nodes) {
      const component = await componentLabelFor(page, node.target as string[]);
      const data = node.any[0]?.data as
        | { fgColor?: string; bgColor?: string; contrastRatio?: number; expectedContrastRatio?: string }
        | undefined;
      const detail = data
        ? `${data.fgColor} on ${data.bgColor} → ${data.contrastRatio}:1 (needs ${data.expectedContrastRatio})`
        : node.failureSummary;
      lines.push(`[${component}] ${detail}`);
    }
  }
  return lines;
}

async function expectNoContrastViolations(page: Page, includeSelector?: string) {
  const builder = new AxeBuilder({ page }).withRules(['color-contrast']);
  if (includeSelector) builder.include(includeSelector);
  const { violations } = await builder.analyze();

  const failures = await summarizeViolations(page, violations);
  expect(failures, failures.join('\n')).toEqual([]);
}

for (const theme of THEMES) {
  test.describe(`contrast harness (${theme} mode)`, () => {
    test(`component harness has no contrast violations`, async ({ page }) => {
      await goto(page, theme, '/contrast-harness');
      await expectNoContrastViolations(page, 'main');
    });
  });

  test.describe(`real pages (${theme} mode)`, () => {
    test(`marketing landing page has no contrast violations`, async ({
      page,
    }) => {
      await goto(page, theme, '/');
      await expectNoContrastViolations(page);
    });

    test(`login page has no contrast violations`, async ({ page }) => {
      await goto(page, theme, '/login');
      await expectNoContrastViolations(page);
    });
  });
}
