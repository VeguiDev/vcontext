#!/usr/bin/env sh
set -eu
bin_dir=${1:-release/bin}
out_dir=${2:-release/assets}
mkdir -p "$out_dir" "${out_dir}/.stage"
find "$bin_dir" -type f -name 'vcontext-*' -exec cp {} "${out_dir}/.stage/" \;
pack_unix() { target=$1; stage="$out_dir/.stage/$target"; mkdir -p "$stage"; cp "$out_dir/.stage/vcontext-$target" "$stage/vcontext"; chmod 755 "$stage/vcontext"; tar -C "$stage" -czf "$out_dir/vcontext-$target.tar.gz" vcontext; }
pack_unix linux-x64
pack_unix linux-arm64
pack_unix darwin-x64
pack_unix darwin-arm64
stage="$out_dir/.stage/windows-x64"; mkdir -p "$stage"; cp "$out_dir/.stage/vcontext-windows-x64.exe" "$stage/vcontext.exe"; (cd "$stage" && zip -q "$OLDPWD/$out_dir/vcontext-windows-x64.zip" vcontext.exe)
(cd "$out_dir" && sha256sum vcontext-*.tar.gz vcontext-*.zip > vcontext-checksums.txt)