import { randomUUID } from "node:crypto"
import { test as base, expect, type Request } from "@playwright/test"
import type { RpcSnapshot } from "./rpc-server.js"
import type {} from "./app.js"

interface BrowserRequest {
  ordinal: number
  body: unknown
  status?: number
  finished: boolean
  failure?: string
}
export const test = base.extend<{
  rpc: {
    url: string
    configure(scenario: string): Promise<void>
    snapshot(): Promise<RpcSnapshot>
    release(id: string): Promise<void>
  }
}>({
  rpc: async ({ request, baseURL }, use, testInfo) => {
    if (!baseURL)
      throw new Error("The browser fixture requires a local baseURL")
    const id = randomUUID()
    const control = `${baseURL}/__test/${id}`
    const configure = async (scenario: string) => {
      // Only the idempotent admin channel retries ECONNRESET, never SDK fetch.
      const response = await request.post(control, {
        data: { scenario, configurationId: randomUUID() },
        maxRetries: 2,
      })
      expect(response.ok()).toBe(true)
    }
    const snapshot = async (): Promise<RpcSnapshot> => {
      const response = await request.get(control, { maxRetries: 2 })
      expect(response.ok()).toBe(true)
      return response.json() as Promise<RpcSnapshot>
    }
    await configure("default")
    try {
      await use({
        url: `${baseURL}/rpc/${id}`,
        configure,
        snapshot,
        release: async (heldId) => {
          const response = await request.post(`${control}/release`, {
            data: { id: heldId },
            maxRetries: 2,
          })
          expect(response.ok()).toBe(true)
        },
      })
    } finally {
      const state = await snapshot()
      if (
        testInfo.status !== testInfo.expectedStatus ||
        state.scenario.startsWith("lost-")
      ) {
        await testInfo.attach("rpc-server-deliveries", {
          body: JSON.stringify(state, null, 2),
          contentType: "application/json",
        })
      }
      await request.delete(control)
    }
  },
  page: async ({ page, baseURL, rpc }, use, testInfo) => {
    const failures: string[] = []
    const localSocket = new URL(rpc.url)
    localSocket.protocol = "ws:"
    const traffic = new Map<Request, BrowserRequest>()
    page.on("pageerror", (error) => failures.push(error.message))
    page.on("console", (message) => {
      if (message.text().startsWith("Fixture CSP violation:"))
        failures.push(message.text())
    })
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (event) => {
        console.error(
          `Fixture CSP violation: ${event.effectiveDirective} ${event.blockedURI}`,
        )
      })
    })
    // Observe only. Routing interception can change the browser's own retry behavior.
    page.on("request", (request) => {
      const url = new URL(request.url())
      if (url.origin !== baseURL && url.origin !== localSocket.origin)
        failures.push(`Unexpected external request: ${url.origin}`)
      if (request.url() === rpc.url)
        traffic.set(request, {
          ordinal: traffic.size + 1,
          body: request.postDataJSON() as unknown,
          finished: false,
        })
    })
    page.on("response", (response) => {
      const observed = traffic.get(response.request())
      if (observed) observed.status = response.status()
    })
    page.on("requestfinished", (request) => {
      const observed = traffic.get(request)
      if (observed) observed.finished = true
    })
    page.on("requestfailed", (request) => {
      const observed = traffic.get(request)
      if (observed)
        observed.failure =
          request.failure()?.errorText ?? "Unknown transport failure"
    })
    await page.goto("/tests/browser/")
    await page.waitForFunction(() => Boolean(window.kit))
    try {
      await use(page)
    } finally {
      const state = await rpc.snapshot()
      if (
        failures.length > 0 ||
        testInfo.status !== testInfo.expectedStatus ||
        state.scenario.startsWith("lost-")
      ) {
        await testInfo.attach("browser-rpc-observations", {
          body: JSON.stringify([...traffic.values()], null, 2),
          contentType: "application/json",
        })
      }
    }
    expect(
      failures,
      "No browser runtime errors, CSP violations or external network requests",
    ).toEqual([])
  },
})
export { expect }
