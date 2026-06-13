import { test, expect } from '@playwright/test';

test('skorpintar login', async ({ page }, testInfo) => {
  await page.goto('https://saas.beta.skorpintar.com/', { waitUntil: 'domcontentloaded' });

  await page.getByRole('textbox', { name: /email/i }).fill('ligar@siapkpr.com');
  await page.getByRole('textbox', { name: /kata sandi/i }).fill('abc123');
  await page.getByRole('button', { name: /^masuk$/i }).click();

  await page.waitForURL('https://saas.beta.skorpintar.com/dashboard', { timeout: 60_000 });
  await expect(page).toHaveURL('https://saas.beta.skorpintar.com/dashboard');

  await page.waitForLoadState('networkidle');

  const screenshotPath = testInfo.outputPath('dashboard-loaded.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach('dashboard-loaded', {
    path: screenshotPath,
    contentType: 'image/png'
  });

  await page.waitForTimeout(5_000);
});
