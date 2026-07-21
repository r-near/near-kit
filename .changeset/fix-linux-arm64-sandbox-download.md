---
"near-kit": patch
---

Fix sandbox binary download on Linux ARM: map Node's `arm64` arch to the `Linux-aarch64` S3 path (previously produced a `Linux-arm64` URL that returned 403)
