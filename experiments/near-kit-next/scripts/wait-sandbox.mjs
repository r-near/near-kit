const deadline = Date.now() + 90_000
for (;;) {
  try {
    const response = await fetch(`${process.env.NEAR_SANDBOX_URL}/status`, {
      signal: AbortSignal.timeout(1000),
    })
    const status = await response.json()
    if (response.ok && status.sync_info.latest_block_height >= 3) {
      console.log(
        JSON.stringify({
          chainId: status.chain_id,
          height: status.sync_info.latest_block_height,
          version: status.version,
        }),
      )
      break
    }
  } catch {}
  if (Date.now() > deadline)
    throw new Error("Sandbox did not become ready; inspect node.log")
  await new Promise((resolve) => setTimeout(resolve, 250))
}
