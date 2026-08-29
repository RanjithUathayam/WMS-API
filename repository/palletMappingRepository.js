const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');

// SQL Server error numbers for a unique-index violation.
const SQL_UNIQUE_VIOLATION_NUMBERS = [2601, 2627];

function isUniqueViolation(error) {
    const original = error && error.original;
    return !!original && SQL_UNIQUE_VIOLATION_NUMBERS.includes(original.number);
}

/**
 * Lightweight, non-locking lookup for the /pallet/:palletId/validate advisory endpoint. A PalletID
 * is single-use: once completed it can never be reopened, so the most recent row (open or
 * completed) always reflects the ID's current, permanent state.
 */
async function findLatestPalletByPalletId(palletId) {
    const rows = await sequelize.query(`
        SELECT TOP 1 PalletMappingID, PalletID, TotalBoxCount, Status, CreatedBy, CreatedAt, CompletedBy, CompletedAt
        FROM T_PALLET_MAPPING WITH (NOLOCK)
        WHERE PalletID = :palletId
        ORDER BY CASE WHEN Status = 'OPEN' THEN 0 ELSE 1 END, CreatedAt DESC
    `, {
        replacements: { palletId },
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

/** Locks the most recent mapping row for this PalletID, for mutation inside a transaction. */
async function lockLatestPalletByPalletId(transaction, palletId) {
    const rows = await sequelize.query(`
        SELECT TOP 1 PalletMappingID, PalletID, TotalBoxCount, Status, CreatedBy, CreatedAt, CompletedBy, CompletedAt
        FROM T_PALLET_MAPPING WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
        WHERE PalletID = :palletId
        ORDER BY CASE WHEN Status = 'OPEN' THEN 0 ELSE 1 END, CreatedAt DESC
    `, {
        replacements: { palletId },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

async function createPalletMapping(transaction, { palletId, createdBy }) {
    const rows = await sequelize.query(`
        INSERT INTO T_PALLET_MAPPING (PalletID, TotalBoxCount, Status, CreatedBy, CreatedAt)
        OUTPUT INSERTED.PalletMappingID, INSERTED.PalletID, INSERTED.TotalBoxCount, INSERTED.Status,
               INSERTED.CreatedBy, INSERTED.CreatedAt, INSERTED.CompletedBy, INSERTED.CompletedAt
        VALUES (:palletId, 0, 'OPEN', :createdBy, GETDATE())
    `, {
        replacements: { palletId, createdBy },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0];
}

async function incrementPalletBoxCount(transaction, palletMappingID) {
    await sequelize.query(`
        UPDATE T_PALLET_MAPPING SET TotalBoxCount = TotalBoxCount + 1 WHERE PalletMappingID = :palletMappingID
    `, {
        replacements: { palletMappingID },
        transaction,
        type: QueryTypes.UPDATE
    });
}

async function getBoxCountForPallet(transaction, palletMappingID) {
    const rows = await sequelize.query(`
        SELECT COUNT(1) AS cnt FROM T_PALLET_MAPPING_BOX WITH (UPDLOCK, HOLDLOCK) WHERE PalletMappingID = :palletMappingID
    `, {
        replacements: { palletMappingID },
        transaction,
        type: QueryTypes.SELECT
    });
    return Number(rows[0].cnt);
}

async function completePalletMapping(transaction, palletMappingID, completedBy) {
    await sequelize.query(`
        UPDATE T_PALLET_MAPPING
        SET Status = 'COMPLETED', CompletedBy = :completedBy, CompletedAt = GETDATE()
        WHERE PalletMappingID = :palletMappingID
    `, {
        replacements: { completedBy, palletMappingID },
        transaction,
        type: QueryTypes.UPDATE
    });
}

/**
 * Non-locking lookup against the existing Pre-Binning box master (T_PREBIN_BOX) — the single
 * source of truth for box identity. No second box table is introduced for Pallet Mapping.
 */
async function findPrebinBoxByNumber(boxNumber) {
    const rows = await sequelize.query(`
        SELECT TOP 1 PreBinBoxID, BoxNumber, WarehouseCode, ItemGroup, CAST(TotalQty AS DECIMAL(18,3)) AS TotalQty, Status
        FROM T_PREBIN_BOX WITH (NOLOCK)
        WHERE BoxNumber = :boxNumber
        ORDER BY CreatedAt DESC
    `, {
        replacements: { boxNumber },
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

/** Locks the box row in T_PREBIN_BOX while it is being mapped, to guard against concurrent mutation. */
async function lockPrebinBoxByNumber(transaction, boxNumber) {
    const rows = await sequelize.query(`
        SELECT TOP 1 PreBinBoxID, BoxNumber, WarehouseCode, ItemGroup, CAST(TotalQty AS DECIMAL(18,3)) AS TotalQty, Status
        FROM T_PREBIN_BOX WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
        WHERE BoxNumber = :boxNumber
        ORDER BY CreatedAt DESC
    `, {
        replacements: { boxNumber },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

async function findMappingByBoxNumber(boxNumber) {
    const rows = await sequelize.query(`
        SELECT TOP 1 PalletMappingID, PalletID, BoxNumber, MappedBy, MappedAt
        FROM T_PALLET_MAPPING_BOX WITH (NOLOCK)
        WHERE BoxNumber = :boxNumber
    `, {
        replacements: { boxNumber },
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

/** Locked read used inside the mapping transaction — same box row two racing requests would insert. */
async function lockMappingByBoxNumber(transaction, boxNumber) {
    const rows = await sequelize.query(`
        SELECT TOP 1 PalletMappingID, PalletID, BoxNumber, MappedBy, MappedAt
        FROM T_PALLET_MAPPING_BOX WITH (UPDLOCK, HOLDLOCK)
        WHERE BoxNumber = :boxNumber
    `, {
        replacements: { boxNumber },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

async function insertMappedBox(transaction, { palletMappingID, palletId, boxNumber, warehouseCode, itemGroup, boxTotalQty, mappedBy }) {
    try {
        await sequelize.query(`
            INSERT INTO T_PALLET_MAPPING_BOX (PalletMappingID, PalletID, BoxNumber, WarehouseCode, ItemGroup, BoxTotalQty, MappedBy, MappedAt)
            VALUES (:palletMappingID, :palletId, :boxNumber, :warehouseCode, :itemGroup, :boxTotalQty, :mappedBy, GETDATE())
        `, {
            replacements: { palletMappingID, palletId, boxNumber, warehouseCode, itemGroup, boxTotalQty, mappedBy },
            transaction,
            type: QueryTypes.INSERT
        });
    } catch (error) {
        if (isUniqueViolation(error)) {
            const duplicateError = new Error(`Box ${boxNumber} is already mapped to a pallet.`);
            duplicateError.code = 'BOX_ALREADY_MAPPED';
            throw duplicateError;
        }
        throw error;
    }
}

async function getMappedBoxesForPallet(palletMappingID) {
    return sequelize.query(`
        SELECT BoxNumber, WarehouseCode, ItemGroup, CAST(BoxTotalQty AS DECIMAL(18,3)) AS BoxTotalQty, MappedBy, MappedAt
        FROM T_PALLET_MAPPING_BOX WITH (NOLOCK)
        WHERE PalletMappingID = :palletMappingID
        ORDER BY MappedAt
    `, {
        replacements: { palletMappingID },
        type: QueryTypes.SELECT
    });
}

async function getPalletWithBoxes(palletId) {
    const pallet = await findLatestPalletByPalletId(palletId);
    if (!pallet) return null;

    const boxes = await getMappedBoxesForPallet(pallet.PalletMappingID);
    return { pallet, boxes };
}

module.exports = {
    findLatestPalletByPalletId,
    lockLatestPalletByPalletId,
    createPalletMapping,
    incrementPalletBoxCount,
    getBoxCountForPallet,
    completePalletMapping,
    findPrebinBoxByNumber,
    lockPrebinBoxByNumber,
    findMappingByBoxNumber,
    lockMappingByBoxNumber,
    insertMappedBox,
    getMappedBoxesForPallet,
    getPalletWithBoxes
};
