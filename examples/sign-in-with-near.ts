/**
 * Sign In with NEAR (NEP-413 Message Signing)
 *
 * Gasless authentication using cryptographic signatures.
 * Users prove account ownership without paying gas fees.
 */

import { hex } from "@scure/base"
import {
  generateNonce,
  Near,
  type PrivateKey,
  type SignedMessage,
  type SignMessageParams,
  verifyNep413Signature,
} from "../src/index.js"

const ACCOUNT_ID = process.env["NEAR_ACCOUNT_ID"] || "user.testnet"
const PRIVATE_KEY = (process.env["NEAR_PRIVATE_KEY"] ||
  "ed25519:...") as PrivateKey

// ============================================================================
// Client Side: Sign authentication message
// ============================================================================

async function clientSignMessage() {
  const near = new Near({
    network: "testnet",
    privateKey: PRIVATE_KEY,
    defaultSignerId: ACCOUNT_ID,
  })

  // Generate a random nonce for replay protection
  const nonce = generateNonce()

  // Sign the message (no gas cost)
  const signedMessage = await near.signMessage({
    message: "Sign in to My App",
    recipient: "myapp.com",
    nonce,
  })

  console.log("Client signed message:", signedMessage.accountId)
  console.log("Nonce (hex for HTTP):", hex.encode(nonce))

  // Send to server for verification
  // In production:
  //   await fetch('/api/login', {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json' },
  //     body: JSON.stringify({
  //       signedMessage,
  //       message: 'Sign in to My App',
  //       recipient: 'myapp.com',
  //       nonce: hex.encode(nonce)
  //     })
  //   })

  return { signedMessage, nonce }
}

// ============================================================================
// Server Side: Verify signature
// ============================================================================

// In production, this would be an HTTP handler:
// app.post('/api/login', async (req, res) => {
//   const { signedMessage, message, recipient, nonce } = req.body
//   const params = { message, recipient, nonce: hex.decode(nonce) }
//   const isValid = await verifyNep413Signature(signedMessage, params, { near })
//   ...
// })

function serverVerifySignature(
  signedMessage: SignedMessage,
  params: SignMessageParams,
): boolean {
  // Verify the signature matches the message
  const isValid = verifyNep413Signature(signedMessage, params)

  if (!isValid) {
    console.log("Invalid signature")
    return false
  }

  // Check nonce hasn't been used before (store in database)
  // const nonceHex = hex.encode(params.nonce)
  // if (await db.nonceExists(nonceHex)) {
  //   console.log("Nonce already used (replay attack)")
  //   return false
  // }
  // await db.storeNonce(nonceHex)

  console.log("Signature valid for account:", signedMessage.accountId)

  // Issue session token
  // const token = createJWT({ accountId: signedMessage.accountId })
  // return { success: true, token }

  return true
}

// ============================================================================
// Complete authentication flow
// ============================================================================

async function main() {
  console.log("Sign In with NEAR Example\n")

  // 1. Client signs message
  const { signedMessage, nonce } = await clientSignMessage()

  // 2. Server verifies signature
  const params: SignMessageParams = {
    message: "Sign in to My App",
    recipient: "myapp.com",
    nonce,
  }
  const isValid = serverVerifySignature(signedMessage, params)

  console.log("\nAuthentication:", isValid ? "SUCCESS" : "FAILED")
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}

export { clientSignMessage, serverVerifySignature }
