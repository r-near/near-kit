import vm from "node:vm"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
const source = await readFile(
  resolve(process.argv[2] ?? "browser-acceptance/smoke.js"),
  "utf8",
)
let text = ""
let finish
const completed = new Promise((r) => (finish = r))
const document = {
  title: "",
  body: {
    set textContent(v) {
      text = String(v)
      finish()
    },
    get textContent() {
      return text
    },
  },
}
const context = vm.createContext({
  document,
  console,
  TextEncoder,
  TextDecoder,
  URL,
  URLSearchParams,
  Headers,
  Request,
  Response,
  AbortController,
  AbortSignal,
  ReadableStream,
  WritableStream,
  TransformStream,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  queueMicrotask,
  crypto: globalThis.crypto,
})
const module = new vm.SourceTextModule(source, { context })
await module.link(() => {
  throw Error("Unexpected unresolved browser import")
})
await module.evaluate()
let timer
try {
  await Promise.race([
    completed,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error("Browser smoke timed out")), 10000)
    }),
  ])
} finally {
  clearTimeout(timer)
}
console.log(document.title)
console.log(text)
if (!text.startsWith("{") || !JSON.parse(text).ok) process.exitCode = 1
