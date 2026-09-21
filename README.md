# 到家了么

iOS-first family safety guardian app prototype for older adults.

The product direction is:

- React Native for a simple three-tab experience: Status, Places, and My.
- Swift native modules for background location, geofencing, motion signals, persistence, and event wakeups.
- A shared rule model that turns native events into clear safety states: safe, attention, and emergency.

## Current Scope

This repository currently contains the first development foundation:

- A React Native TypeScript UI prototype in `App.tsx`.
- Shared product/domain models in `src/domain`.
- A native bridge contract in `src/native/GuardianNative.ts`.
- A buildable React Native iOS workspace in `ios/DaojiaShuoYisheng.xcworkspace`,
  with the Swift core in `ios/GuardianCore` and seventeen native unit tests.
- Product and implementation notes in `docs`.

The refactored prototype includes a shared incident model, versioned local state,
serialized persistence, a native event acknowledgement protocol, and regression tests.
The Places screen uses the iPhone's current precise location, so this version has no map
dependency. A user chooses a familiar place name and a 150, 300, or 500 metre radius,
then the latest geofence configuration is synchronized to the Swift runtime. Once a real
place, Always Location, precise location, and geofence synchronization are ready, native
guardian service starts automatically. An explicit pause remains available under My.

The native runtime now evaluates the first production risk rule: after the phone is
confirmed outside every place marked as Home, it combines trusted location displacement,
Core Motion activity, and pedometer steps. If no credible movement is observed for the
configured interval, it persists one `NO_MOTION_FOR_LONG_TIME` event. Returning home cancels
the timer; later movement resolves the incident and starts a fresh interval. This rule only
accumulates inside the configured single daily guardian window. Leaving the window stops and
clears the unfinished inactivity interval, while geofence transitions remain enabled all day.
The state, threshold, and window survive process recreation and older native state is migrated
without dropping geofences or pending events. There is deliberately no self-confirmation
notification or "I am safe" button.

The on-device runtime now restores the same system geofences without tearing down unchanged
registrations, and also keeps significant-location and visit monitoring active. A launch caused
by Core Location restores the Swift runtime before React Native starts, replays recent Core Motion
history, obtains a fresh trusted location, and only then evaluates an overdue inactivity rule.
The next active-window boundary or inactivity deadline is also submitted as a best-effort
`BGAppRefreshTask`. Background restore uses a finite UIKit background task, and retries when
protected local data becomes available after the first unlock following a reboot. These paths
improve recovery but do not turn iOS background scheduling into an exact alarm: the phone cannot
run the app while powered off, force-quitting the app or disabling Background App Refresh prevents
reliable relaunch, and `earliestBeginDate` is not a delivery-time guarantee.

When the native detector emits `NO_MOTION_FOR_LONG_TIME`, it now atomically prepares one
Critical Messaging operation per locally saved family contact. Each operation contains the
trigger event ID, recipient, phone number, final message text, creation time, and delivery
state. The Status screen displays this preparation so it can be reviewed. The actual
`MSCriticalSMSMessenger` adapter is compiled behind the iOS 18.2 availability boundary, but
the current build deliberately has no Critical Messaging entitlement and never calls send.

The app currently records guardian events locally. It provides a signed iCloud template for
an iOS Shortcut named `到家了么短信通知 V3`; the app passes the first locally saved family phone number
and message body to the shortcut at runtime, so no duplicate Contacts selection is needed.
Its Send Message action can send a test SMS or iMessage without a compose sheet. This
requires one-time installation and permission on each iPhone. The shared template explicitly turns
off the Send Message action's `Show When Run` option. The versioned name prevents an older shortcut
with the previous name from being selected by the URL runner. After a new inactivity incident is
persisted, the native runtime now makes one best-effort attempt to run this shortcut for the
highest-priority family contact. It records separately whether iOS accepted the URL-open request;
that result does not prove the Message action ran, the carrier accepted an SMS, or the recipient
read it. iOS may reject the handoff while locked or in the background. Automated calls,
production-grade unattended family delivery, and delivery receipts are not implemented yet.

Field-test fixes: an unresolved inactivity incident is persisted independently of detector
restoration and queue acknowledgement, preventing another automatic attempt for the same
unresolved incident. Opening the app no longer replays pending shortcut operations; an overdue
incident first found during foreground restoration is prepared for inspection without sending.
The Status screen records whether detection happened in the background, foreground, or restoration.
Away tracking during the active window now requests best location accuracy and 10-metre updates.
Activity is determined from several independent, explainable signals: medium/high-confidence Core
Motion classifications, at least five accumulated pedometer steps, visit departures, or displacement
from a persisted location anchor that exceeds an adaptive
accuracy threshold (with an 8-metre floor) and also carries credible Core Location speed. Requiring
both displacement and speed prevents a stationary 20–40 metre GPS jump from clearing an incident.
Non-home geofence entry/exit remains a footprint signal but does not clear inactivity, because a
boundary callback can itself be caused by location drift. Returning home still clears the incident.
This supports work in a small area without treating one step or ordinary GPS drift as activity.
Activity evidence is recorded locally with its source and
human-readable reason, throttled to one routine record per five minutes; an incident recovery is
always recorded. This increases potential battery use and still cannot detect a person who leaves
the phone stationary while moving elsewhere. Actual location fixes and
region events, not cached coordinates on risk events, determine the displayed place. A failed
one-shot refresh no longer hides an available location record.
Prepared family messages now use a matching saved guardian-place name and include its most recent
trusted coordinates and accuracy. Outside all saved places, they include the recent coordinates;
without a location fix from the last fifteen minutes they explicitly say the exact location cannot
be confirmed.
See [refactoring notes](docs/refactoring.md) for verified behavior and remaining iOS work.

## Scripts

```bash
npm ci
npm run typecheck
npm test
npm run bundle:ios
npm run ios
```

The JavaScript bundle can be checked on Windows with Node 24. On macOS, Ruby is pinned
by `mise.toml`; Bundler installs gems into `vendor/bundle`, and CocoaPods remains local
to the project. Run `mise exec -- bundle exec pod install --project-directory=ios`, then open
`ios/DaojiaShuoYisheng.xcworkspace` rather than the `.xcodeproj`.

The iOS Debug app builds on the iOS 27 simulator with Xcode 27, and all seventeen Swift
XCTest cases pass there. Long-running background timing, permission transitions, energy
use, automatic family delivery, and process restoration still require iPhone testing.
