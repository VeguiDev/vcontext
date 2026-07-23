#!/usr/bin/env sh
set -eu
GITHUB_OWNER=VeguiDev
GITHUB_REPOSITORY=vcontext
VERSION=${VCONTEXT_VERSION:-}
INSTALL_DIR=${VCONTEXT_INSTALL_DIR:-}
FORCE=0
say(){ printf '%s\n' "$*"; }
die(){ say "vcontext installer: $*" >&2; exit 1; }
while [ "$#" -gt 0 ]; do case "$1" in --version) VERSION=${2:?missing version}; shift 2;; --install-dir) INSTALL_DIR=${2:?missing directory}; shift 2;; --force) FORCE=1; shift;; *) die "unknown option: $1";; esac; done
case "${NO_COLOR:-}" in '') :;; *) :;; esac
os=$(uname -s); arch=$(uname -m)
case "$os:$arch" in Linux:x86_64|Linux:amd64) asset=vcontext-linux-x64.tar.gz;; Linux:aarch64|Linux:arm64) asset=vcontext-linux-arm64.tar.gz;; Darwin:x86_64) asset=vcontext-darwin-x64.tar.gz;; Darwin:arm64) asset=vcontext-darwin-arm64.tar.gz;; *) die "unsupported platform: $os $arch";; esac
case "${VERSION:-latest}" in latest) base="https://github.com/$GITHUB_OWNER/$GITHUB_REPOSITORY/releases/latest/download";; v[0-9]*) base="https://github.com/$GITHUB_OWNER/$GITHUB_REPOSITORY/releases/download/$VERSION";; *) die "version must be latest or a v-prefixed semantic version";; esac
command -v curl >/dev/null 2>&1 || die "curl is required"
if command -v sha256sum >/dev/null 2>&1; then hash(){ sha256sum "$1" | awk '{print $1}'; }; elif command -v shasum >/dev/null 2>&1; then hash(){ shasum -a 256 "$1" | awk '{print $1}'; }; elif command -v openssl >/dev/null 2>&1; then hash(){ openssl dgst -sha256 "$1" | awk '{print $NF}'; }; else die "no SHA-256 tool found"; fi
tmp=$(mktemp -d 2>/dev/null || mktemp -d -t vcontext); trap 'rm -rf "$tmp"' EXIT HUP INT TERM
say 'vcontext installer'; say "● Detecting platform: $os $arch"; say "● Downloading $asset"
curl -fL --retry 3 --connect-timeout 15 "$base/$asset" -o "$tmp/$asset" || die "download failed"
curl -fL --retry 3 --connect-timeout 15 "$base/vcontext-checksums.txt" -o "$tmp/checksums" || die "checksum download failed"
expected=$(awk -v file="$asset" '$2==file {print $1}' "$tmp/checksums"); [ -n "$expected" ] || die "checksum entry missing"; actual=$(hash "$tmp/$asset"); [ "$expected" = "$actual" ] || die "checksum verification failed"
[ -n "$INSTALL_DIR" ] || { for d in $(printf '%s' "$PATH" | tr ':' ' '); do [ -n "$d" ] && [ -d "$d" ] && [ -w "$d" ] && { INSTALL_DIR=$d; break; }; done; }; [ -n "$INSTALL_DIR" ] || INSTALL_DIR="$HOME/.local/bin"
mkdir -p "$INSTALL_DIR" 2>/dev/null || die "cannot create $INSTALL_DIR (choose --install-dir; sudo is never used automatically)"
[ -w "$INSTALL_DIR" ] || die "cannot write $INSTALL_DIR"
tar -xzf "$tmp/$asset" -C "$tmp" vcontext || die "invalid archive"; [ ! -e "$INSTALL_DIR/vcontext" ] || [ "$FORCE" = 1 ] || die "vcontext already exists; use --force"; install -m 755 "$tmp/vcontext" "$INSTALL_DIR/vcontext"
installed=$($INSTALL_DIR/vcontext --version) || die "installed executable could not run"; say "✓ vcontext $installed installed successfully in $INSTALL_DIR"; case ":$PATH:" in *":$INSTALL_DIR:"*) ;; *) say "Add $INSTALL_DIR to PATH (for Bash/Zsh: export PATH=\"$INSTALL_DIR:\$PATH\")";; esac