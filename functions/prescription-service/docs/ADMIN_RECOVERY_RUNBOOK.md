# Conceptual Design Guidance: Administrative Triage for Prescriptions in `transition_recovering`

> [!WARNING]
> **NON-EXECUTABLE DESIGN GUIDANCE ONLY — DO NOT EXECUTE AGAINST ANY ENVIRONMENT**  
> This document provides conceptual design guidance and architectural analysis. It does **not** provide an executable runbook or safe manual recovery instructions. The pseudocode and procedures described herein must **not** be executed manually or scripted against production, staging, or test environments.
>
> Unconditional `updateDocument` calls cannot provide database-enforced fencing against delayed in-flight writes, and merely altering write order does not establish transactional safety. A safe, coordinated administrative recovery mechanism remains a future engineering objective requiring dedicated database primitives and extensive multi-worker verification.

---

## 1. Problem Statement: Coordination Deadlock vs. Data Consistency

The **Hardened Prescription Service** uses monotonic versioned transition documents (`tx_<rxId>_v<N>`) to coordinate state machine mutations.

When an operation (routing or reassignment) encounters an uncertain database outcome (e.g., transport timeout during write) or an unsuccessful recovery (e.g., child item rollback or quarantine failure), the service intentionally locks the coordination state into `transition_recovering`.

* **Consistency Property**: While in `transition_recovering`, all subsequent routing, reassignment, or state-change requests from any worker are rejected with **HTTP 409 Conflict**. This prevents competing workers from modifying state while in an indeterminate condition.
* **Liveness Impact**: Because coordination remains blocking, the patient's prescription request cannot proceed automatically. It remains stuck until an administrator can safely resolve the underlying database state.

---

## 2. Analysis of Recovery Architectural Challenges

Previous attempts to define an administrative recovery procedure revealed critical distributed systems hurdles that cannot be solved by ad-hoc scripts or manual updates:

### 2.1 Lack of Server-Enforced Conditional Updates
Appwrite's document update API (`databases.updateDocument`) performs unconditional document replacements. It does not provide server-side optimistic concurrency control (OCC) or conditional attribute assertions (e.g., `UPDATE ... WHERE version = expectedVersion`).
* **Consequence**: Storing a higher `version` attribute in a metadata field does **not** automatically reject delayed writes. If Worker 1's initial write timed out on the client but was queued on the server, that write can still execute and overwrite subsequent changes made by an administrator or another worker.
* **Takeaway**: Incremented version numbers in document bodies provide application-level tracking, not database-enforced fencing.

### 2.2 The Two-Phase Finalization Ordering Dilemma
Without atomic multi-document transactions across collections, updating the parent prescription and finalizing the transition document cannot occur simultaneously:
* **If `active_tx` is cleared on the parent before finalizing the transition**: A race window is opened where a concurrent worker observes `active_tx: null` and claims a new transition while the old transition is still in `transition_recovering`.
* **If the transition is finalized before clearing `active_tx` on the parent**: A failure between the two operations leaves the parent with `active_tx` pointing to a finalized transition, which may block future actions depending on client checks.
* **Takeaway**: Swapping the order of unconditional writes does not establish safety; atomic or coordinated two-phase commit primitives are required.

### 2.3 Direct Permission Tampering Risks
* **Principle**: Destination pharmacies must **never** be granted `update` permissions on parent prescriptions or child items.
* **Consequence**: Granting `update("team:pharm_team_<id>")` bypasses backend state machine transitions, audit logging, and role verification. Destination pharmacies must strictly receive read-only visibility (`read("team:pharm_team_<id>")`).

### 2.4 Pagination & Partial Cascade Vulnerability
* In a multi-item prescription, child items span multiple pages.
* Any recovery logic that operates on a single page leaves subsequent pages with stale, mismatched pharmacy permissions, resulting in unauthorized data visibility.

---

## 3. Conceptual Requirements for a Safe Recovery Mechanism

Before an administrative recovery tool or procedure can be approved for execution, it must be implemented as a tested service capability satisfying the following requirements:

1. **Cryptographic Operator Authentication**:
   - The operator cannot supply an unauthenticated user ID.
   - Authority must be established via an active session verified with `account.get()`, followed by confirmed membership (`confirm === true`) and an administrative role in `MANAGEMENT_TEAM_ID`.

2. **Strict Halt on Unknown Coordination**:
   - If the active transition document cannot be read from the database, recovery must halt immediately. Proceeding without reading coordination state reintroduces unfenced writes.

3. **Database-Enforced Fencing / Mutual Exclusion**:
   - Administrative actions must themselves be coordinated through unique document constraints (e.g., claiming an administrative transition document) or database-level mutual exclusion to prevent concurrent administrator collisions.

4. **Exhaustive Iteration**:
   - All child items must be paged to completion using cursor-based pagination.

5. **Formal Verification Suite**:
   - Must be accompanied by automated integration tests proving safety against:
     - Delayed server-side write completion.
     - Concurrent administrator invocations.
     - Network failure at each point in the sequence.

---

## 4. Current Operational Posture

Until a coordinated, fully tested administrative recovery mechanism is built:
* **Do NOT execute automated reconciliation scripts.**
* Prescriptions entering `transition_recovering` must be triaged on a case-by-case basis by engineering, with direct database inspection to determine whether writes actually persisted on Appwrite Cloud.
* PR #246 maintains strict blocking in `transition_recovering` as the correct, fail-closed safety default to prevent data corruption.
