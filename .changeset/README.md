# Changesets

This directory is used by [changesets](https://github.com/changesets/changesets) to manage versioning and changelogs.

## Usage

When you make changes that should be included in the next release:

```bash
# Create a new changeset
bun changeset
```

This will prompt you to:
1. Select the type of change (patch, minor, major)
2. Write a summary of the changes

The changeset files in this directory will be consumed when a release is created.

## Release Process

The release process is automated via GitHub Actions:

1. When changesets are committed to `main`, a "Version Packages" PR is automatically created
2. This PR updates version numbers and CHANGELOG.md files based on the changesets
3. When the PR is merged, the package is automatically published to npm

## Manual Release

If needed, you can manually release:

```bash
bun run release
```

This will build the package and publish it to npm (requires NPM_TOKEN).
