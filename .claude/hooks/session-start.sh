#!/bin/bash
set -euo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

if ! command -v mise &>/dev/null; then
  curl -fsSL https://mise.run | sh
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
  export PATH="$HOME/.local/bin:$PATH"
fi

mise trust --yes
mise bundle
