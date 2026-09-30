import { createRequire } from "node:module"
import { defineConfig } from "vite"
import { rpcFixturePlugin } from "./rpc-server.js"

const require = createRequire(import.meta.url)
const react = process.env["REACT_VERSION"] === "18" ? "react18" : "react"
const dom = process.env["REACT_VERSION"] === "18" ? "react-dom18" : "react-dom"
export default defineConfig({
  plugins: [rpcFixturePlugin()],
  cacheDir: `node_modules/.vite-react${process.env["REACT_VERSION"] === "18" ? "18" : "19"}`,
  resolve: {
    alias: [
      {
        find: "react/jsx-dev-runtime",
        replacement: require.resolve(`${react}/jsx-dev-runtime`),
      },
      {
        find: "react/jsx-runtime",
        replacement: require.resolve(`${react}/jsx-runtime`),
      },
      {
        find: "react-dom/client",
        replacement: require.resolve(`${dom}/client`),
      },
      { find: "react-dom", replacement: require.resolve(dom) },
      { find: "react", replacement: require.resolve(react) },
    ],
  },
})
