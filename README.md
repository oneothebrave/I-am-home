# 到家说一声

iOS-first family safety guardian app prototype.

The product direction is:

- React Native for screens, settings, status display, maps, contacts, and history.
- Swift native modules for background location, geofencing, motion, battery, local notifications, and event wakeups.
- A shared rule model that turns native events into clear safety states: safe, attention, and emergency.

## Current Scope

This repository currently contains the first development foundation:

- A React Native TypeScript UI prototype in `App.tsx`.
- Shared product/domain models in `src/domain`.
- A native bridge contract in `src/native/GuardianNative.ts`.
- A buildable React Native iOS workspace in `ios/DaojiaShuoYisheng.xcworkspace`,
  with the Swift core in `ios/GuardianCore` and four native unit tests.
- Product and implementation notes in `docs`.

The refactored prototype includes a shared incident model, versioned local state,
serialized persistence, a native event acknowledgement protocol, and regression tests.
The device-mode Places screen can request a fresh, precise iPhone location, validate its
age and accuracy, save it as a place, and serialize the latest geofence configuration to
the Swift runtime. Demo coordinates are cleared before device mode is activated. The
device-mode guardian switch now requires a real place, Always Location, precise location,
and a successful fence sync before it starts native monitoring; native status is reconciled
on launch and foreground transitions before the JavaScript switch is updated.
The default UI is explicitly a demo and does not send real notifications.
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

The iOS Debug app builds and launches on the iOS 27 simulator with Xcode 27, and all
four Swift XCTest cases pass there. Background execution, permission transitions,
energy use, notifications, and process restoration still require iPhone testing.
