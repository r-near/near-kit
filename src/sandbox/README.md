# NEAR Sandbox

Local NEAR blockchain for testing and development.

## Quick Start

```typescript
import { Near, Sandbox } from '@near/client';

// Start sandbox
const sandbox = await Sandbox.start();

// Use with Near client
const near = new Near({ network: sandbox });

// ... run your tests

// Clean up
await sandbox.stop();
```

## System Requirements

The NEAR sandbox requires the following system configuration:

### File Descriptor Limits

The sandbox binary requires at least **65,535** file descriptors. You can check your current limit:

```bash
ulimit -n
```

If the limit is lower than 65,535, you'll need to increase it:

**On Linux:**

Add to `/etc/security/limits.conf`:
```
* soft nofile 65535
* hard nofile 65535
```

Then log out and back in.

**On macOS:**

```bash
sudo launchctl limit maxfiles 65536 200000
```

**For Docker/Containerized Environments:**

Add to your `docker-compose.yml` or `Dockerfile`:
```yaml
ulimits:
  nofile:
    soft: 65535
    hard: 65535
```

Or use `--ulimit nofile=65535:65535` when running `docker run`.

## Usage

### Basic Testing

```typescript
import { beforeAll, afterAll, test } from 'bun:test';
import { Near, Sandbox } from '@near/client';

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
  console.log(`Root account: ${balance} NEAR`);
});
```

### Multiple Instances

You can run multiple sandbox instances in parallel for isolated testing:

```typescript
const sandbox1 = await Sandbox.start();
const sandbox2 = await Sandbox.start();

const near1 = new Near({ network: sandbox1 });
const near2 = new Near({ network: sandbox2 });

// ... use them independently

await sandbox1.stop();
await sandbox2.stop();
```

### Specific Version

```typescript
const sandbox = await Sandbox.start({ version: '2.9.0' });
```

## API

### `Sandbox.start(options?)`

Start a new sandbox instance.

**Options:**
- `version?: string` - Sandbox version (default: `'2.9.0'`)

**Returns:** `Promise<Sandbox>`

### `sandbox.stop()`

Stop the sandbox and clean up temporary files.

**Returns:** `Promise<void>`

### Properties

- `rpcUrl: string` - RPC endpoint URL (e.g., `http://127.0.0.1:38291`)
- `networkId: string` - Network ID (always `'localnet'`)
- `rootAccount: { id: string, secretKey: string }` - Root account credentials

## How It Works

1. **Binary Download**: On first use, the sandbox binary is downloaded from S3 to `~/.near-kit/sandbox/bin/`
2. **Initialization**: A temporary directory is created and the sandbox is initialized with `chain-id=localnet`
3. **Startup**: The sandbox process starts on an auto-assigned port
4. **Ready**: The library waits for the RPC endpoint to respond before returning
5. **Cleanup**: On `stop()`, the process is killed and temporary files are removed

## Troubleshooting

### "couldn't set the file descriptor limit" Error

```
Error: couldn't set the file descriptor limit to (65535, 65535)
```

**Solution:** Increase your system's file descriptor limit (see System Requirements above).

### Port Already in Use

The sandbox automatically finds an available port, so this should not happen. If it does, it's a bug.

### Binary Download Fails

Check your internet connection and that you can access S3:
```
https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore
```

### Sandbox Won't Start

Check that the binary is executable:
```bash
ls -la ~/.near-kit/sandbox/bin/
chmod +x ~/.near-kit/sandbox/bin/near-sandbox-*
```

## Design Philosophy

The sandbox implementation follows the library's core principles:

- **Simple things should be simple** - One line to start, one line to stop
- **Explicit over implicit** - You control when to start/stop
- **Progressive complexity** - Basic usage is trivial, advanced features available when needed
- **Clean integration** - Works seamlessly with the `Near` client class

## Comparison with Old Implementation

The original sandbox implementation had 400+ lines and complex abstractions:

- ❌ Singleton pattern with global state
- ❌ Complex port management with manual ranges
- ❌ Many configuration options
- ❌ Multiple helper functions and exports

The new implementation is **~150 lines** with a simpler design:

- ✅ Simple class-based API
- ✅ OS-assigned ports (no conflicts)
- ✅ Minimal options (just `version`)
- ✅ Direct integration with `Near` client
- ✅ Support for multiple concurrent instances
