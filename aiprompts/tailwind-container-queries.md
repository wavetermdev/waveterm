### Tailwind v4 Container Queries (Quick Overview)

- **Viewport breakpoints**: `sm:`, `md:`, `lg:`, etc. → respond to **screen size**.
- **Container queries**: `@sm:`, `@md:`, etc. → respond to **parent element size**.

#### Enable

No plugin needed in **v4** (built-in).
In v3: install `@tailwindcss/container-queries`.

#### Usage

```html
<aside class="@container w-64 bg-gray-100">
  <div class="w-32 @sm:w-48 @md:w-64 bg-blue-500">Content</div>
</aside>
```

- `@container` marks the parent.
- `@sm:` / `@md:` refer to **container width**, not viewport.

#### Notes

- Based on native CSS container queries (well supported in modern browsers).
- Breakpoints for container queries reuse Tailwind’s `sm`, `md`, `lg`, etc. scales.
- Safe for modern webapps; no IE/legacy support.

we have special breakpoints set up for panels:

    --container-xs: 300px;
    --container-xxs: 200px;
    --container-tiny: 120px;

since often sm, md, and lg are too big for panels.

so to use you'd do:

@xs:ml-4
