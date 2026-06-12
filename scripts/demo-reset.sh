#!/usr/bin/env bash
# `make demo-reset`: restore the exact pre-seeded demo state (BUILD_SPEC §8).
exec "$(dirname "$0")/demo-up.sh"
