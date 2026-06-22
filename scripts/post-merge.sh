#!/bin/bash
# Entry point kept for Replit post-merge hook compatibility.
# Actual logic lives in the cross-platform Node.js script.
set -e
node scripts/post-merge.mjs
