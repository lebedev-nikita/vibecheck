set shell := ["bash", "-euo", "pipefail", "-c"]

# List the recipes
default:
    @just --list

# Install the pinned tools and dependencies
install:
    mise install
    vp install

# Build the extension into dist/, ready for "Load unpacked"
build:
    rm -rf dist
    vp build

# Rebuild dist/ on every change; reload the extension in chrome://extensions
dev:
    rm -rf dist
    vp build --watch

# Format, lint and type-check
check:
    vp check

# Apply formatting and lint fixes
fix:
    vp check --fix

# Unit tests
test:
    vp test

# Unused code, duplication and complexity
analyze:
    vp exec fallow

# The built extension in Chrome for Testing against a mock provider
e2e: build
    vp exec playwright install chromium
    vpx e2e/restyle.e2e.ts

# Everything CI runs
ci: check test analyze e2e

# Render assets/icon.svg into public/icons
icons:
    vpx scripts/+icons.ts

# Zip dist/ for upload to the Chrome Web Store
package: build
    cd dist && zip -qr "../vibecheck-$(jq -r .version manifest.json).zip" .
