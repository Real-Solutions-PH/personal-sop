# FastAPI Project - Mobile (Optional)

Optional React Native mobile app that consumes the same FastAPI backend.
Mirrors the `frontend/` directory conventions (same TanStack Query +
react-hook-form + `@hey-api/openapi-ts` client generation pattern).

## Stack

- [Expo](https://expo.dev/) SDK 52 (React Native 0.76, New Architecture)
- [Expo Router](https://docs.expo.dev/router/introduction/) file-based routing (mirrors Next.js App Router)
- [NativeWind v4](https://www.nativewind.dev/) Tailwind CSS for React Native
- [React Native Reusables](https://reactnativereusables.com/) via `@rn-primitives/*` shadcn-style primitives for RN
- [TanStack Query](https://tanstack.com/query) server state
- [axios](https://axios-http.com/) HTTP client (shared pattern with frontend)
- [react-hook-form](https://react-hook-form.com/) + [zod](https://zod.dev/) forms and validation
- [expo-secure-store](https://docs.expo.dev/versions/latest/sdk/securestore/) token storage
- [sonner-native](https://github.com/gunnartorfis/sonner-native) toasts
- [Biome](https://biomejs.dev/) lint and format
- [@hey-api/openapi-ts](https://heyapi.dev/) typed API client generation

## Requirements

- [Bun](https://bun.sh/) (recommended) or Node.js
- [Expo Go](https://expo.dev/go) app on a device, or iOS/Android simulator

## Quick Start

```bash
cp .env.example .env
bun install
bun run start
```

Then scan the QR code with Expo Go, or press `i` / `a` for simulators.

## Structure

```
mobile/
  app.json                 Expo config
  babel.config.js          NativeWind babel preset
  metro.config.js          NativeWind metro transformer
  tailwind.config.js
  global.css               Tailwind entry + CSS variables (theme tokens)
  openapi-ts.config.ts     mirrors frontend/openapi-ts.config.ts
  src/
    app/                   expo-router routes (mirrors frontend/src/app)
      _layout.tsx
      index.tsx            auth gate redirect
      login.tsx
      signup.tsx
      recover-password.tsx
      reset-password.tsx
      (app)/               authenticated stack (tabs)
        _layout.tsx
        index.tsx
        items.tsx
        settings.tsx
    client/                generated OpenAPI client (see client/README.md)
    components/
      providers.tsx        QueryClient + SafeArea + Gesture + Toaster
      ui/                  button, input, text, form-field (RNR-style)
    hooks/
      useAuth.ts
      useCustomToast.ts
    lib/
      auth.ts              axios instance + SecureStore token helpers
      utils.ts             cn(), validation patterns, error helpers
```

## Using a Remote API

Set `EXPO_PUBLIC_API_URL` in `.env` (public to the client bundle; do not
put secrets there):

```env
EXPO_PUBLIC_API_URL=https://api.my-domain.example.com
```

## Generate API Client

Same flow as `frontend/`:

1. Start backend (`docker compose up -d --wait backend`)
2. Download `http://localhost:8000/api/v1/openapi.json` to `mobile/openapi.json`
3. Run:
   ```bash
   bun run generate-client
   ```

Then swap direct `axios` calls in screens for the generated `*Service`
classes from `src/client`.

## Removing the Mobile App

This app is optional. To drop it:

- Remove `./mobile/`
- Remove any `MOBILE`-related env vars from `.env` / scripts (if added)

No `compose.yml` service exists for mobile — it runs only on developer
machines / devices via Expo.
