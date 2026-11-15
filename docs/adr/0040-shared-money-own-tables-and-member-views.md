# ADR-0040 — Shared money: own tables, a synced view per member

- **Date:** 2026-11-15
- **Status:** accepted
- **Deciders:** Kai (owner), Claude (implementation)

## Context

Kai asked for money two people share, starting with a loan between partners:
one paid for a ₱12,000 item, the other pays it back in monthly installments,
attaching proof of each payment, and the lender confirms in the app that the
month is paid. Shared savings goals and shared budgets follow the same shape.

Every finance row is owned by one user, and the sync pull is owner-scoped
(ADR-0011): a row owned by the lender never reaches the borrower's phone.
Social rows, the one cross-user data we had, are served by REST and events
only, so they do not work offline. Finance does, and a loan lives in Finance.

## Decision

1. **A shared object is its own tables, never a row of somebody's ledger.**
   `loan` (owned by the lender, naming the borrower), `loan_payment` (owned by
   whoever wrote it) and `loan_event` (the append-only audit trail). Who may
   read or act is decided in the service: the two members only, anyone else
   gets a natural 404; the wrong member gets 403 (a borrower cannot accept
   their own payment, a lender cannot send one in the borrower's name).
2. **Each member's own ledger gets its own linked records.** Confirming a
   payment books income in the lender's chosen account and an expense in the
   account the borrower paid from, each with an id derived from the payment,
   linked from the payment row. No endpoint writes another member's records.
3. **Propose / accept is append-only.** A payment's status leaves `sent` once;
   a database trigger keeps a decided payment's amount, date, kind and
   decision final, and another refuses any UPDATE of `loan_event`. Every write
   locks the loan row, so a second accept (another tap, another device) waits
   and answers idempotently.
4. **Each member gets a synced view.** `shared_member` holds one row per member
   per shared object, owned by that member and written only by the server: the
   member's role and a snapshot of the object as that member may see it (the
   other member's accounts and records left out). The owner-scoped pull brings
   it to the phone, so loans read offline; every write is a domain action
   (`finance.loan.*`) queued in the outbox like any other.
5. **Who can share with whom** comes from the social graph: either person
   follows the other. The borrower still has to accept the loan.

## Constitution clause deviated from

None. The tables follow the owned-row defaults (sync-version trigger, tenant
row-level security, soft-delete column).

## Consequences

**Positive:**
- Loans work offline in both directions, with the same outbox and pull as the
  rest of Finance.
- Nothing silently overwrites a decision: the database refuses it.
- Shared savings goals and shared budgets reuse `shared_member` (a new `kind`)
  and the propose/accept pattern.

**Negative:**
- A snapshot is rewritten on every change of the loan; fine for the handful of
  payments a loan has.
- Presigned proof-photo URLs cannot live in a snapshot: the phone fetches them
  when the loan opens online.
- A cash payment recorded by the lender is booked in the lender's ledger only
  (the borrower's account is not known).

**Follow-ups:**
- Shared savings goals and shared budgets on the same pattern.
