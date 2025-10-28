Wave Terminal is a modern terminal which provides graphical blocks, dynamic layout, workspaces, and SSH connection management. It is cross platform and built on electron.

### Project Structure

It has a TypeScript/React frontend and a Go backend. They talk together over `wshrpc` a custom RPC protocol that is implemented over websocket (and domain sockets).

### Coding Guidelines

- **Go Conventions**:
  - Don't use custom enum types in Go. Instead, use string constants (e.g., `const StatusRunning = "running"` rather than creating a custom type like `type Status string`).
  - Use string constants for status values, packet types, and other string-based enumerations.
  - in Go code, prefer using Printf() vs Println()
  - use "Make" as opposed to "New" for struct initialization func names
  - in general const decls go at the top fo the file (before types and functions)
  - NEVER run `go build` (especially in weird sub-package directories). we can tell if everything compiles by seeing there are no problems/errors.
- **Synchronization**:
  - Always prefer to use the `lock.Lock(); defer lock.Unlock()` pattern for synchronization if possible
  - Avoid inline lock/unlock pairs - instead create helper functions that use the defer pattern
  - When accessing shared data structures (maps, slices, etc.), ensure proper locking
  - Example: Instead of `gc.lock.Lock(); gc.map[key]++; gc.lock.Unlock()`, create a helper function like `getNextValue(key string) int { gc.lock.Lock(); defer gc.lock.Unlock(); gc.map[key]++; return gc.map[key] }`
- **TypeScript Imports**:
  - Use `@/...` for imports from different parts of the project (configured in `tsconfig.json` as `"@/*": ["frontend/*"]`).
  - Prefer relative imports (`"./name"`) only within the same directory.
  - Use named exports exclusively; avoid default exports. It's acceptable to export functions directly (e.g., React Components).
  - Our indent is 4 spaces
- **JSON Field Naming**: All fields must be lowercase, without underscores.
- **TypeScript Conventions**
  - **Type Handling**:
    - In TypeScript we have strict null checks off, so no need to add "| null" to all the types.
    - In TypeScript for Jotai atoms, if we want to write, we need to type the atom as a PrimitiveAtom<Type>
    - Jotai has a bug with strict null checks off where if you create a null atom, e.g. atom(null) it does not "type" correctly. That's no issue, just cast it to the proper PrimitiveAtom type (no "| null") and it will work fine.
    - Generally never use "=== undefined" or "!== undefined". This is bad style. Just use a "== null" or "!= null" unless it is a very specific case where we need to distinguish undefined from null.
  - **Coding Style**:
    - Use all lowercase filenames (except where case is actually important like Taskfile.yml)
    - Import the "cn" function from "@/util/util" to do classname / clsx class merge (it uses twMerge underneath)
    - For element variants use class-variance-authority
    - Do NOT create private fields in classes (they are impossible to inspect and are a terrible for application code)
  - **Component Practices**:
    - Make sure to add cursor-pointer to buttons/links and clickable items
    - NEVER use cursor-help (it looks terrible)
    - useAtom() and useAtomValue() are react HOOKS, so they must be called at the component level not inline in JSX
    - If you use React.memo(), make sure to add a displayName for the component
- In general, when writing functions, we prefer _early returns_ rather than putting the majority of a function inside of an if block.

### Styling

- We use **Tailwind v4** to style. Custom stuff is defined in frontend/tailwindsetup.css
- _never_ use cursor-help, or cursor-not-allowed (it looks terrible)
- We have custom CSS setup as well, so it is a hybrid system. For new code we prefer tailwind, and are working to migrate code to all use tailwind.

### Code Generation

- **TypeScript Types**: TypeScript types are automatically generated from Go types. After modifying Go types in `pkg/wshrpc/wshrpctypes.go`, run `task generate` to update the TypeScript type definitions in `frontend/types/gotypes.d.ts`.
- **Manual Edits**: Do not manually edit generated files like `frontend/types/gotypes.d.ts` or `frontend/app/store/wshclientapi.ts`. Instead, modify the source Go types and run `task generate`.

### Development Documentation

The `/aiprompts` directory contains comprehensive guides for common development tasks:

- **config-system.md** - Complete guide for adding new configuration settings, including the hierarchical config system with global, connection, and block-level overrides
- **contextmenu.md** - Instructions for adding context menu items and actions
- **getsetconfigvar.md** - Reference for reading and writing configuration values programmatically
- **view-prompt.md** - Architecture guide for implementing new view models and components

These files provide step-by-step instructions, code examples, and best practices for extending Wave Terminal's functionality.

### Frontend Architecture

- The application uses Jotai for state management.
- When working with Jotai atoms that need to be updated, define them as `PrimitiveAtom<Type>` rather than just `atom<Type>`.

### Notes

- **CRITICAL: Completion format MUST be: "Done: [one-line description]"**
- **Keep your Task Completed summaries VERY short**
- **No lengthy pre-completion summaries** - Do not provide detailed explanations of implementation before using attempt_completion
- **No recaps of changes** - Skip explaining what was done before completion
- **Go directly to completion** - After making changes, proceed directly to attempt_completion without summarizing
- The project is currently an un-released POC / MVP. Do not worry about backward compatibility when making changes
- With React hooks, always complete all hook calls at the top level before any conditional returns (including jotai hook calls useAtom and useAtomValue); when a user explicitly tells you a function handles null inputs, trust them and stop trying to "protect" it with unnecessary checks or workarounds.
- **Match response length to question complexity** - For simple, direct questions in Ask mode (especially those that can be answered in 1-2 sentences), provide equally brief answers. Save detailed explanations for complex topics or when explicitly requested.
- **CRITICAL** - useAtomValue and useAtom are React HOOKS. They cannot be used inline in JSX code, they must appear at the top of a component in the hooks area of the react code.
- for simple functions, we prefer `if (!cond) { return }; functionality;` pattern overn `if (cond) { functionality }` because it produces less indentation and is easier to follow.

### Strict Comment Rules

- **NEVER add comments that merely describe what code is doing**:
  - ❌ `mutex.Lock() // Lock the mutex`
  - ❌ `counter++ // Increment the counter`
  - ❌ `buffer.Write(data) // Write data to buffer`
  - ❌ `// Header component for app run list` (above AppRunListHeader)
  - ❌ `// Updated function to include onClick parameter`
  - ❌ `// Changed padding calculation`
  - ❌ `// Removed unnecessary div`
  - ❌ `// Using the model's width value here`
- **Only use comments for**:
  - Explaining WHY a particular approach was chosen
  - Documenting non-obvious edge cases or side effects
  - Warning about potential pitfalls in usage
  - Explaining complex algorithms that can't be simplified
- **When in doubt, leave it out**. No comment is better than a redundant comment.
- **Never add comments explaining code changes** - The code should speak for itself, and version control tracks changes. The one exception to this rule is if it is a very unobvious implementation. Something that someone would typically implement in a different (wrong) way. Then the comment helps us remember WHY we changed it to a less obvious implementation.

### Jotai Model Pattern (our rules)

- **Atoms live on the model.**
- **Simple atoms:** define as **field initializers**.
- **Atoms that depend on values/other atoms:** create in the **constructor**.
- Models **never use React hooks**; they use `globalStore.get/set`.
- It’s fine to call model methods from **event handlers** or **`useEffect`**.

```ts
// model/MyModel.ts
import { atom, type PrimitiveAtom } from "jotai";
import { globalStore } from "@/app/store/jotaiStore";

export class MyModel {
  // simple atoms (field init)
  statusAtom = atom<"idle" | "running" | "error">("idle");
  outputAtom = atom("");

  // ctor-built atoms (need types)
  lengthAtom!: PrimitiveAtom<number>; // read-only derived via atom(get=>...)
  thresholdedAtom!: PrimitiveAtom<boolean>;

  constructor(initialThreshold = 20) {
    this.lengthAtom = atom((get) => get(this.outputAtom).length);
    this.thresholdedAtom = atom((get) => get(this.lengthAtom) > initialThreshold);
  }

  async doWork() {
    globalStore.set(this.statusAtom, "running");
    try {
      for await (const chunk of this.stream()) {
        globalStore.set(this.outputAtom, (prev) => prev + chunk);
      }
      globalStore.set(this.statusAtom, "idle");
    } catch {
      globalStore.set(this.statusAtom, "error");
    }
  }

  private async *stream() {
    /* ... */
  }
}
```

```tsx
// component usage (events & effects OK)
import { useAtomValue } from "jotai";

function Panel({ model }: { model: MyModel }) {
  const status = useAtomValue(model.statusAtom);
  const isBig = useAtomValue(model.thresholdedAtom);

  const onClick = () => model.doWork();
  // useEffect(() => { model.doWork() }, [model])

  return (
    <div>
      {status} • {String(isBig)}
    </div>
  );
}
```

**Remember:** atoms on the model, simple-as-fields, ctor for dependent/derived, updates via `globalStore.set/get`.

### Tool Use

Do NOT use write_to_file unless it is a new file or very short. Always prefer to use replace_in_file. Often your diffs fail when a file may be out of date in your cache vs the actual on-disk format. You should RE-READ the file and try to create diffs again if your diffs fail rather than fall back to write_to_file. If you feel like your ONLY option is to use write_to_file please ask first.

Also when adding content to the end of files prefer to use the new append_file tool rather than trying to create a diff (as your diffs are often not specific enough and end up inserting code in the middle of existing functions).

### Directory Awareness

- **ALWAYS verify the current working directory before executing commands**
- Either run "pwd" first to verify the directory, or do a "cd" to the correct absolute directory before running commands
- When running tests, do not "cd" to the pkg directory and then run the test. This screws up the cwd and you never recover. run the test from the project root instead.

### Testing / Compiling Go Code

No need to run a `go build` or a `go run` to just check if the Go code compiles. VSCode's errors/problems cover this well.
If there are no Go errors in VSCode you can assume the code compiles fine.
