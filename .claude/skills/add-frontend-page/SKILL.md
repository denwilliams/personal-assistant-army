---
name: add-frontend-page
description: Use when adding a new page to the React frontend. Covers every touchpoint — the page file, route registration in App.tsx, sidebar nav entry, the server-side catch-all route, and API client wiring.
---

# Adding a new frontend page

Every page requires edits in **at least four** places. Miss one and the page 404s or the sidebar forgets it exists.

## 1. Create the page component

File: `frontend/src/pages/WidgetsPage.tsx`. Default-export a React component. Follow the conventions used by `SkillsPage.tsx`:

- Pull data with `api.widgets.list()` from `frontend/src/lib/api.ts`.
- Keep local UI state in `useState`. There is no global store — `AuthContext` is the only context.
- Use ShadCN components from `@/components/ui/*` (they live in `frontend/src/components/ui/`).
- Include a `<SidebarTrigger />` at the top of the page for the collapsible sidebar.
- Wrap destructive actions in `confirm(...)`.

Example skeleton:

```tsx
import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { api, type Widget } from "../lib/api";

export default function WidgetsPage() {
  const [widgets, setWidgets] = useState<Widget[]>([]);
  useEffect(() => {
    api.widgets.list().then(setWidgets).catch(console.error);
  }, []);
  return (
    <div className="p-6">
      <SidebarTrigger />
      <h1 className="text-2xl font-semibold mb-4">Widgets</h1>
      {/* … */}
    </div>
  );
}
```

## 2. Add the API client entries

In `frontend/src/lib/api.ts`:

- Export a `Widget` interface near the top (matches the backend JSON shape; dates are strings).
- Inside the `api` object, add a `widgets: { list, create, update, delete }` section mirroring `skills` / `urlTools`.

## 3. Register the route in `App.tsx`

`frontend/src/App.tsx`:

1. `import WidgetsPage from "./pages/WidgetsPage";`
2. Add `<Route path="/widgets" element={<WidgetsPage />} />` inside the authenticated `<AppLayout />` block (alongside `/skills`, `/schedules`, etc.).

## 4. Add the sidebar entry

`frontend/src/components/AppSidebar.tsx`:

- Import a suitable icon from `lucide-react`.
- Append to `NAV_ITEMS` (or a similar group): `{ label: "Widgets", path: "/widgets", icon: Package }`.
- If the page needs a badge (like `Notifications`), create a hook matching `useUnreadNotificationCount` and render a `<SidebarMenuBadge>`.

## 5. Register the server-side catch-all

`index.ts`, in `startServer()`, inside the `routes` object there is a block of top-level paths that serve `indexHtml`:

```ts
const routes: Record<string, any> = {
  "/": indexHtml,
  "/login": indexHtml,
  "/profile": indexHtml,
  "/agents": indexHtml,
  // …
};
```

**Add** `"/widgets": indexHtml,` to that list. Without this, a hard reload on `/widgets` or direct link returns the API 404 instead of the React shell.

## 6. Styling notes

- Tailwind v4.1 is CSS-first — no `tailwind.config.js`. Theme extensions go in `frontend/src/index.css` under `@theme`.
- Do not install shadcn via npm — use `bunx --bun shadcn@latest add <component>` which copies files into `frontend/src/components/ui/`.
- The `cn()` helper used by shadcn components lives at `@/lib/utils` (resolving to `lib/utils.ts`).

## 7. Verify

Run the dev server and open the new page in a browser, exercising both navigation-from-sidebar and hard-reload-on-URL. See the `run-and-verify` skill.
