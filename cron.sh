#!/bin/sh
# Runs an npm script from cron (or anywhere): finds node by itself, so the cron line needs no cd or PATH.
# usage: ./cron.sh <npm script> [options...]    e.g. ./cron.sh daily-new, ./cron.sh random-meet --latest
# options are passed on after `--`, e.g. ./cron.sh daily-new -p local/cats (every script takes -s/--source and -p/--project)

if [ -z "$1" ]; then
    echo "usage: $0 <npm script> [options...]  e.g. $0 daily-new"
    exit 1
fi

# always run from the project folder, wherever cron starts
cd "$(dirname "$0")" || exit 1

# find node and npm: whatever is on PATH already, else the version this project asks for
# (.tool-versions for asdf, .nvmrc for nvm), else Homebrew. Cron's PATH is only /usr/bin:/bin
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    asdf_version=$(awk '/^nodejs /{ print $2 }' .tool-versions 2>/dev/null)
    nvm_dir=$(ls -d "${NVM_DIR:-$HOME/.nvm}/versions/node/v$(cat .nvmrc 2>/dev/null)"*/bin 2>/dev/null | tail -1)
    for dir in "$HOME/.asdf/installs/nodejs/$asdf_version/bin" "$nvm_dir" /opt/homebrew/bin /usr/local/bin; do
        if [ -n "$dir" ] && [ -x "$dir/node" ] && [ -x "$dir/npm" ]; then
            PATH="$dir:$PATH"
            export PATH
            break
        fi
    done
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo "cron.sh: couldn't find node/npm (looked on PATH, asdf, nvm and Homebrew) - see \"Run it on a schedule\" in the README"
    exit 1
fi

echo "--- $(date '+%Y-%m-%d %H:%M') npm run $*"
script=$1
shift
exec npm run --silent "$script" -- "$@"
