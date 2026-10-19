import { rmSync } from "node:fs"

// Remove only this package's generated output, including obsolete emitted modules.
rmSync(new URL("../dist", import.meta.url), { recursive: true, force: true })
