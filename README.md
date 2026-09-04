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

## Scripts

```bash
npm install
npm run typecheck
npm run ios
```

The iOS app requires a macOS/Xcode environment to build and run on simulator or device.
