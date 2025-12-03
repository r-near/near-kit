#!/bin/bash
# Environment setup for GitHub Copilot coding agent
# This script runs in the Copilot agent's container to set up the development environment

set -e

# Install Node.js (required for Vitest test runner)
# Using Node Version Manager for flexible version management
curl -fsSL https://fnm.vercel.app/install | bash
export PATH="$HOME/.local/share/fnm:$PATH"
eval "$(fnm env)"
fnm install 24
fnm use 24

# Install Bun (primary package manager and runtime)
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"

# Install project dependencies
bun install
