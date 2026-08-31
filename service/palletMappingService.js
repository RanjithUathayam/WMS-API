const { sequelize } = require('../config/database');
const repository = require('../repository/palletMappingRepository');

class PalletMappingError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

function isBlank(value) {
    return value === undefined || value === null || String(value).trim() === '';
}

function toBoxDto(box) {
    return {
        palletMappingBoxId: box.PalletMappingBoxID,
        palletMappingId: box.PalletMappingID,
        palletId: box.PalletID,
        boxNumber: box.BoxNumber,
        warehouseCode: box.WarehouseCode || null,
        itemGroup: box.ItemGroup || null,
        boxTotalQty: box.BoxTotalQty !== undefined && box.BoxTotalQty !== null ? Number(box.BoxTotalQty) : null,
        mappedBy: box.MappedBy,
        mappedAt: box.MappedAt
    };
}

function toMappingDto(mapping, boxes) {
    return {
        palletMappingId: mapping.PalletMappingID,
        palletId: mapping.PalletID,
        totalBoxCount: mapping.TotalBoxCount,
        status: mapping.Status,
        createdBy: mapping.CreatedBy,
        createdAt: mapping.CreatedAt,
        completedBy: mapping.CompletedBy || null,
        completedAt: mapping.CompletedAt || null,
        boxes: (boxes || []).map(toBoxDto)
    };
}

/** Validates/scans a PalletID: resumes its existing OPEN mapping, or opens a new one. Rejects PalletIDs that have already been COMPLETED — a PalletID is single-use for its whole lifetime. */
async function validatePalletAsync(rawRequest, user) {
    const palletId = rawRequest && String(rawRequest.palletId || '').trim();
    if (isBlank(palletId)) {
        throw new PalletMappingError('MISSING_FIELDS', 'palletId is required.');
    }
    const createdBy = user && user.UserName;

    const mapping = await sequelize.transaction(async (transaction) => {
        const latest = await repository.lockLatestMappingByPalletId(transaction, palletId);
        if (latest && latest.Status === 'COMPLETED') {
            throw new PalletMappingError('PALLET_ALREADY_COMPLETED', `Pallet ${palletId} has already been completed and cannot be reused.`);
        }
        if (latest && latest.Status === 'OPEN') {
            return latest;
        }
        try {
            return await repository.createOpenMapping(transaction, { palletId, createdBy });
        } catch (error) {
            if (error.code === 'PALLET_ALREADY_OPEN') {
                const existing = await repository.lockLatestMappingByPalletId(transaction, palletId);
                if (existing) return existing;
            }
            throw error;
        }
    });

    const boxes = await repository.getBoxesByMappingId(mapping.PalletMappingID);
    return toMappingDto(mapping, boxes);
}

/** Maps one eligible box (Pre-Binning COMPLETED, not already mapped) onto the pallet's OPEN mapping. */
async function addBoxAsync(rawRequest, user) {
    const palletId = rawRequest && String(rawRequest.palletId || '').trim();
    const boxNumber = rawRequest && String(rawRequest.boxNumber || '').trim();
    if (isBlank(palletId) || isBlank(boxNumber)) {
        throw new PalletMappingError('MISSING_FIELDS', 'palletId and boxNumber are required.');
    }
    const mappedBy = user && user.UserName;

    const mapping = await sequelize.transaction(async (transaction) => {
        const openMapping = await repository.lockOpenMappingByPalletId(transaction, palletId);
        if (!openMapping) {
            throw new PalletMappingError('PALLET_NOT_OPEN', `No open pallet mapping found for ${palletId}. Validate the pallet first.`);
        }

        const prebinBox = await repository.lockPrebinBoxByNumber(transaction, boxNumber);
        if (!prebinBox) {
            throw new PalletMappingError('BOX_NOT_FOUND', `Box ${boxNumber} was not found.`);
        }
        if (prebinBox.Status !== 'COMPLETED') {
            throw new PalletMappingError('BOX_NOT_ELIGIBLE', `Box ${boxNumber} has not completed Pre-Binning yet.`);
        }

        const existingBoxMapping = await repository.findMappingBoxByBoxNumber(boxNumber);
        if (existingBoxMapping) {
            throw new PalletMappingError('BOX_ALREADY_MAPPED', `Box ${boxNumber} is already mapped to pallet ${existingBoxMapping.PalletID}.`);
        }

        try {
            await repository.insertMappingBox(transaction, {
                palletMappingId: openMapping.PalletMappingID,
                palletId,
                boxNumber,
                warehouseCode: prebinBox.WarehouseCode,
                itemGroup: prebinBox.ItemGroup,
                boxTotalQty: prebinBox.TotalQty,
                mappedBy
            });
        } catch (error) {
            if (error.code === 'BOX_ALREADY_MAPPED') {
                throw new PalletMappingError('BOX_ALREADY_MAPPED', error.message);
            }
            throw error;
        }

        await repository.incrementBoxCount(transaction, openMapping.PalletMappingID);
        return { ...openMapping, TotalBoxCount: openMapping.TotalBoxCount + 1 };
    });

    const boxes = await repository.getBoxesByMappingId(mapping.PalletMappingID);
    return toMappingDto(mapping, boxes);
}

/** Marks the pallet's OPEN mapping COMPLETED — permanently, per the single-use-for-life rule. Requires at least one mapped box. */
async function completePalletAsync(rawRequest, user) {
    const palletId = rawRequest && String(rawRequest.palletId || '').trim();
    if (isBlank(palletId)) {
        throw new PalletMappingError('MISSING_FIELDS', 'palletId is required.');
    }
    const completedBy = user && user.UserName;

    const mapping = await sequelize.transaction(async (transaction) => {
        const openMapping = await repository.lockOpenMappingByPalletId(transaction, palletId);
        if (!openMapping) {
            throw new PalletMappingError('PALLET_NOT_OPEN', `No open pallet mapping found for ${palletId}.`);
        }
        if (openMapping.TotalBoxCount === 0) {
            throw new PalletMappingError('PALLET_HAS_NO_BOXES', `At least one box must be mapped before completing pallet ${palletId}.`);
        }
        await repository.completeMapping(transaction, openMapping.PalletMappingID, completedBy);
        return { ...openMapping, Status: 'COMPLETED', CompletedBy: completedBy, CompletedAt: new Date() };
    });

    const boxes = await repository.getBoxesByMappingId(mapping.PalletMappingID);
    return toMappingDto(mapping, boxes);
}

async function getPalletMappingAsync(palletId) {
    if (isBlank(palletId)) {
        throw new PalletMappingError('MISSING_FIELDS', 'palletId is required.');
    }
    const mapping = await repository.findMappingByPalletId(String(palletId).trim());
    if (!mapping) {
        throw new PalletMappingError('PALLET_NOT_FOUND', `Pallet ${palletId} was not found.`);
    }
    const boxes = await repository.getBoxesByMappingId(mapping.PalletMappingID);
    return toMappingDto(mapping, boxes);
}

module.exports = {
    PalletMappingError,
    validatePalletAsync,
    addBoxAsync,
    completePalletAsync,
    getPalletMappingAsync
};
