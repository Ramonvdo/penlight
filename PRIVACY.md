# Privacy Policy

**Effective date:** 21 August 2026
**Applies to:** the Penlight desktop application for Windows, distributed from
[GitHub Releases](https://github.com/Ramonvdo/penlight/releases) and the Microsoft Store.

## The short version

Penlight does not collect, transmit, or share any personal data. There is no account, no
sign-in, no telemetry, no analytics, and no advertising. The application works fully offline
and makes no network requests of its own.

## What Penlight stores, and where

Everything Penlight saves stays on your computer, in your own user profile:

| What | Where |
| --- | --- |
| Settings (colours, shortcuts, sizes, preferences) | `%APPDATA%\app.penlight.desktop\settings.json` |
| Whiteboards (the drawings you make on a board) | `%APPDATA%\app.penlight.desktop\boards\` |

In a Microsoft Store install these paths may be redirected to the package's own storage
location, which is still on your machine and still inside your user profile.

Nothing in these files is sent anywhere. You can read, back up, or delete them at any time.
Uninstalling Penlight through Windows removes the application; deleting the folder above
removes your settings and whiteboards.

## What Penlight does *not* do

- It does not log keystrokes. Penlight registers global hotkeys with Windows so it can be
  activated from anywhere, but it does not install a keyboard hook and never records what
  you type.
- It does not capture, record, or transmit your screen. Screen annotation draws *over* your
  screen; it does not read its contents. The zoom lens uses the Windows Magnification API to
  display a magnified view locally, and nothing is captured or stored.
- It does not track cursor movement beyond drawing the halo. Penlight uses a passive
  low-level mouse hook to know where to place the cursor highlight and click ripples on
  screen. It observes position and button events only, never modifies or blocks them, and
  never writes them to disk or sends them anywhere.
- It contains no telemetry, crash reporting, analytics, or update pings.

## Network access

Penlight makes no network connections. It has no update checker, no cloud sync, and no
remote services of any kind. It is fully functional on a machine that has never been
connected to the internet.

## Children's privacy

Penlight is a general-purpose utility, is suitable for all ages, and collects no data from
anyone, including children.

## Changes to this policy

If this policy changes, the updated version will be published at this URL and the effective
date above will change. Because Penlight collects no data, any change is likely to be a
clarification rather than a change in practice.

## Contact

Questions about privacy in Penlight: open an issue at
<https://github.com/Ramonvdo/penlight/issues>.

Penlight is free and open source under the MIT Licence — every claim on this page can be
verified against the source at <https://github.com/Ramonvdo/penlight>.
