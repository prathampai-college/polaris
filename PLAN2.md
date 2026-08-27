# PLAN 2: Implement Automerge CRDTs for Robust Offline Sync

## Objective
Replace the current pessimistic locking and simple patching sync mechanism with a mathematically robust Conflict-Free Replicated Data Type (CRDT) system using `automerge`.

## Current State
- Sync relies on `msgpack` deltas, ULID idempotency, and version increments.
- HQ applies changes sequentially. If a client attempts to decrement an asset below zero concurrently, it relies on a pessimistic `SELECT ... FOR UPDATE` lock at the HQ to reject the change (`CONFLICT_CRITICAL`).
- This limits peer-to-peer (tablet-to-tablet) syncing and can cause painful rollbacks if multiple offline tablets modify the same assets.

## Actionable Steps
1. **Dependencies:** Install `@automerge/automerge` in the `shared`, `field`, and `sync-gateway` (or backend) environments.
2. **Schema Update:** Modify the SQLite `assets` and `indents` tables (or add a new column) to store the Automerge binary document state alongside the standard relational data.
3. **Local Operations (Field):**
   - When an asset is consumed (`field/lib/db.ts`), apply the change directly to the local Automerge document first.
   - Generate an Automerge incremental sync message instead of the current custom patch dictionary.
4. **Sync Protocol (Wire):**
   - Transmit Automerge sync messages wrapped in the existing AES-GCM/CRC payload.
5. **HQ Resolution:**
   - The HQ backend maintains the master Automerge document.
   - Upon receiving a sync message, HQ applies it. Automerge automatically handles merging concurrent changes without requiring explicit locks or version conflict errors.

## Impact
Upgrades the offline sync from a "best-effort patch" system to a true local-first application. This proves extreme resilience for air-gapped Antarctic stations, allowing tablets to even sync directly with each other via local mesh networks in the future without HQ arbitration.
