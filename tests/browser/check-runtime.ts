/** Fail once on missing host libraries rather than reporting every SDK case as failed. */
import { chromium, firefox, webkit } from "@playwright/test"

for (const engine of [chromium, firefox, webkit]) {
  const browser = await engine.launch()
  try {
    const page = await browser.newPage()
    await page.setContent("<title>near-kit browser runtime ready</title>")
    if ((await page.title()) !== "near-kit browser runtime ready") {
      throw new Error(`${engine.name()} did not initialize its page renderer`)
    }
    console.info(`${engine.name()} ${browser.version()}: renderer ready`)
  } finally {
    await browser.close()
  }
}
