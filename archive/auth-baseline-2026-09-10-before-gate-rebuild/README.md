# Auth screen baseline — 2026-09-10

Snapshot of the sign-in screen as it was before the from-scratch "access gate"
rebuild. Kept so the old version can be restored or referenced later.

- `AuthPanel.tsx` — the component as it lived at `src/components/auth/AuthPanel.tsx`
- `auth-screen.css` — section 15 of `src/app/globals.css` (`.auth-*`, `.google-action`,
  `.notice`, `.auth-spinner`, route-state header) at the time of the snapshot

To restore: copy `AuthPanel.tsx` back over the component and paste the CSS back into
the auth section of `globals.css`, replacing the `.gate-*` rules.
