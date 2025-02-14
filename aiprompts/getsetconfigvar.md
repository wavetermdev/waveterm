# Setting and Reading Config Variables

This document provides a quick reference for updating and reading configuration values in our system.

---

## Setting a Config Variable

To update a configuration, use the `RpcApi.SetConfigCommand` function. The command takes an object with a key/value pair where the key is the config variable and the value is the new setting.

**Example:**

```ts
await RpcApi.SetConfigCommand(TabRpcClient, { "web:defaulturl": url });
```

In this example, `"web:defaulturl"` is the key and `url` is the new value. Use this approach for any config key.

---

## Reading a Config Value

To read a configuration value, retrieve the corresponding atom using `getSettingsKeyAtom` and then use `globalStore.get` to access its current value. getSettingsKeyAtom returns a jotai Atom.

**Example:**

```ts
const configAtom = getSettingsKeyAtom("app:defaultnewblock");
const configValue = globalStore.get(configAtom) ?? "default value";
```

Here, `"app:defaultnewblock"` is the config key and `"default value"` serves as a fallback if the key isn't set.

Inside of a react componet we should not use globalStore, instead we use useSettingsKeyAtom (this is just a jotai useAtomValue call wrapped around the getSettingsKeyAtom call)

```tsx
const configValue = useSettingsKeyAtom("app:defaultnewblock") ?? "default value";
```

---

## Relevant Imports

```ts
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getSettingsKeyAtom, useSettingsKeyAtom, globalStore } from "@/app/store/global";
```

Keep this guide handy for a quick reference when working with configuration values.
