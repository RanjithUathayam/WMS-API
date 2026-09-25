const https = require('https');
const axios = require('axios');
const { sequelize } = require('../config/database');
const pickingRepository = require('../repository/pickingRepository');
const { PickingError, sumQty } = require('./pickingCommon');

/**
 * SAP Business One Service Layer — Stock Transfer posting for completed Pick Lists.
 *
 * Configuration comes ONLY from environment variables; nothing is hard-coded and the session cookie
 * never leaves this process (it is not returned by any API and never logged):
 *   SAP_B1_URL                     e.g. https://api.uathayam.in:50000/b1s/v1
 *   SAP_B1_COMPANY_DB
 *   SAP_B1_USERNAME
 *   SAP_B1_PASSWORD
 *   SAP_B1_TLS_REJECT_UNAUTHORIZED 'false' only if the Service Layer uses a self-signed certificate (default 'true')
 *   SAP_B1_TIMEOUT_MS              HTTP timeout per call (default 60000)
 *   SAP_B1_LINK_BASE_DOCUMENT      'true' (default) posts one line per source STR line with
 *                                  BaseType/BaseEntry/BaseLine so SAP closes the request lines;
 *                                  'false' combines quantities per item into one line.
 *   SAP_B1_BASE_TYPE               BaseType value for STR-linked lines (default 'InventoryTransferRequest')
 *
 * Duplicate prevention: every transfer is posted with Reference2 = PickListNumber, and SAP is searched
 * for that reference before each POST — so a retry after a timeout / lost response / failed DB update
 * adopts the transfer that already exists instead of creating a second one.
 */

class SapServiceError extends PickingError {
    constructor(code, message, sapDetail = null) {
        super(code, message);
        this.sapDetail = sapDetail;
    }
}

function readConfig() {
    const url = (process.env.SAP_B1_URL || '').trim().replace(/\/+$/, '');
    const companyDb = (process.env.SAP_B1_COMPANY_DB || '').trim();
    const username = (process.env.SAP_B1_USERNAME || '').trim();
    const password = process.env.SAP_B1_PASSWORD || '';
    const missing = [
        !url && 'SAP_B1_URL', !companyDb && 'SAP_B1_COMPANY_DB',
        !username && 'SAP_B1_USERNAME', !password && 'SAP_B1_PASSWORD'
    ].filter(Boolean);
    if (missing.length > 0) {
        throw new SapServiceError('SAP_NOT_CONFIGURED', `SAP Service Layer is not configured (missing: ${missing.join(', ')}).`);
    }
    return {
        url,
        companyDb,
        username,
        password,
        rejectUnauthorized: String(process.env.SAP_B1_TLS_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false',
        timeoutMs: Number(process.env.SAP_B1_TIMEOUT_MS) > 0 ? Number(process.env.SAP_B1_TIMEOUT_MS) : 60000,
        linkBaseDocument: String(process.env.SAP_B1_LINK_BASE_DOCUMENT || 'true').toLowerCase() !== 'false',
        baseType: (process.env.SAP_B1_BASE_TYPE || 'InventoryTransferRequest').trim()
    };
}

/* ------------------------------------------------------------------------------------------------
 * Session handling (in-memory, server-side only)
 * ---------------------------------------------------------------------------------------------- */

let session = null;        // { cookie, expiresAt }
let loginInFlight = null;  // de-duplicates concurrent logins

function httpClient(config) {
    return axios.create({
        baseURL: config.url,
        timeout: config.timeoutMs,
        httpsAgent: new https.Agent({ rejectUnauthorized: config.rejectUnauthorized, keepAlive: true }),
        headers: { 'Content-Type': 'application/json' },
        validateStatus: () => true
    });
}

/** Normalizes Service Layer error bodies (v1: error.message.value, v2: error.message) into one string. */
function sapErrorMessage(response) {
    const body = response && response.data;
    const err = body && body.error;
    if (err) {
        const msg = err.message && typeof err.message === 'object' ? err.message.value : err.message;
        return `${err.code !== undefined ? `[${err.code}] ` : ''}${msg || 'Unknown SAP error'}`;
    }
    return `HTTP ${response ? response.status : '?'}`;
}

function toNetworkError(error, action) {
    const reason = error.code === 'ECONNABORTED' ? 'timed out' : (error.message || 'network error');
    return new SapServiceError('SAP_UNREACHABLE', `SAP Service Layer ${action} failed: ${reason}.`);
}

async function login(config) {
    let response;
    try {
        response = await httpClient(config).post('/Login', {
            CompanyDB: config.companyDb,
            UserName: config.username,
            Password: config.password
        });
    } catch (error) {
        throw toNetworkError(error, 'login');
    }
    if (response.status !== 200) {
        throw new SapServiceError('SAP_LOGIN_FAILED', `SAP login failed: ${sapErrorMessage(response)}`);
    }
    const setCookie = response.headers['set-cookie'] || [];
    const cookie = setCookie.map(c => c.split(';')[0]).filter(c => /^(B1SESSION|ROUTEID)=/i.test(c)).join('; ')
        || (response.data && response.data.SessionId ? `B1SESSION=${response.data.SessionId}` : '');
    if (!cookie) {
        throw new SapServiceError('SAP_LOGIN_FAILED', 'SAP login returned no session.');
    }
    const timeoutMinutes = Number(response.data && response.data.SessionTimeout) || 30;
    // Renew one minute early so a request never races the server-side expiry.
    session = { cookie, expiresAt: Date.now() + Math.max(timeoutMinutes - 1, 1) * 60 * 1000 };
    return session;
}

async function getSession(config, forceRefresh = false) {
    if (!forceRefresh && session && session.expiresAt > Date.now()) return session;
    if (!loginInFlight) {
        loginInFlight = login(config).finally(() => { loginInFlight = null; });
    }
    return loginInFlight;
}

/** Authenticated Service Layer call; re-logs in once on 401 (expired/evicted session). */
async function sapRequest(config, method, path, data) {
    for (let attempt = 0; attempt < 2; attempt++) {
        const { cookie } = await getSession(config, attempt > 0);
        let response;
        try {
            response = await httpClient(config).request({ method, url: path, data, headers: { Cookie: cookie } });
        } catch (error) {
            throw toNetworkError(error, `${method.toUpperCase()} ${path.split('?')[0]}`);
        }
        if (response.status === 401 && attempt === 0) {
            session = null;
            continue;
        }
        return response;
    }
    throw new SapServiceError('SAP_LOGIN_FAILED', 'SAP session could not be re-established.');
}

/* ------------------------------------------------------------------------------------------------
 * Payload
 * ---------------------------------------------------------------------------------------------- */

const COMMENTS_MAX = 254;   // OWTR.Comments
const MEMO_MAX = 50;        // OWTR.JrnlMemo

function truncate(value, max) {
    const s = String(value || '');
    return s.length > max ? s.slice(0, max) : s;
}

/**
 * Builds the StockTransfers payload purely from the completed Pick List (header + details).
 * With base-document linking each source STR line becomes its own transfer line (traceable and closed
 * in SAP); without it, compatible lines (same item + warehouses) are combined.
 */
function buildStockTransferPayload(header, details, { linkBaseDocument, baseType }) {
    if (!header.CompletedDateText) {
        throw new SapServiceError('SAP_PAYLOAD_INVALID', `Pick List ${header.PickListNumber} has no completion date.`);
    }
    const picked = details.filter(d => Number(d.PickedQty) > 0);
    if (picked.length === 0) {
        throw new SapServiceError('SAP_PAYLOAD_INVALID', `Pick List ${header.PickListNumber} has no picked quantity to transfer.`);
    }

    let lines;
    if (linkBaseDocument) {
        lines = picked.map(d => ({
            ItemCode: d.ItemCode,
            Quantity: Number(d.PickedQty),
            FromWarehouseCode: d.FromWarehouse,
            WarehouseCode: d.ToWarehouse,
            BaseType: baseType,
            BaseEntry: d.SourceDocEntry,
            BaseLine: d.SourceLineNum
        }));
    } else {
        const grouped = new Map();
        for (const d of picked) {
            const key = `${d.ItemCode}|${d.FromWarehouse}|${d.ToWarehouse}`;
            if (!grouped.has(key)) {
                grouped.set(key, { ItemCode: d.ItemCode, Quantity: 0, FromWarehouseCode: d.FromWarehouse, WarehouseCode: d.ToWarehouse });
            }
            const line = grouped.get(key);
            line.Quantity = sumQty([line.Quantity, d.PickedQty]);
        }
        lines = [...grouped.values()];
    }

    const docNums = [...new Set(details.map(d => d.SourceDocNum))].join(',');
    return {
        DocDate: header.CompletedDateText,
        TaxDate: header.CompletedDateText,
        Reference2: header.PickListNumber,
        Comments: truncate(`Inventory Transfer through Pick List ${header.PickListNumber}`
            + `${header.DCNumber ? ` / DC ${header.DCNumber}` : ''} / STR ${docNums}`, COMMENTS_MAX),
        JournalMemo: truncate(`Stock Transfer ${header.PickListNumber}`, MEMO_MAX),
        FromWarehouse: header.FromWarehouse,
        ToWarehouse: header.ToWarehouse,
        StockTransferLines: lines
    };
}

/* ------------------------------------------------------------------------------------------------
 * Posting
 * ---------------------------------------------------------------------------------------------- */

/** Looks up a transfer already posted for this Pick List (Reference2 = PickListNumber). */
async function findExistingStockTransfer(config, pickListNumber) {
    const ref = String(pickListNumber).replace(/'/g, "''");
    const path = `/StockTransfers?$select=DocEntry,DocNum,Reference2&$filter=${encodeURIComponent(`Reference2 eq '${ref}'`)}&$orderby=DocEntry`;
    const response = await sapRequest(config, 'get', path);
    if (response.status !== 200) {
        throw new SapServiceError('SAP_LOOKUP_FAILED', `SAP Stock Transfer lookup failed: ${sapErrorMessage(response)}`);
    }
    const rows = (response.data && response.data.value) || [];
    return rows[0] || null;
}

async function persistStockTransfer(pickListId, { docEntry, docNum, baseLinked, user }) {
    await sequelize.transaction(async (transaction) => {
        await pickingRepository.markStockTransferPosted(transaction, pickListId, {
            docEntry, docNum, baseLinked, updatedBy: user
        });
    });
}

/**
 * Creates (or adopts) the SAP Stock Transfer for a Pick List whose DC already exists.
 * Safe to call repeatedly: returns the stored reference if one exists, and never POSTs when SAP
 * already holds a transfer for this Pick List.
 */
async function postStockTransferForPickList(pickListId, { user, processingToken } = {}) {
    const header = await pickingRepository.findPickListById(pickListId);
    if (!header) {
        throw new PickingError('PICKLIST_NOT_FOUND', `Pick List ${pickListId} was not found.`);
    }
    if (header.StockTransferDocEntry) {
        return { docEntry: header.StockTransferDocEntry, docNum: header.StockTransferDocNum, created: false };
    }
    if (!header.DCID || !['DC_CREATED', 'COMPLETED'].includes(header.Status)) {
        throw new PickingError('STOCK_TRANSFER_NOT_ALLOWED', `Pick List ${header.PickListNumber} must have a DC before the SAP Stock Transfer is posted.`);
    }
    if (processingToken && String(header.ProcessingToken || '').toLowerCase() !== String(processingToken).toLowerCase()) {
        throw new PickingError('PICKLIST_PROCESSING', `Pick List ${header.PickListNumber} is being processed by another request.`);
    }

    const config = readConfig();
    const details = await pickingRepository.getPickListDetails(pickListId);
    const payload = buildStockTransferPayload(header, details, config);

    const existing = await findExistingStockTransfer(config, header.PickListNumber);
    if (existing) {
        await persistStockTransfer(pickListId, {
            docEntry: existing.DocEntry, docNum: existing.DocNum, baseLinked: config.linkBaseDocument, user
        });
        await pickingRepository.insertProcessLog({
            pickListId, stage: 'SAP', result: 'SKIPPED',
            message: `Adopted existing SAP Stock Transfer DocEntry ${existing.DocEntry} / DocNum ${existing.DocNum} (Reference2 ${header.PickListNumber}).`,
            responseBody: { DocEntry: existing.DocEntry, DocNum: existing.DocNum }, createdBy: user
        });
        return { docEntry: existing.DocEntry, docNum: existing.DocNum, created: false, payload };
    }

    const response = await sapRequest(config, 'post', '/StockTransfers', payload);
    if (response.status !== 201 && response.status !== 200) {
        const message = `SAP rejected the Stock Transfer: ${sapErrorMessage(response)}`;
        await pickingRepository.insertProcessLog({
            pickListId, stage: 'SAP', result: 'FAILED', message,
            requestBody: payload, responseBody: response.data && response.data.error ? { error: response.data.error } : null,
            createdBy: user
        });
        throw new SapServiceError('SAP_STOCK_TRANSFER_FAILED', message, response.data && response.data.error);
    }

    const docEntry = response.data.DocEntry;
    const docNum = response.data.DocNum;
    // If this update fails, the Reference2 lookup above adopts the transfer on the next retry.
    await persistStockTransfer(pickListId, { docEntry, docNum, baseLinked: config.linkBaseDocument, user });
    await pickingRepository.insertProcessLog({
        pickListId, stage: 'SAP', result: 'SUCCESS',
        message: `SAP Stock Transfer created: DocEntry ${docEntry} / DocNum ${docNum}.`,
        requestBody: payload, responseBody: { DocEntry: docEntry, DocNum: docNum }, createdBy: user
    });
    return { docEntry, docNum, created: true, payload };
}

/** Test hook: drop the cached session. */
function resetSession() {
    session = null;
    loginInFlight = null;
}

module.exports = {
    SapServiceError,
    readConfig,
    buildStockTransferPayload,
    findExistingStockTransfer,
    postStockTransferForPickList,
    resetSession
};
