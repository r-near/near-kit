---
"near-kit": patch
---

Remove FileKeyStore from keys barrel export to fix browser bundler compatibility

FileKeyStore imports node:fs/promises which causes bundler failures in browser environments.
Users can still import FileKeyStore via the dedicated subpath: `import { FileKeyStore } from "near-kit/keys/file"`
