#!/bin/sh
set -eu

REPO="tvararu/tuicraft"

main() {
    platform="$(detect_platform)"
    arch="$(detect_arch)"
    fetch_cmd="$(detect_fetch)"
    install_dir="$(resolve_install_dir)"

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
    mv "$tmpfile" "${install_dir}/tuicraft"

    printf "Installed tuicraft (%s) to %s\n" \
        "$tag" "${install_dir}/tuicraft" >&2

    case ":${PATH}:" in
        *":${install_dir}:"*) ;;
        *)
            printf "Warning: %s is not in PATH\n" \
                "$install_dir" >&2
            ;;
    esac
}

resolve_install_dir() {
    if [ -n "${TUICRAFT_INSTALL_DIR:-}" ]; then
        printf "%s" "$TUICRAFT_INSTALL_DIR"
        return
    fi

    if [ -w "/usr/local/bin" ]; then
        printf "/usr/local/bin"
        return
    fi

    local_bin="${HOME}/.local/bin"
    if [ -d "$local_bin" ] || mkdir -p "$local_bin" 2>/dev/null; then
        printf "%s" "$local_bin"
        return
    fi

    printf "Error: /usr/local/bin is not writable" >&2
    printf " and ~/.local/bin could not be created\n" >&2
    printf "Set TUICRAFT_INSTALL_DIR to a " >&2
    printf "writable directory\n" >&2
    exit 1
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
