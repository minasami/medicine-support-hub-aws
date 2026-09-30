// functions/prescription-service/src/main.js
// Node 22 ESM Serverless Function for Medicine Support Hub
// Hardened Prescription Ingestion & Access Gateway with Monotonically Versioned State Transitions

import crypto from 'node:crypto';
import {
  Client as DefaultClient,
  Databases as DefaultDatabases,
  Storage as DefaultStorage,
  Teams as DefaultTeams,
  Account as DefaultAccount,
  Query as DefaultQuery,
  ID as DefaultID,
  Permission as DefaultPermission,
  Role as DefaultRole,
} from 'node-appwrite';

export const PRODUCTION_RESOURCE_IDS = [
  'medicine_support_hub',
  'prescription-images',
  '6a69695400002dade84d',
];

export const VALID_TRANSITIONS = {
  pending_review: ['routed', 'cancelled'],
  routed: ['accepted', 'reassigned', 'cancelled'],
  accepted: ['dispensed', 'reassigned', 'cancelled'],
  reassigned: ['accepted', 'reassigned', 'cancelled'],
  dispensed: [],
  cancelled: [],
};

export const REQUIRED_ENV_VARS = [
  'DATABASE_ID',
  'MANAGEMENT_TEAM_ID',
  'PRESCRIPTIONS_COLLECTION_ID',
  'ITEMS_COLLECTION_ID',
  'PHARMACIES_COLLECTION_ID',
  'STORAGE_BUCKET_ID',
];

export function createPrescriptionHandler(injected = {}) {
  const Client = injected.Client || DefaultClient;
  const Databases = injected.Databases || DefaultDatabases;
  const Storage = injected.Storage || DefaultStorage;
  const Teams = injected.Teams || DefaultTeams;
  const Account = injected.Account || DefaultAccount;
  const Query = injected.Query || DefaultQuery;
  const ID = injected.ID || DefaultID;
  const Permission = injected.Permission || DefaultPermission;
  const Role = injected.Role || DefaultRole;

  // Active in-process guards to prevent concurrent interleaving within the same execution instance
  const activeLocks = new Set();

  return async function prescriptionHandler({ req, res, log, error }) {
    // 1. Safe Body Parsing (Prevents Unhandled SyntaxErrors / crashes)
    let body = {};
    if (req.bodyJson && typeof req.bodyJson === 'object') {
      body = req.bodyJson;
    } else if (typeof req.body === 'string' && req.body.trim().length > 0) {
      try {
        body = JSON.parse(req.body);
      } catch {
        return res.json({ ok: false, error: 'Malformed request: Invalid JSON body' }, 400);
      }
    } else if (req.body && typeof req.body === 'object') {
      body = req.body;
    }

    // 2. Strict Environment Variable Validation
    const env = injected.env || process.env;
    for (const envVar of REQUIRED_ENV_VARS) {
      if (!env[envVar]) {
        error(`Configuration error: Missing required environment variable '${envVar}'`);
        return res.json({ ok: false, error: `Server configuration error: Missing '${envVar}'` }, 500);
      }
    }

    const DATABASE_ID = env.DATABASE_ID;
    const MANAGEMENT_TEAM_ID = env.MANAGEMENT_TEAM_ID;
    const PRESCRIPTIONS_COLLECTION_ID = env.PRESCRIPTIONS_COLLECTION_ID;
    const ITEMS_COLLECTION_ID = env.ITEMS_COLLECTION_ID;
    const PHARMACIES_COLLECTION_ID = env.PHARMACIES_COLLECTION_ID;
    const STORAGE_BUCKET_ID = env.STORAGE_BUCKET_ID;
    const CLAIMS_COLLECTION_ID = env.CLAIMS_COLLECTION_ID || PRESCRIPTIONS_COLLECTION_ID;

    // Optional environment guard for isolated test runners
    if (injected.rejectProductionResources) {
      const configuredIds = [DATABASE_ID, MANAGEMENT_TEAM_ID, STORAGE_BUCKET_ID];
      const prodCollision = configuredIds.find((id) => PRODUCTION_RESOURCE_IDS.includes(id));
      if (prodCollision) {
        throw new Error(`SECURITY GUARD: Execution rejected - targeting production resource '${prodCollision}'`);
      }
    }

    // 3. Authentication & Header Resolution
    const apiKey = req.headers['x-appwrite-key'] || env.APPWRITE_API_KEY;
    const userJwt = req.headers['x-appwrite-user-jwt'] || req.headers['x-appwrite-jwt'];

    if (!userJwt) {
      return res.json({ ok: false, error: 'Unauthorized: Missing session JWT' }, 401);
    }
    if (!apiKey) {
      error('Server misconfiguration: Missing execution API key');
      return res.json({ ok: false, error: 'Internal server configuration error' }, 500);
    }

    const endpoint = env.APPWRITE_FUNCTION_API_ENDPOINT || 'https://fra.cloud.appwrite.io/v1';
    const projectId = env.APPWRITE_FUNCTION_PROJECT_ID;

    // Initialize Privileged Server Client
    const adminClient = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
    const db = new Databases(adminClient);
    const storage = new Storage(adminClient);
    const teams = new Teams(adminClient);

    // Initialize User Client to Verify Session
    const userClient = new Client().setEndpoint(endpoint).setProject(projectId).setJWT(userJwt);
    const account = new Account(userClient);

    let caller;
    try {
      caller = await account.get();
    } catch (err) {
      error(`Failed to verify caller JWT with /account: ${err.message}`);
      return res.json({ ok: false, error: 'Unauthorized: Invalid or expired session' }, 401);
    }

    const callerId = caller.$id;
    const action = body.action || (req.path && req.path !== '/' ? req.path.replace(/^\//, '') : null);

    // -------------------------------------------------------------------------
    // Authority Verification Helpers (Paginated + includes Administrator role)
    // -------------------------------------------------------------------------

    async function verifyManagementAuthority(userId) {
      if (!userId) return false;
      let offset = 0;
      const limit = 50;
      const allowedRoles = ['admin', 'administrator', 'owner', 'manager'];
      try {
        while (true) {
          const response = await teams.listMemberships(MANAGEMENT_TEAM_ID, [
            Query.limit(limit),
            Query.offset(offset),
          ]);
          const memberships = response.memberships || [];
          const match = memberships.find(
            (m) =>
              m.userId === userId &&
              m.confirm === true &&
              Array.isArray(m.roles) &&
              m.roles.some((r) => allowedRoles.includes(r.toLowerCase().trim()))
          );
          if (match) return true;
          if (memberships.length < limit) break;
          offset += limit;
        }
        return false;
      } catch {
        return false;
      }
    }

    async function verifyPharmacyAuthority(teamId, userId) {
      if (!teamId || !userId) return false;
      let offset = 0;
      const limit = 50;
      const allowedRoles = ['pharmacist', 'pharmacy', 'owner', 'admin', 'administrator'];
      try {
        while (true) {
          const response = await teams.listMemberships(teamId, [
            Query.limit(limit),
            Query.offset(offset),
          ]);
          const memberships = response.memberships || [];
          const match = memberships.find(
            (m) =>
              m.userId === userId &&
              m.confirm === true &&
              Array.isArray(m.roles) &&
              m.roles.some((r) => allowedRoles.includes(r.toLowerCase().trim()))
          );
          if (match) return true;
          if (memberships.length < limit) break;
          offset += limit;
        }
        return false;
      } catch {
        return false;
      }
    }

    async function resolveAuthoritativePharmacyTeam(pharmacyId) {
      try {
        const pharmacy = await db.getDocument(DATABASE_ID, PHARMACIES_COLLECTION_ID, pharmacyId);
        if (!pharmacy || pharmacy.is_active !== true) {
          throw new Error('Pharmacy is inactive, unlisted, or unverified');
        }
        if (!pharmacy.team_id || typeof pharmacy.team_id !== 'string' || !pharmacy.team_id.trim()) {
          throw new Error('Pharmacy lacks an authoritative backing team ID');
        }
        return { pharmacy, teamId: pharmacy.team_id.trim() };
      } catch (err) {
        throw new Error(`Invalid destination pharmacy: ${err.message}`);
      }
    }

    // -------------------------------------------------------------------------
    // Monotonically Versioned State Transition Engine (Database-Enforced Epoch Fencing)
    // Eliminates expiring locks, TTL timeouts, and read-then-delete TOCTOU races
    // -------------------------------------------------------------------------

    function timingSafeEqualStr(a, b) {
      if (typeof a !== 'string' || typeof b !== 'string') return false;
      const bufA = Buffer.from(a, 'utf-8');
      const bufB = Buffer.from(b, 'utf-8');
      if (bufA.length !== bufB.length) return false;
      return crypto.timingSafeEqual(bufA, bufB);
    }

    const baseBackoffMs = Number(env.BACKOFF_BASE_MS || (env.NODE_ENV === 'test' ? 5 : 50));
    async function backoffDelay(attempt, baseMs = baseBackoffMs) {
      const ms = baseMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function claimVersionedTransition(prescriptionId, expectedVersion, targetStatus, callerUserId, actionName, extraDetails = {}) {
      const nextVersion = expectedVersion + 1;
      const baseTxDocId = `tx_${prescriptionId}_v${nextVersion}`;

      // Database-enforced atomic transition claim via append-only attempt documents.
      // If attempt 1 previously aborted, subsequent claims advance to attempt 2, 3, etc.
      // Crucially, NO WORKER EVER DELETES AN ABORTED TRANSITION DOCUMENT, eliminating
      // delete-recreate TOCTOU races between concurrent reclaiming workers.
      let attempt = 1;
      const maxAttempts = 10;

      while (attempt <= maxAttempts) {
        const currentTxDocId = attempt === 1 ? baseTxDocId : `${baseTxDocId}_a${attempt}`;

        const txPayload = {
          user_id: callerUserId,
          status: 'transition_pending',
          image_id: prescriptionId,
          parse_source: 'state_transition',
          confidence_score: 1.0,
          ai_parsed_json: JSON.stringify({
            prescription_id: prescriptionId,
            from_version: expectedVersion,
            to_version: nextVersion,
            attempt,
            action: actionName,
            target_status: targetStatus,
            caller_user_id: callerUserId,
            claimed_at: Date.now(),
            ...extraDetails,
          }),
        };

        const txPermissions = [
          Permission.read(Role.user(callerUserId)),
          Permission.read(Role.team(MANAGEMENT_TEAM_ID)),
        ];

        try {
          await db.createDocument(
            DATABASE_ID,
            PRESCRIPTIONS_COLLECTION_ID,
            currentTxDocId,
            txPayload,
            txPermissions
          );
          return { txDocId: currentTxDocId, nextVersion, claimed: true, attempt };
        } catch (err) {
          if (err.code === 409 || err.message?.includes('already exists')) {
            // Document already exists - inspect its state in the database
            const existingTx = await db.getDocument(DATABASE_ID, PRESCRIPTIONS_COLLECTION_ID, currentTxDocId);
            if (existingTx.status === 'transition_pending' || existingTx.status === 'transition_recovering') {
              throw new Error(`Conflict: A concurrent ${actionName} operation or recovery is already in progress for this prescription (${currentTxDocId} is ${existingTx.status})`);
            }
            if (existingTx.status === 'transition_committed') {
              throw new Error(`Conflict: Version ${nextVersion} has already been committed for this prescription`);
            }
            if (existingTx.status === 'transition_aborted') {
              // The previous attempt aborted. Do NOT delete it!
              // Advance to the next attempt ID and let Appwrite's createDocument atomically arbitrate claims.
              attempt++;
              continue;
            }
            throw new Error(`Conflict: Transition ${currentTxDocId} is in unrecognized status '${existingTx.status}'`);
          }
          throw err;
        }
      }
      throw new Error(`Conflict: Exceeded maximum transition claim attempts (${maxAttempts}) for version ${nextVersion}`);
    }

    async function commitTransition(txDocId, completionDetails = {}) {
      if (!txDocId) return;
      let lastErr = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
          await backoffDelay(attempt - 1, baseBackoffMs);
        }
        try {
          const existingTx = await db.getDocument(DATABASE_ID, PRESCRIPTIONS_COLLECTION_ID, txDocId);
          // Reconcile: If already committed in database (response to previous attempt was lost/timed out), succeed immediately
          if (existingTx && existingTx.status === 'transition_committed') {
            log(`Transition ${txDocId} is already transition_committed in database. Reconciled successfully.`);
            return;
          }
          let meta = {};
          try { meta = JSON.parse(existingTx.ai_parsed_json || '{}'); } catch {}
          await db.updateDocument(
            DATABASE_ID,
            PRESCRIPTIONS_COLLECTION_ID,
            txDocId,
            {
              status: 'transition_committed',
              ai_parsed_json: JSON.stringify({
                ...meta,
                ...completionDetails,
                committed_at: Date.now(),
              }),
            }
          );
          return;
        } catch (err) {
          lastErr = err;
        }
      }

      // Check one last time before throwing: did the update commit despite the network error?
      try {
        const finalTx = await db.getDocument(DATABASE_ID, PRESCRIPTIONS_COLLECTION_ID, txDocId);
        if (finalTx && finalTx.status === 'transition_committed') {
          log(`Transition ${txDocId} confirmed transition_committed on final check. Reconciled successfully.`);
          return;
        }
      } catch {}

      throw new Error(`Failed to commit transition document ${txDocId} after 3 attempts: ${lastErr?.message}`);
    }

    async function setTransitionStatus(txDocId, status, details = {}) {
      if (!txDocId) return;
      let lastErr = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
          await backoffDelay(attempt - 1, baseBackoffMs);
        }
        try {
          const existingTx = await db.getDocument(DATABASE_ID, PRESCRIPTIONS_COLLECTION_ID, txDocId);
          let meta = {};
          try { meta = JSON.parse(existingTx.ai_parsed_json || '{}'); } catch {}
          await db.updateDocument(
            DATABASE_ID,
            PRESCRIPTIONS_COLLECTION_ID,
            txDocId,
            {
              status,
              ai_parsed_json: JSON.stringify({
                ...meta,
                ...details,
                updated_at: Date.now(),
              }),
            }
          );
          return;
        } catch (err) {
          lastErr = err;
        }
      }
      const failMsg = `Failed to update transition document ${txDocId} to '${status}' after 3 attempts: ${lastErr?.message}`;
      error(failMsg);
      throw new Error(failMsg);
    }

    async function abortTransition(txDocId, failureDetails = {}) {
      return setTransitionStatus(txDocId, 'transition_aborted', {
        ...failureDetails,
        aborted_at: Date.now(),
      });
    }

    // Helper: Cascade Child Item ACL Update with Fenced Concurrency Verification & Pagination
    async function cascadeChildItemsAcl(prescriptionId, targetPermissions, expectedParentState, modifiedItems = []) {
      let offset = 0;
      const limit = 50;
      let totalUpdated = 0;

      while (true) {
        // Fenced check before each page
        const parentCurrent = await db.getDocument(DATABASE_ID, PRESCRIPTIONS_COLLECTION_ID, prescriptionId);
        let parentMeta = {};
        try { parentMeta = JSON.parse(parentCurrent.ai_parsed_json || '{}'); } catch {}

        if (
          parentCurrent.$updatedAt !== expectedParentState.updatedAt ||
          parentCurrent.pharmacy_id !== expectedParentState.pharmacyId ||
          parentMeta.version !== expectedParentState.version ||
          parentMeta.active_tx !== expectedParentState.activeTx
        ) {
          throw new Error('Conflict: Prescription was modified concurrently during child cascade (fencing violation)');
        }

        const page = await db.listDocuments(DATABASE_ID, ITEMS_COLLECTION_ID, [
          Query.equal('prescription_id', prescriptionId),
          Query.limit(limit),
          Query.offset(offset),
        ]);

        if (!page || !page.documents || page.documents.length === 0) break;

        for (const item of page.documents) {
          modifiedItems.push({ id: item.$id, prevPermissions: item.$permissions || [] });
          await db.updateDocument(DATABASE_ID, ITEMS_COLLECTION_ID, item.$id, {}, targetPermissions);
          totalUpdated++;
        }

        // Fenced check after each page
        const parentPostCheck = await db.getDocument(DATABASE_ID, PRESCRIPTIONS_COLLECTION_ID, prescriptionId);
        let parentPostMeta = {};
        try { parentPostMeta = JSON.parse(parentPostCheck.ai_parsed_json || '{}'); } catch {}

        if (
          parentPostCheck.$updatedAt !== expectedParentState.updatedAt ||
          parentPostCheck.pharmacy_id !== expectedParentState.pharmacyId ||
          parentPostMeta.version !== expectedParentState.version ||
          parentPostMeta.active_tx !== expectedParentState.activeTx
        ) {
          throw new Error('Conflict: Prescription was modified concurrently during child cascade (fencing violation)');
        }

        if (page.documents.length < limit) break;
        offset += limit;
      }

      return totalUpdated;
    }

    // Helper: Safe Rollback for Child Items with Verified Access Quarantine Guarantee
    async function rollbackChildItems(modifiedItems, targetTeamId) {
      const childErrors = [];
      const quarantineVerificationFailures = [];

      for (const item of modifiedItems) {
        let restored = false;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const updated = await db.updateDocument(DATABASE_ID, ITEMS_COLLECTION_ID, item.id, {}, item.prevPermissions);
            const remainingTargetPerm = (updated.$permissions || []).some((p) => p.includes(`team:${targetTeamId}`));
            if (!remainingTargetPerm) {
              restored = true;
              break;
            }
          } catch (rbErr) {
            if (attempt === 1) {
              childErrors.push(`Failed to restore item ${item.id}: ${rbErr.message}`);
            }
          }
        }

        if (!restored) {
          // Execute Access Quarantine: forcefully strip target team grant
          try {
            const currentItem = await db.getDocument(DATABASE_ID, ITEMS_COLLECTION_ID, item.id);
            const currentPerms = currentItem.$permissions || [];
            const sanitizedPerms = currentPerms.filter((p) => !p.includes(`team:${targetTeamId}`));
            const qUpdated = await db.updateDocument(DATABASE_ID, ITEMS_COLLECTION_ID, item.id, {}, sanitizedPerms);

            // Explicit Verification: Check that the update actually removed the team grant
            const verifyPerms = qUpdated.$permissions || [];
            const hasForbiddenTeam = verifyPerms.some((p) => p.includes(`team:${targetTeamId}`));
            if (hasForbiddenTeam) {
              const verifyMsg = `CRITICAL: Quarantine verification failed for item ${item.id}: team:${targetTeamId} still present`;
              error(verifyMsg);
              quarantineVerificationFailures.push(verifyMsg);
            } else {
              error(`ACCESS QUARANTINE VERIFIED: Stripped team:${targetTeamId} from item ${item.id}`);
            }
          } catch (qErr) {
            const failMsg = `CRITICAL: Quarantine write failed for item ${item.id}: ${qErr.message}`;
            error(failMsg);
            quarantineVerificationFailures.push(failMsg);
          }
        }
      }
      return { childErrors, quarantineVerificationFailures };
    }

    // -------------------------------------------------------------------------
    // 0. ACTION: PREPARE UPLOAD / REGISTER UPLOAD (Cryptographically Bound Provenance)
    // -------------------------------------------------------------------------
    if (
      action === 'prepare_upload' ||
      action === 'register_upload' ||
      action === 'prescriptions.prepare_upload' ||
      action === 'prescriptions.register_upload'
    ) {
      const { file_id, filename, mime_type } = body;
      const cleanFileId = (typeof file_id === 'string' && file_id.trim()) ? file_id.trim() : `rxfile_${ID.unique()}`;
      const uploadDocId = `upload_${cleanFileId}`;
      const uploadToken = `uptok_${ID.unique()}_${Math.random().toString(36).slice(2)}`;

      // If caller provided an existing file_id, verify that file exists in storage and caller has delete permission
      if (typeof file_id === 'string' && file_id.trim()) {
        try {
          const file = await storage.getFile(STORAGE_BUCKET_ID, cleanFileId);
          const hasDeletePermission = file.$permissions?.includes(`delete("user:${callerId}")`);
          const hasReadPermission = file.$permissions?.includes(`read("user:${callerId}")`);
          if (!hasDeletePermission || !hasReadPermission) {
            return res.json(
              { ok: false, error: 'Forbidden: Caller is not the verified owner of this file in storage; delete permission required' },
              403
            );
          }
        } catch (storageErr) {
          if (storageErr.code === 404 || storageErr.message?.includes('not found')) {
            return res.json({ ok: false, error: `Storage file not found: ${cleanFileId}` }, 404);
          }
          return res.json({ ok: false, error: `Storage verification failed: ${storageErr.message}` }, 400);
        }
      }

      // Create upload provenance reservation document
      try {
        const uploadDoc = await db.createDocument(
          DATABASE_ID,
          CLAIMS_COLLECTION_ID,
          uploadDocId,
          {
            user_id: callerId,
            status: 'registered',
            image_id: cleanFileId,
            parse_source: 'upload_workflow',
            confidence_score: 1.0,
            ai_parsed_json: JSON.stringify({
              uploader_id: callerId,
              file_id: cleanFileId,
              upload_token: uploadToken,
              filename: typeof filename === 'string' ? filename.trim() : undefined,
              mime_type: typeof mime_type === 'string' ? mime_type.trim() : undefined,
              authorized_at: Date.now(),
            }),
          },
          [
            Permission.read(Role.user(callerId)),
            Permission.read(Role.team(MANAGEMENT_TEAM_ID)),
          ]
        );
        return res.json({
          ok: true,
          file_id: cleanFileId,
          upload_token: uploadToken,
          bucket_id: STORAGE_BUCKET_ID,
          claim: uploadDoc,
        }, 201);
      } catch (err) {
        if (err.code === 409 || err.message?.includes('already exists')) {
          try {
            const existing = await db.getDocument(DATABASE_ID, CLAIMS_COLLECTION_ID, uploadDocId);
            if (existing.user_id !== callerId) {
              return res.json({ ok: false, error: 'Forbidden: File ID registered by another user' }, 403);
            }
            return res.json({ ok: false, error: 'Conflict: File upload already registered' }, 409);
          } catch {
            return res.json({ ok: false, error: 'Conflict: File upload already registered' }, 409);
          }
        }
        return res.json({ ok: false, error: err.message }, 500);
      }
    }

    // -------------------------------------------------------------------------
    // 1. ACTION: CREATE PRESCRIPTION (Gateway Ingestion with Atomic Image Claim)
    // -------------------------------------------------------------------------
    if (action === 'create' || action === 'prescriptions.create') {
      let claimCreated = false;
      let claimDocId = null;

      try {
        const { items = [], image_id, upload_token } = body;

        if (!Array.isArray(items) || items.length === 0) {
          return res.json({ ok: false, error: 'Prescription must contain at least one valid medication item' }, 400);
        }

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (!item || typeof item !== 'object' || !item.drug_name || typeof item.drug_name !== 'string' || !item.drug_name.trim()) {
            return res.json({ ok: false, error: `Item at index ${i} is missing required 'drug_name'` }, 400);
          }
        }

        let cleanImageId = null;
        if (image_id) {
          cleanImageId = image_id.trim();
          const uploadDocId = `upload_${cleanImageId}`;
          claimDocId = `claim_${cleanImageId}`;

          // 1. Enforce required upload token
          if (!upload_token || typeof upload_token !== 'string' || !upload_token.trim()) {
            return res.json({ ok: false, error: "Missing required 'upload_token' for referenced image" }, 400);
          }

          // 2. Verify upload provenance reservation exists, belongs to caller, and is in 'registered' status
          let uploadRec;
          try {
            uploadRec = await db.getDocument(DATABASE_ID, CLAIMS_COLLECTION_ID, uploadDocId);
          } catch (getRegErr) {
            if (getRegErr.code === 404 || getRegErr.message?.includes('not found')) {
              return res.json(
                { ok: false, error: 'Invalid image reference: Image must be registered via prepare_upload prior to ingestion' },
                400
              );
            }
            throw getRegErr;
          }

          if (uploadRec.user_id !== callerId) {
            return res.json(
              { ok: false, error: 'Forbidden: Referenced image is registered or claimed by another user' },
              403
            );
          }

          if (uploadRec.status !== 'registered') {
            return res.json(
              { ok: false, error: `Invalid image reservation: Upload reservation is in '${uploadRec.status}' status (must be 'registered')` },
              400
            );
          }

          // 3. Validate cryptographic upload token match using timing-safe comparison
          let uploadMeta = {};
          try { uploadMeta = JSON.parse(uploadRec.ai_parsed_json || '{}'); } catch {}
          if (!uploadMeta.upload_token || !timingSafeEqualStr(uploadMeta.upload_token, upload_token.trim())) {
            return res.json(
              { ok: false, error: 'Forbidden: Invalid or mismatched upload token for referenced image' },
              403
            );
          }

          // 4. Verify file in storage genuinely exists and caller holds delete permission
          try {
            const file = await storage.getFile(STORAGE_BUCKET_ID, cleanImageId);
            const hasDeletePermission = file.$permissions?.includes(`delete("user:${callerId}")`);
            if (!hasDeletePermission) {
              return res.json(
                { ok: false, error: 'Forbidden: Caller is not the verified uploader in storage; delete permission required' },
                403
              );
            }
          } catch (storageErr) {
            if (storageErr.code === 404 || storageErr.message?.includes('not found')) {
              return res.json({ ok: false, error: `Storage file not found: ${cleanImageId}` }, 404);
            }
            return res.json({ ok: false, error: `Invalid image reference: ${storageErr.message}` }, 400);
          }

          // 5. Atomic Database Claim via Document Uniqueness
          try {
            await db.createDocument(
              DATABASE_ID,
              CLAIMS_COLLECTION_ID,
              claimDocId,
              {
                user_id: callerId,
                status: 'claimed',
                image_id: cleanImageId,
                parse_source: 'image_claim',
                confidence_score: 1.0,
                ai_parsed_json: JSON.stringify({
                  claimed_by: callerId,
                  upload_token_verified: true,
                  claimed_at: Date.now(),
                }),
              },
              [
                Permission.read(Role.user(callerId)),
                Permission.read(Role.team(MANAGEMENT_TEAM_ID)),
              ]
            );
            claimCreated = true;
          } catch (claimErr) {
            if (claimErr.code === 409 || claimErr.message?.includes('already exists')) {
              try {
                const existingClaim = await db.getDocument(DATABASE_ID, CLAIMS_COLLECTION_ID, claimDocId);
                if (existingClaim.user_id !== callerId) {
                  return res.json(
                    { ok: false, error: 'Forbidden: Referenced image is registered or claimed by another user' },
                    403
                  );
                }
              } catch {}
              return res.json(
                { ok: false, error: 'Conflict: Referenced image has already been claimed by a completed or active prescription creation' },
                409
              );
            }
            return res.json({ ok: false, error: `Failed to register image claim: ${claimErr.message}` }, 500);
          }

          // 6. Transition upload reservation status from 'registered' to 'claimed'
          try {
            await db.updateDocument(
              DATABASE_ID,
              CLAIMS_COLLECTION_ID,
              uploadDocId,
              {
                status: 'claimed',
                ai_parsed_json: JSON.stringify({
                  ...uploadMeta,
                  status: 'claimed',
                  claimed_by: callerId,
                  claimed_at: Date.now(),
                }),
              }
            );
          } catch (updateUploadErr) {
            error(`Warning: Failed to update upload reservation ${uploadDocId} to claimed: ${updateUploadErr.message}`);
          }
        }

        const prescriptionId = ID.unique();
        const prescriptionPermissions = [
          Permission.read(Role.user(callerId)),
          Permission.read(Role.team(MANAGEMENT_TEAM_ID)),
        ];

        const prescriptionData = {
          user_id: callerId,
          status: 'pending_review',
          image_id: cleanImageId || null,
          parse_source: 'gateway_v1',
          confidence_score: 1.0,
          ai_parsed_json: JSON.stringify({
            version: 1, // Monotonic version starts at 1
            items_count: items.length,
            ingested_at: Date.now(),
          }),
        };

        const prescription = await db.createDocument(
          DATABASE_ID,
          PRESCRIPTIONS_COLLECTION_ID,
          prescriptionId,
          prescriptionData,
          prescriptionPermissions
        );

        const createdItemIds = [];
        try {
          for (const item of items) {
            const itemId = ID.unique();
            const itemData = {
              prescription_id: prescriptionId,
              drug_name: item.drug_name.trim(),
              quantity: item.quantity || 1,
              dosage: item.dosage || '',
              instructions: item.instructions || '',
            };

            await db.createDocument(
              DATABASE_ID,
              ITEMS_COLLECTION_ID,
              itemId,
              itemData,
              prescriptionPermissions
            );
            createdItemIds.push(itemId);
          }
        } catch (itemErr) {
          error(`Failed during item creation for prescription ${prescriptionId}: ${itemErr.message}. Executing rollback.`);
          const deletionErrors = [];

          for (const itemId of createdItemIds) {
            try {
              await db.deleteDocument(DATABASE_ID, ITEMS_COLLECTION_ID, itemId);
            } catch (delErr) {
              deletionErrors.push(`Failed to delete item ${itemId}: ${delErr.message}`);
            }
          }

          try {
            await db.deleteDocument(DATABASE_ID, PRESCRIPTIONS_COLLECTION_ID, prescriptionId);
          } catch (delErr) {
            deletionErrors.push(`Failed to delete prescription ${prescriptionId}: ${delErr.message}`);
          }

          if (claimCreated && claimDocId) {
            try {
              await db.deleteDocument(DATABASE_ID, CLAIMS_COLLECTION_ID, claimDocId);
            } catch (delClaimErr) {
              deletionErrors.push(`Failed to release claim ${claimDocId}: ${delClaimErr.message}`);
            }
          }

          if (cleanImageId) {
            const uploadDocId = `upload_${cleanImageId}`;
            try {
              const currentUpload = await db.getDocument(DATABASE_ID, CLAIMS_COLLECTION_ID, uploadDocId);
              let curMeta = {};
              try { curMeta = JSON.parse(currentUpload.ai_parsed_json || '{}'); } catch {}
              await db.updateDocument(DATABASE_ID, CLAIMS_COLLECTION_ID, uploadDocId, {
                status: 'registered',
                ai_parsed_json: JSON.stringify({
                  ...curMeta,
                  status: 'registered',
                  claim_reverted_at: Date.now(),
                }),
              });
            } catch (revErr) {
              deletionErrors.push(`Failed to revert upload reservation ${uploadDocId}: ${revErr.message}`);
            }
          }

          if (deletionErrors.length > 0) {
            error(`Rollback encountered deletion failures: ${deletionErrors.join('; ')}`);
            return res.json(
              {
                ok: false,
                error: `Prescription creation failed and cleanup had errors: ${itemErr.message}`,
                deletionErrors,
                prescription_id: prescriptionId,
              },
              500
            );
          }

          return res.json({ ok: false, error: `Failed to create prescription items: ${itemErr.message}` }, 500);
        }

        return res.json({ ok: true, prescription, itemsCount: createdItemIds.length }, 201);
      } catch (err) {
        error(`Unhandled error during prescription creation: ${err.message}`);
        if (claimCreated && claimDocId) {
          try {
            await db.deleteDocument(DATABASE_ID, CLAIMS_COLLECTION_ID, claimDocId);
          } catch {}
        }
        return res.json({ ok: false, error: err.message }, 500);
      }
    }

    // -------------------------------------------------------------------------
    // 2. ACTION: ROUTE PRESCRIPTION (Monotonically Versioned State Transition)
    // -------------------------------------------------------------------------
    if (action === 'route' || action === 'prescriptions.route') {
      const { prescription_id, pharmacy_id } = body;
      if (!prescription_id || !pharmacy_id) {
        return res.json({ ok: false, error: 'prescription_id and pharmacy_id are required' }, 400);
      }

      if (activeLocks.has(prescription_id)) {
        return res.json({ ok: false, error: 'Conflict: In-process operation already running for this prescription' }, 409);
      }
      activeLocks.add(prescription_id);

      let txDocId = null;

      try {
        // 1. Read existing prescription
        const existing = await db.getDocument(DATABASE_ID, PRESCRIPTIONS_COLLECTION_ID, prescription_id);

        // 2. Authorize caller FIRST before status checks
        const isOwner = existing.user_id === callerId;
        const isManagement = await verifyManagementAuthority(callerId);
        if (!isOwner && !isManagement) {
          return res.json({ ok: false, error: 'Forbidden: Caller not authorized to route prescription' }, 403);
        }

        let meta = {};
        try { meta = JSON.parse(existing.ai_parsed_json || '{}'); } catch {}
        const currentVersion = typeof meta.version === 'number' ? meta.version : 1;

        // 3. Fenced Concurrency Check: Active transition still pending or recovering blocks subsequent operations
        if (meta.active_tx) {
          try {
            const activeTxDoc = await db.getDocument(DATABASE_ID, PRESCRIPTIONS_COLLECTION_ID, meta.active_tx);
            if (activeTxDoc && (activeTxDoc.status === 'transition_pending' || activeTxDoc.status === 'transition_recovering')) {
              return res.json({
                ok: false,
                error: `Conflict: A concurrent routing operation is already in progress or recovering for this prescription (${meta.active_tx} is ${activeTxDoc.status})`,
              }, 409);
            }
          } catch (txGetErr) {
            if (txGetErr.code !== 404 && !txGetErr.message?.includes('not found')) {
              throw txGetErr;
            }
          }
        }

        // 4. Validate state machine transition
        if (!VALID_TRANSITIONS[existing.status]?.includes('routed')) {
          return res.json(
            { ok: false, error: `Invalid transition: cannot route prescription currently in '${existing.status}' status` },
            400
          );
        }

        // 5. Resolve destination pharmacy team
        const { teamId: pharmacyTeamId } = await resolveAuthoritativePharmacyTeam(pharmacy_id);

        try {
          const claimRes = await claimVersionedTransition(
            prescription_id,
            currentVersion,
            'routed',
            callerId,
            'routing',
            { target_pharmacy_id: pharmacy_id, pharmacy_team_id: pharmacyTeamId }
          );
          txDocId = claimRes.txDocId;
        } catch (claimErr) {
          return res.json({ ok: false, error: claimErr.message }, 409);
        }

        const nextVersion = currentVersion + 1;
        const targetPermissions = [
          Permission.read(Role.user(existing.user_id)),
          Permission.read(Role.team(MANAGEMENT_TEAM_ID)),
          Permission.read(Role.team(pharmacyTeamId)),
        ];

        const prevStatus = existing.status;
        const prevPharmacyId = existing.pharmacy_id || null;
        const prevPermissions = existing.$permissions || [
          Permission.read(Role.user(existing.user_id)),
          Permission.read(Role.team(MANAGEMENT_TEAM_ID)),
        ];

        // 6. Update parent prescription with fenced version and active transition ID
        let updatedPrescription;
        try {
          updatedPrescription = await db.updateDocument(
            DATABASE_ID,
            PRESCRIPTIONS_COLLECTION_ID,
            prescription_id,
            {
              status: 'routed',
              pharmacy_id,
              ai_parsed_json: JSON.stringify({
                ...meta,
                version: nextVersion,
                active_tx: txDocId,
                last_action: 'route',
                updated_at: Date.now(),
              }),
            },
            targetPermissions
          );
        } catch (parentErr) {
          error(`Parent update threw error during routing of ${prescription_id}: ${parentErr.message}. Reconciling database state.`);
          // Reconcile uncertain write outcome: read parent from database to verify if write actually committed
          let reconciled = null;
          try {
            reconciled = await db.getDocument(DATABASE_ID, PRESCRIPTIONS_COLLECTION_ID, prescription_id);
          } catch (reconcileErr) {
            error(`Failed to reconcile parent state after error: ${reconcileErr.message}`);
          }

          let reconciledMeta = {};
          if (reconciled) {
            try { reconciledMeta = JSON.parse(reconciled.ai_parsed_json || '{}'); } catch {}
          }

          const writeCommitted = Boolean(
            reconciled &&
            reconciledMeta.version === nextVersion &&
            reconciledMeta.active_tx === txDocId
          );

          if (writeCommitted) {
            log(`Reconciliation determined parent update committed despite error (${parentErr.message}). Continuing cascade with reconciled state.`);
            updatedPrescription = reconciled;
          } else {
            // Write has NOT committed at this moment.
            // Only a deterministic 4xx client rejection where the parent state strictly matches original version can be marked aborted.
            // Any timeout, transport drop, 5xx server error, or unverified state must be held in transition_recovering.
            const isDeterministicClientError = [400, 403, 404, 409].includes(parentErr.code);
            const isStrictlyUnchangedOriginal = Boolean(
              reconciled &&
              reconciledMeta.version === currentVersion &&
              reconciledMeta.active_tx === meta.active_tx
            );

            let transitionStatusError = null;

            if (isDeterministicClientError && isStrictlyUnchangedOriginal) {
              try {
                await abortTransition(txDocId, {
                  reason: 'parent_update_failed_definitive_rejection',
                  error: parentErr.message,
                  original_version: currentVersion,
                });
              } catch (stErr) {
                transitionStatusError = stErr.message;
                error(`Failed to abort transition ${txDocId}: ${stErr.message}`);
              }

              return res.json({
                ok: false,
                error: `Failed to update prescription state: ${parentErr.message}`,
                transitionStatusError: transitionStatusError || undefined,
              }, 500);
            } else {
              // UNCERTAIN OUTCOME: Timeout, transport error, 5xx server error, or unverified state.
              // An outstanding write could still complete on the database server later!
              // The transition MUST remain blocked in transition_recovering to prevent concurrent writes.
              try {
                await setTransitionStatus(txDocId, 'transition_recovering', {
                  uncertain_outcome: true,
                  error: `Parent update threw error and outcome is uncertain: ${parentErr.message}`,
                  observed_version: reconciledMeta.version ?? null,
                  expected_version: nextVersion,
                  original_version: currentVersion,
                });
              } catch (stErr) {
                transitionStatusError = stErr.message;
                error(`Failed to lock transition ${txDocId} in transition_recovering: ${stErr.message}`);
              }

              return res.json({
                ok: false,
                error: `Failed to update prescription state (uncertain write outcome): ${parentErr.message}`,
                uncertain_outcome: true,
                transitionStatusError: transitionStatusError || undefined,
              }, 500);
            }
          }
        }

        const expectedParentState = {
          updatedAt: updatedPrescription.$updatedAt,
          pharmacyId: pharmacy_id,
          version: nextVersion,
          activeTx: txDocId,
        };

        const modifiedItems = [];
        try {
          const totalUpdated = await cascadeChildItemsAcl(
            prescription_id,
            targetPermissions,
            expectedParentState,
            modifiedItems
          );
          await commitTransition(txDocId, { items_updated: totalUpdated });
          log(`Prescription ${prescription_id} routed to pharmacy ${pharmacy_id} (${totalUpdated} items cascaded, version ${nextVersion})`);
          return res.json({ ok: true, prescription: updatedPrescription, itemsUpdated: totalUpdated, version: nextVersion, transitionId: txDocId });
        } catch (cascadeErr) {
          error(`Cascade or commit failed during routing of ${prescription_id}: ${cascadeErr.message}. Executing recovery.`);

          // GUARD 1: Stop recovery if parent prescription cannot be read (coordination state unknown)
          let currentParent = null;
          try {
            currentParent = await db.getDocument(DATABASE_ID, PRESCRIPTIONS_COLLECTION_ID, prescription_id);
          } catch (pGetErr) {
            error(`CRITICAL: Cannot read parent prescription ${prescription_id} during recovery: ${pGetErr.message}. Halting recovery writes.`);
            return res.json({
              ok: false,
              error: `Recovery halted: failed to read parent prescription state (${pGetErr.message}) following error (${cascadeErr.message})`,
              coordinationStateUnknown: true,
              recoveryHalted: true,
            }, 500);
          }

          let currentParentMeta = {};
          if (currentParent) {
            try { currentParentMeta = JSON.parse(currentParent.ai_parsed_json || '{}'); } catch {}
          }

          const isSuperseded = Boolean(
            currentParentMeta.version > nextVersion ||
            (currentParentMeta.version === nextVersion && currentParentMeta.active_tx && currentParentMeta.active_tx !== txDocId)
          );

          if (isSuperseded) {
            error(`Conflict: Prescription ${prescription_id} was superseded by another operation (current version: ${currentParentMeta.version}, active_tx: ${currentParentMeta.active_tx}). Aborting recovery to protect newer state.`);
            return res.json({
              ok: false,
              error: `Conflict: Operation encountered error (${cascadeErr.message}), and recovery was aborted because prescription was superseded by a newer operation (version ${currentParentMeta.version})`,
              fencingConflict: true,
              currentVersion: currentParentMeta.version,
            }, 409);
          }

          // GUARD 2: Stop recovery if transition document cannot be read (coordination state unknown)
          let currentTx = null;
          try {
            currentTx = await db.getDocument(DATABASE_ID, PRESCRIPTIONS_COLLECTION_ID, txDocId);
          } catch (txGetErr) {
            error(`CRITICAL: Cannot read transition document ${txDocId} during recovery: ${txGetErr.message}. Halting recovery writes.`);
            return res.json({
              ok: false,
              error: `Recovery halted: failed to read transition document state (${txGetErr.message}) following error (${cascadeErr.message})`,
              coordinationStateUnknown: true,
              recoveryHalted: true,
            }, 500);
          }

          if (currentTx && currentTx.status === 'transition_committed') {
            log(`Reconciliation determined transition ${txDocId} was committed despite error (${cascadeErr.message}). Returning success without rollback.`);
            return res.json({
              ok: true,
              prescription: updatedPrescription,
              version: nextVersion,
              transitionId: txDocId,
              recovered_from_error: cascadeErr.message,
            });
          }

          // GUARD 3: Atomically lock transition into transition_recovering.
          // IF THIS FAILS, DO NOT PROCEED WITH ROLLBACK OR QUARANTINE WRITES!
          try {
            await setTransitionStatus(txDocId, 'transition_recovering', {
              error: cascadeErr.message,
              recovering_at: Date.now(),
            });
          } catch (stErr) {
            error(`CRITICAL: Failed to enter transition_recovering for ${txDocId}: ${stErr.message}. Halting recovery writes to prevent unfenced writes.`);
            return res.json({
              ok: false,
              error: `Recovery halted: failed to lock transition in transition_recovering (${stErr.message}) following error (${cascadeErr.message})`,
              transitionStatusError: stErr.message,
              recoveryHalted: true,
            }, 500);
          }

          let parentRollbackError = null;
          let parentQuarantineVerificationFailed = false;
          try {
            await db.updateDocument(
              DATABASE_ID,
              PRESCRIPTIONS_COLLECTION_ID,
              prescription_id,
              {
                status: prevStatus,
                pharmacy_id: prevPharmacyId,
                ai_parsed_json: JSON.stringify({
                  ...meta,
                  version: nextVersion,
                  active_tx: txDocId,
                  rolled_back: true,
                }),
              },
              prevPermissions
            );
          } catch (pRbErr) {
            parentRollbackError = `Parent rollback failed: ${pRbErr.message}`;
            error(parentRollbackError);
            try {
              const qParent = await db.updateDocument(
                DATABASE_ID,
                PRESCRIPTIONS_COLLECTION_ID,
                prescription_id,
                {
                  status: 'pending_review',
                  pharmacy_id: null,
                  ai_parsed_json: JSON.stringify({
                    ...meta,
                    version: nextVersion,
                    active_tx: txDocId,
                    quarantined: true,
                  }),
                },
                [
                  Permission.read(Role.user(existing.user_id)),
                  Permission.read(Role.team(MANAGEMENT_TEAM_ID)),
                ]
              );
              if ((qParent.$permissions || []).some((p) => p.includes(`team:${pharmacyTeamId}`))) {
                parentQuarantineVerificationFailed = true;
              }
            } catch (qErr) {
              parentQuarantineVerificationFailed = true;
              error(`Parent quarantine update failed: ${qErr.message}`);
            }
          }

          const { childErrors, quarantineVerificationFailures } = modifiedItems.length > 0
            ? await rollbackChildItems(modifiedItems, pharmacyTeamId)
            : { childErrors: [], quarantineVerificationFailures: [] };

          const hasRollbackFailures = parentRollbackError !== null || childErrors.length > 0;
          const quarantineVerificationFailed = quarantineVerificationFailures.length > 0 || parentQuarantineVerificationFailed;
          const quarantineEnforced = hasRollbackFailures && !quarantineVerificationFailed;
          const quarantineFailed = quarantineVerificationFailed;
          const recoveryUnsuccessful = hasRollbackFailures || quarantineFailed;

          if (recoveryUnsuccessful) {
            // FAILED RECOVERY MUST REMAIN BLOCKING!
            // Do NOT mark transition_aborted! The transition remains in transition_recovering.
            let recordStatusErr = null;
            try {
              await setTransitionStatus(txDocId, 'transition_recovering', {
                recovery_failed: true,
                error: cascadeErr.message,
                parentRollbackError,
                childErrors,
                quarantineEnforced,
                quarantineFailed,
                quarantineVerificationFailures: quarantineVerificationFailures.length > 0 ? quarantineVerificationFailures : undefined,
                updated_at: Date.now(),
              });
            } catch (stErr) {
              recordStatusErr = stErr.message;
              error(`Failed to record recovery failure in ${txDocId}: ${stErr.message}`);
            }

            return res.json(
              {
                ok: false,
                error: `Routing failed and recovery was unsuccessful: ${cascadeErr.message}. Transition remains blocked in transition_recovering.`,
                quarantineEnforced,
                quarantineFailed,
                quarantineVerificationFailures: quarantineVerificationFailures.length > 0 ? quarantineVerificationFailures : undefined,
                transitionStatusError: recordStatusErr || undefined,
                recoveryBlocked: true,
                rollbackErrors: {
                  parent: parentRollbackError,
                  children: childErrors,
                },
              },
              500
            );
          }

          // Case A: All restoration verified completely successful! Safe to mark transition_aborted.
          let transitionStatusError = null;
          try {
            await setTransitionStatus(txDocId, 'transition_aborted', {
              error: cascadeErr.message,
              parentRestored: true,
              childrenRestored: true,
              recovered_at: Date.now(),
            });
          } catch (stErr) {
            transitionStatusError = stErr.message;
            error(`CRITICAL: Failed to set transition ${txDocId} to transition_aborted: ${stErr.message}`);
          }

          if (transitionStatusError) {
            return res.json(
              {
                ok: false,
                error: `Rollback succeeded but failed to update transition status: ${transitionStatusError}`,
                transitionStatusError,
              },
              500
            );
          }

          const isConflict = cascadeErr.message.includes('Conflict:');
          return res.json(
            { ok: false, error: `Failed to update child item permissions: ${cascadeErr.message}` },
            isConflict ? 409 : 500
          );
        }
      } catch (err) {
        error(`Error in route action: ${err.message}`);
        return res.json({ ok: false, error: err.message }, 500);
      } finally {
        activeLocks.delete(prescription_id);
      }
    }

    // -------------------------------------------------------------------------
    // 3. ACTION: REASSIGN PRESCRIPTION (Monotonically Versioned State Transition)
    // -------------------------------------------------------------------------
    if (action === 'reassign' || action === 'prescriptions.reassign') {
      const { prescription_id, new_pharmacy_id } = body;
      if (!prescription_id || !new_pharmacy_id) {
        return res.json({ ok: false, error: 'prescription_id and new_pharmacy_id are required' }, 400);
      }

      if (activeLocks.has(prescription_id)) {
        return res.json({ ok: false, error: 'Conflict: In-process operation already running for this prescription' }, 409);
      }
      activeLocks.add(prescription_id);

      let txDocId = null;

      try {
        // 1. Read existing prescription
        const existing = await db.getDocument(DATABASE_ID, PRESCRIPTIONS_COLLECTION_ID, prescription_id);

        // 2. Authorize caller FIRST before status checks
        const isOwner = existing.user_id === callerId;
        const isManagement = await verifyManagementAuthority(callerId);

        let isAssignedPharmacy = false;
        if (existing.pharmacy_id) {
          try {
            const { teamId: existingTeamId } = await resolveAuthoritativePharmacyTeam(existing.pharmacy_id);
            isAssignedPharmacy = await verifyPharmacyAuthority(existingTeamId, callerId);
          } catch {
            isAssignedPharmacy = false;
          }
        }

        if (!isOwner && !isAssignedPharmacy && !isManagement) {
          return res.json({ ok: false, error: 'Forbidden: Caller not authorized to reassign prescription' }, 403);
        }

        let meta = {};
        try { meta = JSON.parse(existing.ai_parsed_json || '{}'); } catch {}
        const currentVersion = typeof meta.version === 'number' ? meta.version : 1;

        // 3. Fenced Concurrency Check: Active transition still pending or recovering blocks subsequent operations
        if (meta.active_tx) {
          try {
            const activeTxDoc = await db.getDocument(DATABASE_ID, PRESCRIPTIONS_COLLECTION_ID, meta.active_tx);
            if (activeTxDoc && (activeTxDoc.status === 'transition_pending' || activeTxDoc.status === 'transition_recovering')) {
              return res.json({
                ok: false,
                error: `Conflict: A concurrent reassignment operation is already in progress or recovering for this prescription (${meta.active_tx} is ${activeTxDoc.status})`,
              }, 409);
            }
          } catch (txGetErr) {
            if (txGetErr.code !== 404 && !txGetErr.message?.includes('not found')) {
              throw txGetErr;
            }
          }
        }

        // 4. Validate state machine transition
        if (!VALID_TRANSITIONS[existing.status]?.includes('reassigned')) {
          return res.json(
            {
              ok: false,
              error: `Invalid transition: cannot reassign prescription in terminal or non-reassignable status '${existing.status}'`,
            },
            400
          );
        }

        // 5. Resolve destination pharmacy team
        const { teamId: newPharmacyTeamId } = await resolveAuthoritativePharmacyTeam(new_pharmacy_id);

        try {
          const claimRes = await claimVersionedTransition(
            prescription_id,
            currentVersion,
            'reassigned',
            callerId,
            'reassignment',
            { target_pharmacy_id: new_pharmacy_id, pharmacy_team_id: newPharmacyTeamId }
          );
          txDocId = claimRes.txDocId;
        } catch (claimErr) {
          return res.json({ ok: false, error: claimErr.message }, 409);
        }

        const nextVersion = currentVersion + 1;
        const targetPermissions = [
          Permission.read(Role.user(existing.user_id)),
          Permission.read(Role.team(MANAGEMENT_TEAM_ID)),
          Permission.read(Role.team(newPharmacyTeamId)),
        ];

        const prevStatus = existing.status;
        const prevPharmacyId = existing.pharmacy_id;
        const prevPermissions = existing.$permissions || [
          Permission.read(Role.user(existing.user_id)),
          Permission.read(Role.team(MANAGEMENT_TEAM_ID)),
        ];

        // 6. Update parent prescription with fenced version and active transition ID
        let updatedPrescription;
        try {
          updatedPrescription = await db.updateDocument(
            DATABASE_ID,
            PRESCRIPTIONS_COLLECTION_ID,
            prescription_id,
            {
              status: 'reassigned',
              pharmacy_id: new_pharmacy_id,
              ai_parsed_json: JSON.stringify({
                ...meta,
                version: nextVersion,
                active_tx: txDocId,
                last_action: 'reassign',
                updated_at: Date.now(),
              }),
            },
            targetPermissions
          );
        } catch (parentErr) {
          error(`Parent update threw error during reassignment of ${prescription_id}: ${parentErr.message}. Reconciling database state.`);
          // Reconcile uncertain write outcome: read parent from database to verify if write actually committed
          let reconciled = null;
          try {
            reconciled = await db.getDocument(DATABASE_ID, PRESCRIPTIONS_COLLECTION_ID, prescription_id);
          } catch (reconcileErr) {
            error(`Failed to reconcile parent state after error: ${reconcileErr.message}`);
          }

          let reconciledMeta = {};
          if (reconciled) {
            try { reconciledMeta = JSON.parse(reconciled.ai_parsed_json || '{}'); } catch {}
          }

          const writeCommitted = Boolean(
            reconciled &&
            reconciledMeta.version === nextVersion &&
            reconciledMeta.active_tx === txDocId
          );

          if (writeCommitted) {
            log(`Reconciliation determined parent update committed despite error (${parentErr.message}). Continuing cascade with reconciled state.`);
            updatedPrescription = reconciled;
          } else {
            // Write has NOT committed at this moment.
            // Only a deterministic 4xx client rejection where the parent state strictly matches original version can be marked aborted.
            // Any timeout, transport drop, 5xx server error, or unverified state must be held in transition_recovering.
            const isDeterministicClientError = [400, 403, 404, 409].includes(parentErr.code);
            const isStrictlyUnchangedOriginal = Boolean(
              reconciled &&
              reconciledMeta.version === currentVersion &&
              reconciledMeta.active_tx === meta.active_tx
            );

            let transitionStatusError = null;

            if (isDeterministicClientError && isStrictlyUnchangedOriginal) {
              try {
                await abortTransition(txDocId, {
                  reason: 'parent_update_failed_definitive_rejection',
                  error: parentErr.message,
                  original_version: currentVersion,
                });
              } catch (stErr) {
                transitionStatusError = stErr.message;
                error(`Failed to abort transition ${txDocId}: ${stErr.message}`);
              }

              return res.json({
                ok: false,
                error: `Failed to update prescription state: ${parentErr.message}`,
                transitionStatusError: transitionStatusError || undefined,
              }, 500);
            } else {
              // UNCERTAIN OUTCOME: Timeout, transport error, 5xx server error, or unverified state.
              // An outstanding write could still complete on the database server later!
              // The transition MUST remain blocked in transition_recovering to prevent concurrent writes.
              try {
                await setTransitionStatus(txDocId, 'transition_recovering', {
                  uncertain_outcome: true,
                  error: `Parent update threw error and outcome is uncertain: ${parentErr.message}`,
                  observed_version: reconciledMeta.version ?? null,
                  expected_version: nextVersion,
                  original_version: currentVersion,
                });
              } catch (stErr) {
                transitionStatusError = stErr.message;
                error(`Failed to lock transition ${txDocId} in transition_recovering: ${stErr.message}`);
              }

              return res.json({
                ok: false,
                error: `Failed to update prescription state (uncertain write outcome): ${parentErr.message}`,
                uncertain_outcome: true,
                transitionStatusError: transitionStatusError || undefined,
              }, 500);
            }
          }
        }

        const expectedParentState = {
          updatedAt: updatedPrescription.$updatedAt,
          pharmacyId: new_pharmacy_id,
          version: nextVersion,
          activeTx: txDocId,
        };

        const modifiedItems = [];
        try {
          const totalUpdated = await cascadeChildItemsAcl(
            prescription_id,
            targetPermissions,
            expectedParentState,
            modifiedItems
          );
          await commitTransition(txDocId, { items_updated: totalUpdated });
          log(`Prescription ${prescription_id} reassigned to ${new_pharmacy_id}. Old pharmacy revoked across ${totalUpdated} items (version ${nextVersion}).`);
          return res.json({ ok: true, prescription: updatedPrescription, itemsUpdated: totalUpdated, version: nextVersion, transitionId: txDocId });
        } catch (cascadeErr) {
          error(`Cascade or commit failed during reassignment of ${prescription_id}: ${cascadeErr.message}. Executing recovery.`);

          // GUARD 1: Stop recovery if parent prescription cannot be read (coordination state unknown)
          let currentParent = null;
          try {
            currentParent = await db.getDocument(DATABASE_ID, PRESCRIPTIONS_COLLECTION_ID, prescription_id);
          } catch (pGetErr) {
            error(`CRITICAL: Cannot read parent prescription ${prescription_id} during recovery: ${pGetErr.message}. Halting recovery writes.`);
            return res.json({
              ok: false,
              error: `Recovery halted: failed to read parent prescription state (${pGetErr.message}) following error (${cascadeErr.message})`,
              coordinationStateUnknown: true,
              recoveryHalted: true,
            }, 500);
          }

          let currentParentMeta = {};
          if (currentParent) {
            try { currentParentMeta = JSON.parse(currentParent.ai_parsed_json || '{}'); } catch {}
          }

          const isSuperseded = Boolean(
            currentParentMeta.version > nextVersion ||
            (currentParentMeta.version === nextVersion && currentParentMeta.active_tx && currentParentMeta.active_tx !== txDocId)
          );

          if (isSuperseded) {
            error(`Conflict: Prescription ${prescription_id} was superseded by another operation (current version: ${currentParentMeta.version}, active_tx: ${currentParentMeta.active_tx}). Aborting recovery to protect newer state.`);
            return res.json({
              ok: false,
              error: `Conflict: Operation encountered error (${cascadeErr.message}), and recovery was aborted because prescription was superseded by a newer operation (version ${currentParentMeta.version})`,
              fencingConflict: true,
              currentVersion: currentParentMeta.version,
            }, 409);
          }

          // GUARD 2: Stop recovery if transition document cannot be read (coordination state unknown)
          let currentTx = null;
          try {
            currentTx = await db.getDocument(DATABASE_ID, PRESCRIPTIONS_COLLECTION_ID, txDocId);
          } catch (txGetErr) {
            error(`CRITICAL: Cannot read transition document ${txDocId} during recovery: ${txGetErr.message}. Halting recovery writes.`);
            return res.json({
              ok: false,
              error: `Recovery halted: failed to read transition document state (${txGetErr.message}) following error (${cascadeErr.message})`,
              coordinationStateUnknown: true,
              recoveryHalted: true,
            }, 500);
          }

          if (currentTx && currentTx.status === 'transition_committed') {
            log(`Reconciliation determined transition ${txDocId} was committed despite error (${cascadeErr.message}). Returning success without rollback.`);
            return res.json({
              ok: true,
              prescription: updatedPrescription,
              version: nextVersion,
              transitionId: txDocId,
              recovered_from_error: cascadeErr.message,
            });
          }

          // GUARD 3: Atomically lock transition into transition_recovering.
          // IF THIS FAILS, DO NOT PROCEED WITH ROLLBACK OR QUARANTINE WRITES!
          try {
            await setTransitionStatus(txDocId, 'transition_recovering', {
              error: cascadeErr.message,
              recovering_at: Date.now(),
            });
          } catch (stErr) {
            error(`CRITICAL: Failed to enter transition_recovering for ${txDocId}: ${stErr.message}. Halting recovery writes to prevent unfenced writes.`);
            return res.json({
              ok: false,
              error: `Recovery halted: failed to lock transition in transition_recovering (${stErr.message}) following error (${cascadeErr.message})`,
              transitionStatusError: stErr.message,
              recoveryHalted: true,
            }, 500);
          }

          let parentRollbackError = null;
          let parentQuarantineVerificationFailed = false;
          try {
            await db.updateDocument(
              DATABASE_ID,
              PRESCRIPTIONS_COLLECTION_ID,
              prescription_id,
              {
                status: prevStatus,
                pharmacy_id: prevPharmacyId,
                ai_parsed_json: JSON.stringify({
                  ...meta,
                  version: nextVersion,
                  active_tx: txDocId,
                  rolled_back: true,
                }),
              },
              prevPermissions
            );
          } catch (pRbErr) {
            parentRollbackError = `Parent rollback failed: ${pRbErr.message}`;
            error(parentRollbackError);
            try {
              const qParent = await db.updateDocument(
                DATABASE_ID,
                PRESCRIPTIONS_COLLECTION_ID,
                prescription_id,
                {
                  status: 'pending_review',
                  pharmacy_id: null,
                  ai_parsed_json: JSON.stringify({
                    ...meta,
                    version: nextVersion,
                    active_tx: txDocId,
                    quarantined: true,
                  }),
                },
                [
                  Permission.read(Role.user(existing.user_id)),
                  Permission.read(Role.team(MANAGEMENT_TEAM_ID)),
                ]
              );
              if ((qParent.$permissions || []).some((p) => p.includes(`team:${newPharmacyTeamId}`))) {
                parentQuarantineVerificationFailed = true;
              }
            } catch (qErr) {
              parentQuarantineVerificationFailed = true;
              error(`Parent quarantine update failed: ${qErr.message}`);
            }
          }

          const { childErrors, quarantineVerificationFailures } = modifiedItems.length > 0
            ? await rollbackChildItems(modifiedItems, newPharmacyTeamId)
            : { childErrors: [], quarantineVerificationFailures: [] };

          const hasRollbackFailures = parentRollbackError !== null || childErrors.length > 0;
          const quarantineVerificationFailed = quarantineVerificationFailures.length > 0 || parentQuarantineVerificationFailed;
          const quarantineEnforced = hasRollbackFailures && !quarantineVerificationFailed;
          const quarantineFailed = quarantineVerificationFailed;
          const recoveryUnsuccessful = hasRollbackFailures || quarantineFailed;

          if (recoveryUnsuccessful) {
            // FAILED RECOVERY MUST REMAIN BLOCKING!
            // Do NOT mark transition_aborted! The transition remains in transition_recovering.
            let recordStatusErr = null;
            try {
              await setTransitionStatus(txDocId, 'transition_recovering', {
                recovery_failed: true,
                error: cascadeErr.message,
                parentRollbackError,
                childErrors,
                quarantineEnforced,
                quarantineFailed,
                quarantineVerificationFailures: quarantineVerificationFailures.length > 0 ? quarantineVerificationFailures : undefined,
                updated_at: Date.now(),
              });
            } catch (stErr) {
              recordStatusErr = stErr.message;
              error(`Failed to record recovery failure in ${txDocId}: ${stErr.message}`);
            }

            return res.json(
              {
                ok: false,
                error: `Reassignment failed and recovery was unsuccessful: ${cascadeErr.message}. Transition remains blocked in transition_recovering.`,
                quarantineEnforced,
                quarantineFailed,
                quarantineVerificationFailures: quarantineVerificationFailures.length > 0 ? quarantineVerificationFailures : undefined,
                transitionStatusError: recordStatusErr || undefined,
                recoveryBlocked: true,
                rollbackErrors: {
                  parent: parentRollbackError,
                  children: childErrors,
                },
              },
              500
            );
          }

          // Case A: All restoration verified completely successful! Safe to mark transition_aborted.
          let transitionStatusError = null;
          try {
            await setTransitionStatus(txDocId, 'transition_aborted', {
              error: cascadeErr.message,
              parentRestored: true,
              childrenRestored: true,
              recovered_at: Date.now(),
            });
          } catch (stErr) {
            transitionStatusError = stErr.message;
            error(`CRITICAL: Failed to set transition ${txDocId} to transition_aborted: ${stErr.message}`);
          }

          if (transitionStatusError) {
            return res.json(
              {
                ok: false,
                error: `Rollback succeeded but failed to update transition status: ${transitionStatusError}`,
                transitionStatusError,
              },
              500
            );
          }

          const isConflict = cascadeErr.message.includes('Conflict:');
          return res.json(
            { ok: false, error: `Failed to update child item permissions: ${cascadeErr.message}` },
            isConflict ? 409 : 500
          );
        }
      } catch (err) {
        error(`Error in reassign action: ${err.message}`);
        return res.json({ ok: false, error: err.message }, 500);
      } finally {
        activeLocks.delete(prescription_id);
      }
    }

    return res.json({ ok: false, error: `Unsupported action: '${action}'` }, 404);
  };
}

export default createPrescriptionHandler();
