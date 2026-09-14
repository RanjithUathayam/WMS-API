const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');

// SQL Server error numbers for a unique-index violation.
const SQL_UNIQUE_VIOLATION_NUMBERS = [2601, 2627];

function isUniqueViolation(error) {
    const original = error && error.original;
    return !!original && SQL_UNIQUE_VIOLATION_NUMBERS.includes(original.number);
}

/** Most recent mapping (any status) for a PalletID, locked for mutation — used to enforce the single-use-for-life rule and to serialize concurrent validate calls for the same PalletID. */
async function lockLatestMappingByPalletId(transaction, palletId) {
    const rows = await sequelize.query(`
        SELECT TOP 1 PalletMappingID, PalletID, TotalBoxCount, Status, PickingStatus, CreatedBy, CreatedAt, CompletedBy, CompletedAt
        FROM T_PALLET_MAPPING WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
        WHERE PalletID = :palletId
        ORDER BY PalletMappingID DESC
    `, {
        replacements: { palletId },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

/** Open mapping for a PalletID, locked for mutation (box add / complete). */
async function lockOpenMappingByPalletId(transaction, palletId) {
    const rows = await sequelize.query(`
        SELECT TOP 1 PalletMappingID, PalletID, TotalBoxCount, Status, CreatedBy, CreatedAt, CompletedBy, CompletedAt
        FROM T_PALLET_MAPPING WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
        WHERE PalletID = :palletId AND Status = 'OPEN'
    `, {
        replacements: { palletId },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

/** Latest mapping for a PalletID, unlocked read — used for the GET status endpoint. */
async function findMappingByPalletId(palletId) {
    const rows = await sequelize.query(`
        SELECT TOP 1 PalletMappingID, PalletID, TotalBoxCount, Status, PickingStatus, CreatedBy, CreatedAt, CompletedBy, CompletedAt
        FROM T_PALLET_MAPPING WITH (NOLOCK)
        WHERE PalletID = :palletId
        ORDER BY PalletMappingID DESC
    `, {
        replacements: { palletId },
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

async function createOpenMapping(transaction, { palletId, createdBy }) {
    try {
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
    } catch (error) {
        if (isUniqueViolation(error)) {
            const duplicateError = new Error(`An open pallet mapping for ${palletId} was just created by another request.`);
            duplicateError.code = 'PALLET_ALREADY_OPEN';
            throw duplicateError;
        }
        throw error;
    }
}

/** Box master lookup (T_PREBIN_BOX), locked — a box only becomes eligible once its Pre-Binning workflow is COMPLETED. */
async function lockPrebinBoxByNumber(transaction, boxNumber) {
    const rows = await sequelize.query(`
        SELECT TOP 1 PreBinBoxID, BoxNumber, WarehouseCode, ItemGroup, TotalQty, Status
        FROM T_PREBIN_BOX WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
        WHERE BoxNumber = :boxNumber
    `, {
        replacements: { boxNumber },
        transaction,
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

async function findMappingBoxByBoxNumber(boxNumber) {
    const rows = await sequelize.query(`
        SELECT TOP 1 PalletMappingBoxID, PalletMappingID, PalletID, BoxNumber
        FROM T_PALLET_MAPPING_BOX WITH (NOLOCK)
        WHERE BoxNumber = :boxNumber
    `, {
        replacements: { boxNumber },
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

async function insertMappingBox(transaction, { palletMappingId, palletId, boxNumber, warehouseCode, itemGroup, boxTotalQty, mappedBy }) {
    try {
        const rows = await sequelize.query(`
            INSERT INTO T_PALLET_MAPPING_BOX
                (PalletMappingID, PalletID, BoxNumber, WarehouseCode, ItemGroup, BoxTotalQty, MappedBy, MappedAt)
            OUTPUT INSERTED.PalletMappingBoxID, INSERTED.PalletMappingID, INSERTED.PalletID, INSERTED.BoxNumber,
                   INSERTED.WarehouseCode, INSERTED.ItemGroup, INSERTED.BoxTotalQty, INSERTED.MappedBy, INSERTED.MappedAt
            VALUES (:palletMappingId, :palletId, :boxNumber, :warehouseCode, :itemGroup, :boxTotalQty, :mappedBy, GETDATE())
        `, {
            replacements: { palletMappingId, palletId, boxNumber, warehouseCode, itemGroup, boxTotalQty, mappedBy },
            transaction,
            type: QueryTypes.SELECT
        });
        return rows[0];
    } catch (error) {
        if (isUniqueViolation(error)) {
            const duplicateError = new Error(`Box ${boxNumber} is already mapped to a pallet.`);
            duplicateError.code = 'BOX_ALREADY_MAPPED';
            throw duplicateError;
        }
        throw error;
    }
}

async function incrementBoxCount(transaction, palletMappingId) {
    await sequelize.query(`
        UPDATE T_PALLET_MAPPING SET TotalBoxCount = TotalBoxCount + 1 WHERE PalletMappingID = :palletMappingId
    `, {
        replacements: { palletMappingId },
        transaction,
        type: QueryTypes.UPDATE
    });
}

async function completeMapping(transaction, palletMappingId, completedBy) {
    await sequelize.query(`
        UPDATE T_PALLET_MAPPING
        SET Status = 'COMPLETED', CompletedBy = :completedBy, CompletedAt = GETDATE()
        WHERE PalletMappingID = :palletMappingId
    `, {
        replacements: { palletMappingId, completedBy },
        transaction,
        type: QueryTypes.UPDATE
    });
}

async function getBoxesByMappingId(palletMappingId) {
    return sequelize.query(`
        SELECT PalletMappingBoxID, PalletMappingID, PalletID, BoxNumber, WarehouseCode, ItemGroup, BoxTotalQty, MappedBy, MappedAt
        FROM T_PALLET_MAPPING_BOX WITH (NOLOCK)
        WHERE PalletMappingID = :palletMappingId
        ORDER BY PalletMappingBoxID
    `, {
        replacements: { palletMappingId },
        type: QueryTypes.SELECT
    });
}

module.exports = {
    lockLatestMappingByPalletId,
    lockOpenMappingByPalletId,
    findMappingByPalletId,
    createOpenMapping,
    lockPrebinBoxByNumber,
    findMappingBoxByBoxNumber,
    insertMappingBox,
    incrementBoxCount,
    completeMapping,
    getBoxesByMappingId
};
