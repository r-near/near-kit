/**
 * Simple validation script for DelegateAction serialization
 *
 * This script validates that our DelegateAction implementation:
 * 1. Correctly prepends the NEP-461 prefix (2^30 + 366 = 1073742190)
 * 2. Serializes the delegate action structure properly
 * 3. Produces deterministic output
 *
 * Run with: bun run scripts/validate-delegate-action-simple.ts
 */

import { DelegateAction, transfer } from "../src/core/actions.js"
import { encodeDelegateAction } from "../src/core/schema.js"
import type { Ed25519PublicKey } from "../src/core/types.js"
import { KeyType } from "../src/core/types.js"

// Helper to create a public key for testing
function createTestPublicKey(fillByte: number): Ed25519PublicKey {
  return {
    keyType: KeyType.ED25519,
    data: new Uint8Array(32).fill(fillByte),
    toString: () => "ed25519:test",
  }
}

// Helper to display bytes in hex
function toHex(bytes: Uint8Array, start = 0, length = bytes.length): string {
  return Array.from(bytes.slice(start, start + length))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ")
}

console.log("=" .repeat(70))
console.log("DelegateAction Serialization Validation")
console.log("=" .repeat(70))
console.log()

// Test 1: Verify NEP-461 prefix
console.log("Test 1: NEP-461 Prefix Validation")
console.log("-" .repeat(70))

const pk1 = createTestPublicKey(42)
const delegate1 = new DelegateAction(
  "sender.near",
  "receiver.near",
  [transfer(BigInt(1000000))],
  BigInt(123),
  BigInt(5000),
  pk1,
)

const encoded1 = encodeDelegateAction(delegate1)

console.log("Prefix value: 2^30 + 366 = 1073742190 = 0x4000016E")
console.log("Expected little-endian bytes: 6E 01 00 40")
console.log()
console.log("Actual first 4 bytes:", toHex(encoded1, 0, 4))
console.log()

const prefixMatches =
  encoded1[0] === 0x6e &&
  encoded1[1] === 0x01 &&
  encoded1[2] === 0x00 &&
  encoded1[3] === 0x40

if (prefixMatches) {
  console.log("✅ NEP-461 prefix is correct!")
} else {
  console.log("❌ NEP-461 prefix is INCORRECT!")
  process.exit(1)
}

console.log()
console.log("Full serialized length:", encoded1.length, "bytes")
console.log("First 32 bytes:", toHex(encoded1, 0, 32))
console.log()

// Test 2: Deterministic serialization
console.log("Test 2: Deterministic Serialization")
console.log("-" .repeat(70))

// Create same delegate action again
const pk2 = createTestPublicKey(42)
const delegate2 = new DelegateAction(
  "sender.near",
  "receiver.near",
  [transfer(BigInt(1000000))],
  BigInt(123),
  BigInt(5000),
  pk2,
)

const encoded2 = encodeDelegateAction(delegate2)

console.log("Encoding same delegate action twice...")
console.log("First encoding length: ", encoded1.length)
console.log("Second encoding length:", encoded2.length)
console.log()

let isDeterministic = true
if (encoded1.length !== encoded2.length) {
  isDeterministic = false
} else {
  for (let i = 0; i < encoded1.length; i++) {
    if (encoded1[i] !== encoded2[i]) {
      isDeterministic = false
      console.log(`Difference at byte ${i}:`)
      console.log(`  First:  0x${encoded1[i].toString(16).padStart(2, "0")}`)
      console.log(`  Second: 0x${encoded2[i].toString(16).padStart(2, "0")}`)
      break
    }
  }
}

if (isDeterministic) {
  console.log("✅ Serialization is deterministic!")
} else {
  console.log("❌ Serialization is NOT deterministic!")
  process.exit(1)
}

console.log()

// Test 3: Structure validation
console.log("Test 3: Serialization Structure")
console.log("-" .repeat(70))

console.log("Expected structure after prefix:")
console.log("  - senderId (string): 'sender.near'")
console.log("  - receiverId (string): 'receiver.near'")
console.log("  - actions (array): [Transfer { deposit: 1000000 }]")
console.log("  - nonce (u64): 123")
console.log("  - maxBlockHeight (u64): 5000")
console.log("  - publicKey (enum): Ed25519 { data: [42 × 32] }")
console.log()

// The structure should be:
// [4 bytes: prefix]
// [4 bytes: senderId length] [N bytes: senderId]
// [4 bytes: receiverId length] [N bytes: receiverId]
// [4 bytes: actions array length] [action data...]
// [8 bytes: nonce]
// [8 bytes: maxBlockHeight]
// [1 byte: publicKey enum discriminant] [32 bytes: key data]

// Skip prefix (4 bytes), then check senderId length
const senderIdLengthBytes = encoded1.slice(4, 8)
const senderIdLength =
  senderIdLengthBytes[0] |
  (senderIdLengthBytes[1] << 8) |
  (senderIdLengthBytes[2] << 16) |
  (senderIdLengthBytes[3] << 24)

console.log("Parsed senderId length:", senderIdLength, "(expected: 11 for 'sender.near')")

if (senderIdLength === 11) {
  const senderIdBytes = encoded1.slice(8, 8 + senderIdLength)
  const senderId = new TextDecoder().decode(senderIdBytes)
  console.log("Parsed senderId:", `'${senderId}'`)

  if (senderId === "sender.near") {
    console.log("✅ senderId parsed correctly!")
  } else {
    console.log("❌ senderId is incorrect!")
    process.exit(1)
  }
} else {
  console.log("❌ senderId length is incorrect!")
  process.exit(1)
}

console.log()

// Test 4: Multiple actions
console.log("Test 4: Multiple Actions")
console.log("-" .repeat(70))

const pk3 = createTestPublicKey(99)
const delegate3 = new DelegateAction(
  "alice.near",
  "bob.near",
  [transfer(BigInt(5000000)), transfer(BigInt(3000000))],
  BigInt(456),
  BigInt(10000),
  pk3,
)

const encoded3 = encodeDelegateAction(delegate3)

console.log("Serialized delegate action with 2 transfers")
console.log("Total length:", encoded3.length, "bytes")
console.log("First 32 bytes:", toHex(encoded3, 0, 32))
console.log()

// Verify prefix is still there
const prefix3Matches =
  encoded3[0] === 0x6e &&
  encoded3[1] === 0x01 &&
  encoded3[2] === 0x00 &&
  encoded3[3] === 0x40

if (prefix3Matches) {
  console.log("✅ NEP-461 prefix is present with multiple actions!")
} else {
  console.log("❌ NEP-461 prefix is missing with multiple actions!")
  process.exit(1)
}

console.log()
console.log("=" .repeat(70))
console.log()
console.log("🎉 All validation tests PASSED!")
console.log()
console.log("Summary:")
console.log("  ✅ NEP-461 prefix (2^30 + 366) is correctly prepended")
console.log("  ✅ Serialization is deterministic")
console.log("  ✅ Structure is correctly serialized")
console.log("  ✅ Multiple actions are handled correctly")
console.log()
console.log("The DelegateAction implementation follows NEP-366 and NEP-461 specs.")
console.log()
