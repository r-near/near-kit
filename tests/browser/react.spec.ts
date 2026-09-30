import { test, expect } from "./test.js"

test.describe("React browser lifecycle through real HTTP and SDK clients", () => {
  test("superseded reads abort their HTTP request and cannot replace the newer result", async ({
    page,
    rpc,
  }) => {
    await rpc.configure("held-reads")
    await page.evaluate((url) => window.kit.mountReactFixture(url), rpc.url)
    await expect(page.getByTestId("read-state")).toContainText('"data":"fast"')
    await page.getByRole("button", { name: "Read slow", exact: true }).click()
    await expect
      .poll(
        async () =>
          (await rpc.snapshot()).reads.filter((read) => read.id === "slow")
            .length,
      )
      .toBe(1)
    await page.getByRole("button", { name: "Read fast", exact: true }).click()
    await expect(page.getByTestId("read-state")).toContainText('"data":"fast"')
    await expect(page.getByTestId("read-state")).toContainText(
      '"loading":false',
    )
    await expect
      .poll(
        async () =>
          (await rpc.snapshot()).reads.find((read) => read.id === "slow")
            ?.aborted,
      )
      .toBe(true)
    await rpc.release("slow")
    await page.getByRole("button", { name: "Refetch", exact: true }).click()
    await expect(page.getByTestId("read-state")).toContainText('"data":"fast"')
    await expect(page.getByTestId("read-state")).toContainText(
      '"loading":false',
    )
  })

  test("unmount closes an unfinished HTTP response body and remount can read again", async ({
    page,
    rpc,
  }) => {
    await rpc.configure("stream-read")
    await page.evaluate((url) => window.kit.mountReactFixture(url), rpc.url)
    await expect(page.getByTestId("read-state")).toContainText('"data":"fast"')
    const responseHeaders = page.waitForResponse(
      (response) => response.url() === rpc.url,
    )
    await page.getByRole("button", { name: "Read slow", exact: true }).click()
    expect((await responseHeaders).status()).toBe(200)
    await page
      .getByRole("button", { name: "Unmount read", exact: true })
      .click()
    await expect(page.getByTestId("read-state")).toHaveCount(0)
    await expect
      .poll(
        async () =>
          (await rpc.snapshot()).reads.find((read) => read.id === "slow")
            ?.aborted,
      )
      .toBe(true)
    await rpc.configure("default")
    await page
      .getByRole("button", { name: "Remount read", exact: true })
      .click()
    await expect(page.getByTestId("read-state")).toContainText('"data":"fast"')
  })

  test("malformed RPC data is visible as an error and a refetch recovers", async ({
    page,
    rpc,
  }) => {
    await rpc.configure("malformed")
    await page.evaluate((url) => window.kit.mountReactFixture(url), rpc.url)
    await expect(page.getByTestId("read-state")).toContainText('"error":')
    await expect(page.getByTestId("read-state")).toContainText(
      '"loading":false',
    )
    await rpc.configure("default")
    await page.getByRole("button", { name: "Refetch", exact: true }).click()
    await expect(page.getByTestId("read-state")).toContainText('"data":"fast"')
    await expect(page.getByTestId("read-state")).not.toContainText('"error":')
  })

  for (const authority of ["keyStore", "wallet"] as const) {
    test(`replacing the ${authority} changes the actual NEP-413 signing authority`, async ({
      page,
      rpc,
    }) => {
      await page.evaluate((url) => window.kit.mountReactFixture(url), rpc.url)
      await page.getByLabel("Authority mode").selectOption(authority)
      const original = await page
        .getByTestId("expected-original-key")
        .innerText()
      const replacement = await page
        .getByTestId("expected-replacement-key")
        .innerText()
      expect(original).not.toBe(replacement)
      await page
        .getByRole("button", { name: "Sign message", exact: true })
        .click()
      await expect(page.getByTestId("signed-result")).toContainText(original)
      await expect(page.getByTestId("signed-result")).toContainText(
        '"verified":true',
      )
      await page
        .getByRole("button", { name: "Replace authority", exact: true })
        .click()
      await page
        .getByRole("button", { name: "Sign message", exact: true })
        .click()
      await expect(page.getByTestId("signed-result")).toContainText(replacement)
      await expect(page.getByTestId("signed-result")).toContainText(
        '"verified":true',
      )
      await expect(page.getByTestId("signing-error")).toHaveText("")
      expect((await rpc.snapshot()).submissions).toHaveLength(0)
    })
  }

  test("replacing a signer callback changes the next real transaction signing operation", async ({
    page,
    rpc,
  }) => {
    await page.evaluate((url) => window.kit.mountReactFixture(url), rpc.url)
    await page.getByLabel("Authority mode").selectOption("signer")
    await page
      .getByRole("button", { name: "Sign transaction", exact: true })
      .click()
    await expect(page.getByTestId("signer-calls")).toHaveText('["original"]')
    await expect(page.getByTestId("signed-result")).toContainText('"hash":')
    await page
      .getByRole("button", { name: "Replace authority", exact: true })
      .click()
    await page
      .getByRole("button", { name: "Sign transaction", exact: true })
      .click()
    await expect(page.getByTestId("signer-calls")).toHaveText(
      '["original","replacement"]',
    )
    await expect(page.getByTestId("signing-error")).toHaveText("")
    expect((await rpc.snapshot()).submissions).toHaveLength(0)
  })

  test("out-of-order mutation responses keep individual Promise results and publish only the latest", async ({
    page,
    rpc,
  }) => {
    await rpc.configure("mutation-hold")
    await page.evaluate((url) => window.kit.mountReactFixture(url), rpc.url)
    await page
      .getByRole("button", { name: "Mutate first", exact: true })
      .click()
    await expect
      .poll(async () => (await rpc.snapshot()).submissions.length)
      .toBe(1)
    await page
      .getByRole("button", { name: "Mutate second", exact: true })
      .click()
    await expect
      .poll(async () => (await rpc.snapshot()).submissions.length)
      .toBe(2)
    const submissions = (await rpc.snapshot()).submissions
    const first = submissions[0]?.hash
    const second = submissions[1]?.hash
    if (!first || !second)
      throw new Error("Expected two independently observed submissions")
    expect(first).not.toBe(second)
    await rpc.release("second")
    await expect(page.getByTestId("mutation-state")).toContainText(second)
    await expect(page.getByTestId("mutation-outcomes")).toContainText(second)
    await rpc.release("first")
    await expect(page.getByTestId("mutation-outcomes")).toContainText(first)
    await expect(page.getByTestId("mutation-state")).toContainText(second)
    await expect(page.getByTestId("mutation-state")).not.toContainText(first)
    expect((await rpc.snapshot()).accepted).toBe(2)
  })

  for (const disconnect of ["Reset mutation", "Unmount mutation"] as const) {
    test(`${disconnect} does not cancel a submitted mutation or its caller-owned Promise`, async ({
      page,
      rpc,
    }) => {
      await rpc.configure("mutation-hold")
      await page.evaluate((url) => window.kit.mountReactFixture(url), rpc.url)
      await page
        .getByRole("button", { name: "Mutate first", exact: true })
        .click()
      await expect.poll(async () => (await rpc.snapshot()).accepted).toBe(1)
      const first = (await rpc.snapshot()).submissions[0]?.hash
      if (!first) throw new Error("Expected observed signed transaction")
      await page.getByRole("button", { name: disconnect, exact: true }).click()
      await rpc.release("first")
      await expect(page.getByTestId("mutation-outcomes")).toContainText(first)
      if (disconnect === "Reset mutation") {
        await expect(page.getByTestId("mutation-state")).toHaveText(
          '{"pending":false,"success":false}',
        )
      } else {
        await expect(page.getByTestId("mutation-state")).toHaveCount(0)
        await page
          .getByRole("button", { name: "Remount mutation", exact: true })
          .click()
        await expect(page.getByTestId("mutation-state")).toHaveText(
          '{"pending":false,"success":false}',
        )
      }
      expect((await rpc.snapshot()).accepted).toBe(1)
      expect((await rpc.snapshot()).submissions).toHaveLength(1)
    })
  }
})
