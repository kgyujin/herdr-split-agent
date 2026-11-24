# herdr-split-agent

A [Herdr](https://github.com/herdrdev/herdr-app) mod that shows a running agent session next to the pane you are looking at, and sends it back when you are done. No restart, no resume, no session ID to type.

> [!NOTE]
> This is an unofficial community mod, not made by the Herdr team. 한국어: [README.ko.md](README.ko.md)

## How it works

Press the shortcut (default `cmd-alt-v`) to open a small list of your agents, then pick **Right** or **Below** on any row. The agent appears beside the focused pane with its history and process intact. **Send back** returns it to its original space and tab.

Under the hood it uses only public Herdr commands: `terminal.park` detaches the pane while the process keeps running, and `terminal.keep {place}` gives that same terminal a pane beside the focused one. `terminal.show` cannot do this for an agent that already has a pane (it only switches to that tab), so it is not used.

## Install

You need the Herdr app, `bash` and `python3` (both ship with macOS).

**Homebrew**

```sh
brew tap kgyujin/herdr-split-agent https://github.com/kgyujin/herdr-split-agent
brew install herdr-split-agent
herdr-split-agent install
```

**npx** (runs straight from GitHub, nothing is published to npm)

```sh
npx github:kgyujin/herdr-split-agent install
```

**From a clone**

```sh
git clone https://github.com/kgyujin/herdr-split-agent
herdr-split-agent/bin/herdr-split-agent install
```

Herdr reloads mods and keys by itself, so the shortcut works right away.

## Manage

| Command | What it does |
| --- | --- |
| `herdr-split-agent update` | Installs the newest GitHub release (`--check` only reports it) |
| `herdr-split-agent auto-update on` | Checks once a day and at login (macOS LaunchAgent, off by default) |
| `herdr-split-agent key cmd-alt-j` | Changes the open shortcut; refuses a key that is already bound |
| `herdr-split-agent config lang ko` | Popup language: `en` or `ko` |
| `herdr-split-agent config shells true` | Also list plain terminals, not only agents |
| `herdr-split-agent status` | Shows version, shortcut and auto-update state |
| `herdr-split-agent uninstall` | Removes the mod folder, its shortcut and the auto-update job |

With Homebrew, `brew upgrade herdr-split-agent` updates the command itself; `herdr-split-agent update` updates the mod from the latest release either way.

## What it touches

- `~/.config/herdr-app/mods/split-agent/`, one folder that is only ever replaced as a whole.
- One line in `~/.config/herdr-app/keys.json`. It is added only if the key is free, removed on uninstall only if it still points at this mod, and `keys.json` is backed up first (last three kept).
- Nothing else: other mods, layouts and settings are never read or changed. Set `HERDR_APP_HOME` to use another Herdr folder.

> [!WARNING]
> A Herdr mod runs with the mod API's permissions. The whole mod is one readable file (`mods/split-agent/main.js`). `update` downloads only tagged GitHub releases, checks the new version with `herdr-app check` before swapping it in, and restores the previous version if that fails.

## Limits

- **No drag and drop, no sidebar right-click.** The mod API only supports dragging file paths, and the shipped sidebar mods are read-only. Use the shortcut list instead.
- **Send back** returns the agent to its original tab. If that tab still has other panes it goes to the right of one of them, since the original split direction is not exposed. If the tab is gone it gets a new tab with the old name and position.
- Agents in the **current tab** are shown as "This tab" and are not moved.
- If Herdr closes while an agent is detached, the next time you open the list it is put back in a new tab automatically. The process is never stopped.
- Auto-update uses a macOS LaunchAgent. On Linux, run `herdr-split-agent update --quiet` from cron or a systemd timer.

## Development

```sh
bash test/test.sh   # installs into a temporary Herdr folder and checks that other mods and keys stay untouched
herdr-app check mods/split-agent
```
