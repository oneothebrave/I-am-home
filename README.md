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
- iOS Swift core skeleton in `ios/GuardianCore`.
- Product and implementation notes in `docs`.

The refactored prototype includes a shared incident model, versioned local state,
serialized persistence, a native event acknowledgement protocol, and regression tests.
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

The JavaScript bundle can be checked on Windows with Node 24. The iOS app still requires
a full Xcode project, native target integration, and macOS/Xcode to build and run.
