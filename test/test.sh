#!/usr/bin/env bash
# 임시 Herdr 폴더에서 install, key, config, uninstall을 시험하고 다른 mod와 키가 그대로인지 확인한다.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/bin/herdr-split-agent"
export HERDR_APP_HOME; HERDR_APP_HOME="$(mktemp -d)"
trap 'rm -rf "$HERDR_APP_HOME"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

mkdir -p "$HERDR_APP_HOME/mods/other-mod"
echo 'export default class X {}' > "$HERDR_APP_HOME/mods/other-mod/main.js"
cat > "$HERDR_APP_HOME/keys.json" <<'JSON'
{ "global": { "cmd-q": "app.quit", "cmd-alt-v": "pane.zoom" }, "terminal": { "ctrl-1": "terminal" } }
JSON
before_mod="$(cat "$HERDR_APP_HOME/mods/other-mod/main.js")"

# 1. 이미 쓰는 단축키면 설치하지 않는다
if "$CLI" install >/dev/null 2>&1; then fail "install should refuse a bound key"; fi
[[ ! -d "$HERDR_APP_HOME/mods/split-agent" ]] || fail "mod was installed despite the key clash"

# 2. 다른 키로 설치
"$CLI" install --key cmd-alt-j --lang ko >/dev/null
[[ -f "$HERDR_APP_HOME/mods/split-agent/main.js" ]] || fail "mod missing"
grep -q '"cmd-alt-j": "mod.open:split-agent"' "$HERDR_APP_HOME/keys.json" || fail "key missing"
grep -q '"cmd-alt-v": "pane.zoom"' "$HERDR_APP_HOME/keys.json" || fail "existing key changed"
grep -q '"lang": "ko"' "$HERDR_APP_HOME/mods/split-agent/config.json" || fail "lang not set"

# 3. 단축키 변경과 충돌 거부
"$CLI" key cmd-alt-k >/dev/null
grep -q 'cmd-alt-j' "$HERDR_APP_HOME/keys.json" && fail "old key left behind"
grep -q '"cmd-alt-k": "mod.open:split-agent"' "$HERDR_APP_HOME/keys.json" || fail "new key missing"
if "$CLI" key cmd-q >/dev/null 2>&1; then fail "key should refuse cmd-q"; fi

# 4. 설정
"$CLI" config shells true >/dev/null
grep -q '"includeShells": true' "$HERDR_APP_HOME/mods/split-agent/config.json" || fail "shells not set"
if "$CLI" config lang xx >/dev/null 2>&1; then fail "bad lang accepted"; fi

# 5. 다시 설치해도 설정과 키는 유지(멱등)
"$CLI" install >/dev/null
grep -q '"lang": "ko"' "$HERDR_APP_HOME/mods/split-agent/config.json" || fail "config lost on reinstall"
[[ "$(grep -c 'mod.open:split-agent' "$HERDR_APP_HOME/keys.json")" == 1 ]] || fail "key duplicated"

# 6. 삭제는 자기 것만 지운다
"$CLI" uninstall >/dev/null
[[ ! -d "$HERDR_APP_HOME/mods/split-agent" ]] || fail "mod not removed"
grep -q 'mod.open:split-agent' "$HERDR_APP_HOME/keys.json" && fail "key not removed"
grep -q '"cmd-alt-v": "pane.zoom"' "$HERDR_APP_HOME/keys.json" || fail "existing key lost on uninstall"
[[ "$(cat "$HERDR_APP_HOME/mods/other-mod/main.js")" == "$before_mod" ]] || fail "other mod changed"
[[ -d "$HERDR_APP_HOME/mods/other-mod" ]] || fail "other mod removed"

# 7. keys.json 백업이 남는다(최대 3개)
ls "$HERDR_APP_HOME"/keys.json.bak-split-agent-* >/dev/null 2>&1 || fail "no keys.json backup"
echo "all tests passed"
