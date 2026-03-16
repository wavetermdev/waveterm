---
name: waveenv
description: Guide for creating WaveEnv narrowings in Wave Terminal — define type constraints, enumerate used fields, and generate mock-compatible subset types. Use when writing a named subset type of WaveEnv for a component tree, scoping environment types for testing, documenting environmental dependencies, creating mock environments for preview/test server, or defining type subsets for isolated components.
---

# WaveEnv Narrowing Skill

Create a `WaveEnvSubset<T>` type that documents exactly which environment fields a component tree uses, forms a type contract for callers and tests, and enables mocking in the preview/test server.

## Core Principle: Only Include What You Use

**Only list the fields, methods, atoms, and keys that the component tree actually accesses.** If you don't call `wos`, don't include `wos`. If you only call one RPC command, only list that one command. The narrowing is a precise dependency declaration — not a copy of `WaveEnv`.

## File Location

- **Separate file** (preferred for shared/complex envs): name it `<feature>env.ts` next to the component, e.g. `frontend/app/block/blockenv.ts`.
- **Inline** (acceptable for small, single-file components): export the type directly from the component file, e.g. `WidgetsEnv` in `frontend/app/workspace/widgets.tsx`.

## Imports Required

```ts
import {
  BlockMetaKeyAtomFnType, // only if you use getBlockMetaKeyAtom
  ConnConfigKeyAtomFnType, // only if you use getConnConfigKeyAtom
  SettingsKeyAtomFnType, // only if you use getSettingsKeyAtom
  WaveEnv,
  WaveEnvSubset,
} from "@/app/waveenv/waveenv";
```

## The Shape

```ts
export type MyEnv = WaveEnvSubset<{
  // --- Simple WaveEnv properties ---
  // Copy the type verbatim from WaveEnv with WaveEnv["key"] syntax.
  isDev: WaveEnv["isDev"];
  createBlock: WaveEnv["createBlock"];
  showContextMenu: WaveEnv["showContextMenu"];
  platform: WaveEnv["platform"];

  // --- electron: list only the methods you call ---
  electron: {
    openExternal: WaveEnv["electron"]["openExternal"];
  };

  // --- rpc: list only the commands you call ---
  rpc: {
    ActivityCommand: WaveEnv["rpc"]["ActivityCommand"];
    ConnEnsureCommand: WaveEnv["rpc"]["ConnEnsureCommand"];
  };

  // --- atoms: list only the atoms you read ---
  atoms: {
    modalOpen: WaveEnv["atoms"]["modalOpen"];
    fullConfigAtom: WaveEnv["atoms"]["fullConfigAtom"];
  };

  // --- wos: always take the whole thing, no sub-typing needed ---
  wos: WaveEnv["wos"];

  // --- services: list only the services you call; no method-level narrowing ---
  services: {
    block: WaveEnv["services"]["block"];
    workspace: WaveEnv["services"]["workspace"];
  };

  // --- key-parameterized atom factories: enumerate the keys you use ---
  getSettingsKeyAtom: SettingsKeyAtomFnType<"app:focusfollowscursor" | "window:magnifiedblockopacity">;
  getBlockMetaKeyAtom: BlockMetaKeyAtomFnType<"view" | "frame:title" | "connection">;
  getConnConfigKeyAtom: ConnConfigKeyAtomFnType<"conn:wshenabled">;

  // --- other atom helpers: copy verbatim ---
  getConnStatusAtom: WaveEnv["getConnStatusAtom"];
  getLocalHostDisplayNameAtom: WaveEnv["getLocalHostDisplayNameAtom"];
}>;
```

### Automatically Included Fields

Every `WaveEnvSubset<T>` automatically includes the mock fields — you never need to declare them:

- `isMock: boolean`
- `mockSetWaveObj: <T extends WaveObj>(oref: string, obj: T) => void`
- `mockModels?: Map<any, any>`

### Rules for Each Section

| Section                    | Pattern                                                | Notes                                                                                              |
| -------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `electron`                 | `electron: { method: WaveEnv["electron"]["method"]; }` | List every method called; omit the rest.                                                           |
| `rpc`                      | `rpc: { Cmd: WaveEnv["rpc"]["Cmd"]; }`                 | List every RPC command called; omit the rest.                                                      |
| `atoms`                    | `atoms: { atom: WaveEnv["atoms"]["atom"]; }`           | List every atom read; omit the rest.                                                               |
| `wos`                      | `wos: WaveEnv["wos"]`                                  | Take the whole `wos` object (no sub-typing needed), but **only add it if `wos` is actually used**. |
| `services`                 | `services: { svc: WaveEnv["services"]["svc"]; }`       | List each service used; take the whole service object (no method-level narrowing).                 |
| `getSettingsKeyAtom`       | `SettingsKeyAtomFnType<"key1" \| "key2">`              | Union all settings keys accessed.                                                                  |
| `getBlockMetaKeyAtom`      | `BlockMetaKeyAtomFnType<"key1" \| "key2">`             | Union all block meta keys accessed.                                                                |
| `getConnConfigKeyAtom`     | `ConnConfigKeyAtomFnType<"key1">`                      | Union all conn config keys accessed.                                                               |
| All other `WaveEnv` fields | `WaveEnv["fieldName"]`                                 | Copy type verbatim.                                                                                |

## Using the Narrowed Type in Components

```ts
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { MyEnv } from "./myenv";

const MyComponent = memo(() => {
    const env = useWaveEnv<MyEnv>();
    // TypeScript now enforces you only access what's in MyEnv.
    const val = useAtomValue(env.getSettingsKeyAtom("app:focusfollowscursor"));
    ...
});
```

The generic parameter on `useWaveEnv<MyEnv>()` casts the context to your narrowed type. The real production `WaveEnv` satisfies every narrowing; mock envs only need to implement the listed subset.

## Validation Checklist

- [ ] Every field listed is actually accessed by the component tree
- [ ] No extra fields copied from `WaveEnv` that aren't used
- [ ] Key-parameterized atom factories enumerate only the keys accessed
- [ ] Type compiles with `tsc --noEmit` (catches missing or incorrect fields)
- [ ] Mock environment in preview/test server implements all listed fields

## Real Examples

- `BlockEnv` in `frontend/app/block/blockenv.ts` — complex narrowing with all section types, in a separate file.
- `WidgetsEnv` in `frontend/app/workspace/widgets.tsx` — smaller narrowing defined inline in the component file.
