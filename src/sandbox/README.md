# NEAR Sandbox

Local NEAR blockchain for testing.

## What You Get

- Root account: `test.near` (accessible via `sandbox.rootAccount`)
- Initial balance: 1,000,000,000 NEAR
- Fresh blockchain state (block height 0)

## Usage

```typescript
import { Near, Sandbox } from 'near-kit';

const sandbox = await Sandbox.start();
const near = new Near({ network: sandbox });
// ... run tests
await sandbox.stop();
```

**With test frameworks:**

```typescript
import { beforeAll, afterAll, test } from 'bun:test';

let sandbox: Sandbox;
let near: Near;

beforeAll(async () => {
  sandbox = await Sandbox.start();
  near = new Near({ network: sandbox });
});

afterAll(async () => {
  await sandbox.stop();
});

test('my test', async () => {
  const balance = await near.getBalance(sandbox.rootAccount.id);
  expect(balance).toBeDefined();
});
```

## System Requirements

**File descriptor limit ≥65,535** is required. Check with:
```bash
ulimit -n
```

**Linux:** Add to `/etc/security/limits.conf`:
```
* soft nofile 65535
* hard nofile 65535
```

**macOS:**
```bash
sudo launchctl limit maxfiles 65536 200000
```

**Docker:**
```bash
docker run --ulimit nofile=65535:65535 ...
```

## API

### `Sandbox.start(options?)`

Start a sandbox instance.

- `options.version?: string` - Sandbox version (default: `'2.9.0'`)
- Returns: `Promise<Sandbox>`

### `sandbox.stop()`

Stop the sandbox and clean up.

### Properties

- `rpcUrl: string` - RPC endpoint (e.g., `http://127.0.0.1:38291`)
- `networkId: string` - Network ID (`'localnet'`)
- `rootAccount: { id: string, secretKey: string }` - Root account

## Multiple Instances

```typescript
const sb1 = await Sandbox.start();
const sb2 = await Sandbox.start();
// ... use independently
await sb1.stop();
await sb2.stop();
```

## Troubleshooting

**"couldn't set the file descriptor limit" error:**
- Increase your system's file descriptor limit (see System Requirements)

**Binary download fails:**
- Check internet connection and access to: `https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore`

**Binary location:** `~/.near-kit/sandbox/bin/`
