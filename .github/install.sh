#!/bin/sh
set -eu

REPO="tvararu/tuicraft"
INSTALL_DIR="${TUICRAFT_INSTALL_DIR:-/usr/local/bin}"

main() {
    platform="$(detect_platform)"
    arch="$(detect_arch)"
    fetch_cmd="$(detect_fetch)"

    printf "Detected: %s-%s\n" "$platform" "$arch" >&2

    api="https://api.github.com/repos/${REPO}/releases/latest"
    tag="$($fetch_cmd "$api" \
        | grep '"tag_name"' \
        | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')"

    if [ -z "$tag" ]; then
        printf "Error: failed to fetch latest release\n" >&2
        exit 1
    fi

    base="https://github.com/${REPO}/releases/download"
    url="${base}/${tag}/tuicraft-${platform}-${arch}"
    tmpfile="$(mktemp)"
    trap 'rm -f "$tmpfile"' EXIT

    printf "Downloading %s\n" "$url" >&2
    $fetch_cmd "$url" > "$tmpfile"
    chmod +x "$tmpfile"

    if [ -w "$INSTALL_DIR" ]; then
        mv "$tmpfile" "${INSTALL_DIR}/tuicraft"
    elif command -v sudo >/dev/null 2>&1; then
        sudo mv "$tmpfile" "${INSTALL_DIR}/tuicraft"
    else
        printf "Error: %s is not writable" "$INSTALL_DIR" >&2
        printf " and sudo is not available\n" >&2
        printf "Set TUICRAFT_INSTALL_DIR to a " >&2
        printf "writable directory\n" >&2
        exit 1
    fi

    printf "Installed tuicraft (%s) to %s\n" \
        "$tag" "${INSTALL_DIR}/tuicraft" >&2

    case ":${PATH}:" in
        *":${INSTALL_DIR}:"*) ;;
        *)
            printf "Warning: %s is not in PATH\n" \
                "$INSTALL_DIR" >&2
            ;;
    esac
}

detect_platform() {
    case "$(uname -s)" in
        Linux) printf "linux" ;;
        Darwin) printf "darwin" ;;
        *)
            printf "Error: unsupported OS: %s\n" \
                "$(uname -s)" >&2
            printf "Windows users: install via WSL2\n" >&2
            exit 1
            ;;
    esac
}

detect_arch() {
    case "$(uname -m)" in
        x86_64) printf "x64" ;;
        aarch64 | arm64) printf "arm64" ;;
        *)
            printf "Error: unsupported arch: %s\n" \
                "$(uname -m)" >&2
            exit 1
            ;;
    esac
}

detect_fetch() {
    if command -v curl >/dev/null 2>&1; then
        printf "curl -fsSL"
    elif command -v wget >/dev/null 2>&1; then
        printf "wget -qO-"
    else
        printf "Error: curl or wget required\n" >&2
        exit 1
    fi
}

main
