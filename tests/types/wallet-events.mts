// Compile-only compatibility with the installed wallet vendor. Never execute.
import type { NearConnector } from "@hot-labs/near-connect"
import { fromNearConnect } from "near-kit"

export const vendorEvents = (
  connector: NearConnector,
): Pick<Parameters<typeof fromNearConnect>[0], "on" | "off"> => connector
