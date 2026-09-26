# Data protection — deletion, retention, export

How the backend handles personal data: what it stores, how a record is
removed, how long anything is kept, and how a user's data is exported or
erased. Credentials are out of scope here — they live in Supabase Auth, never
in the application database.

## Personal data held

| Entity | Personal data | Where |
|--------|---------------|-------|
| `user` | email, full name | `user` table (a mirror of the Supabase Auth identity, keyed by the auth UID) |
| `item` | user-authored content | `item` table, `owner_id` → `user` |

## Two ways a record leaves the app

There are two distinct operations. They are not interchangeable — pick by
whether the removal must be reversible.

### Soft delete (reversible retention)

`deleted_at` (a nullable timestamp on `user` and `item`) is the soft-delete
marker. A non-null `deleted_at` means the row is **logically deleted but
retained**:

- It disappears from normal reads. `item` reads (`get_by_id`, `get_multi`)
  filter `deleted_at IS NULL`, so a soft-deleted item is a natural 404.
- The row and its data are kept until an explicit hard delete purges them.
- For a `user`, `soft_delete_user` also sets `is_active = False`, so the
  account is rejected at the auth boundary (the `is_active` gate) even while
  the row is retained.

Use it when a removal might need to be undone, or when a record must be kept
for a retention window before final purge.

Helpers: `items.repo.soft_delete`, `iam.users.services.soft_delete_user`.

### Hard delete / erasure (irreversible)

The existing delete path is a true erasure — it satisfies the GDPR right to
erasure:

- `delete_user` / `delete_user_me` revoke the Supabase Auth identity **first**
  (so a provider failure leaves nothing changed), then hard-delete the local
  row; the user's items cascade.
- `items.repo.delete` hard-deletes a single item.

Once erased, the data is gone. There is no undo.

## Retention posture

The template ships **no automatic purge**. Soft-deleted rows are retained
indefinitely until an operator runs an erasure. Choose a retention window for
your deployment and purge soft-deleted rows past it — e.g. a scheduled job
that hard-deletes `user`/`item` rows whose `deleted_at` is older than the
window. This is deliberately left to the deployer: retention duration is a
policy decision, not a code default.

## Data export (portability)

`iam.users.services.export_user_data(session, user_id)` returns a portable
dict of everything held about one user — their profile row plus **all** their
items, including retained soft-deleted ones (an export must return all data
still held). It contains no credentials.

```python
{
  "user":  { ... profile fields ... },
  "items": [ { ... }, ... ],
}
```

Serialize it to JSON to hand to the data subject.

## Audit trail

Every privileged/mutating action (user create/update/delete, MCP and tool
CRUD) writes an append-only row to `auditlog` — actor, action, target,
before/after snapshot, and timestamp — for account-takeover / privilege-
escalation forensics and accountability. Snapshots carry only non-secret
fields: connection secrets (MCP/tool `config`) are never captured. See
`app/modules/audit/`.

## Account email changes

An account's email is the anchor for recovery and magic-link sign-in, so it
may only change once ownership of the new address is verified. Self-service
(`PATCH /users/me`) therefore **does not** change the email — it is refused
until a verified, double-confirmation change flow is available (see
ADR-0008). A superuser can still set a user's email through the admin update
path.
