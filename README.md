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
  with the Swift core in `ios/GuardianCore` and seven native unit tests.
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
the timer; later movement resolves the incident and starts a fresh interval. The state and
threshold survive process recreation and version-1 native state is migrated without dropping
geofences or pending events. There is deliberately no self-confirmation notification or
"I am safe" button.

The app currently records guardian events locally. It provides a signed iCloud template for
an iOS Shortcut named `到家了么通知`; the app passes the first locally saved family phone number
and message body to the shortcut at runtime, so no duplicate Contacts selection is needed.
Its Send Message action can send a test SMS or iMessage without a compose sheet. This
requires one-time installation and permission on each iPhone; the URL handoff does not prove
carrier delivery or that the recipient read the message, and locked/background reliability
is not claimed. Automated calls, production-grade unattended family delivery, and delivery
receipts are not implemented yet. In particular, detecting the risk creates a durable,
local-only family-notification event but does not claim that the Shortcut was run in the background.
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

The iOS Debug app builds on the iOS 27 simulator with Xcode 27, and all seven Swift
XCTest cases pass there. Long-running background timing, permission transitions, energy
use, automatic family delivery, and process restoration still require iPhone testing.
