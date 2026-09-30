import { randomUUID } from "node:crypto"
import { test as base, expect } from "@playwright/test"
import type { RpcSnapshot } from "./rpc-server.js"
import type {} from "./app.js"

export const test = base.extend<{
  rpc: {
    url: string
    configure(scenario: string): Promise<void>
    snapshot(): Promise<RpcSnapshot>
    release(id: string): Promise<void>
  }
}>({
  rpc: async ({ request, baseURL }, use) => {
    if (!baseURL)
      throw new Error("The browser fixture requires a local baseURL")
    const id = randomUUID()
    const control = `${baseURL}/__test/${id}`
    const configure = async (scenario: string) => {
      const response = await request.post(control, { data: { scenario } })
      expect(response.ok()).toBe(true)
    }
    await configure("default")
    await use({
      url: `${baseURL}/rpc/${id}`,
      configure,
      snapshot: async () => {
        const response = await request.get(control)
        expect(response.ok()).toBe(true)
        return response.json() as Promise<RpcSnapshot>
      },
      release: async (heldId) => {
        const response = await request.post(`${control}/release`, {
          data: { id: heldId },
        })
        expect(response.ok()).toBe(true)
      },
    })
    await request.delete(control)
  },
  page: async ({ page, baseURL }, use) => {
    const failures: string[] = []
    page.on("pageerror", (error) => failures.push(error.message))
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url())
      if (url.origin === baseURL) return route.continue()
      failures.push(`Unexpected external request: ${url.origin}`)
      return route.abort("blockedbyclient")
    })
    await page.goto("/tests/browser/")
    await page.waitForFunction(() => Boolean(window.kit))
    await use(page)
    expect(
      failures,
      "No browser runtime errors or external network requests",
    ).toEqual([])
  },
})
export { expect }
