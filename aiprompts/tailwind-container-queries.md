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

#### Max-Width Container Queries

For max-width queries, use `@max-` prefix:

```html
<div class="@container">
  <!-- Shows on small containers, hides on large -->
  <div class="block @max-sm:hidden">Only on containers < sm</div>
  
  <!-- Custom breakpoint -->
  <div class="@max-w600:fixed @max-w600:bg-background">
    Fixed overlay on small, normal on large
  </div>
</div>
```

- `@max-sm:` = max-width query (container **below** sm breakpoint)
- `@sm:` = min-width query (container **at or above** sm breakpoint)

**IMPORTANT**: The syntax is `@max-w600:` NOT `max-@w600:` (prefix comes before the @)

#### Notes

- Based on native CSS container queries (well supported in modern browsers).
- Breakpoints for container queries reuse Tailwind’s `sm`, `md`, `lg`, etc. scales.
- Safe for modern webapps; no IE/legacy support.

We have special breakpoints set up for panels:

    --container-w600: 600px;
    --container-w450: 450px;
    --container-xs: 300px;
    --container-xxs: 200px;
    --container-tiny: 120px;

since often sm, md, and lg are too big for panels.

Usage examples:

```html
<!-- Min-width (container >= 600px) -->
<div class="@w600:block @w600:h-full">

<!-- Max-width (container < 600px) -->
<div class="@max-w600:hidden @max-w600:fixed">

<!-- Smaller breakpoints -->
<div class="@xs:ml-4 @max-xxs:p-2">
```
