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

/** Resolves the current, permanent state of a PalletID: AVAILABLE, OPEN, or COMPLETED. */
function describePalletState(pallet) {
    if (!pallet) {
        return { exists: false, status: 'AVAILABLE', totalBoxCount: 0 };
    }
    if (pallet.Status === 'COMPLETED') {
        throw new PalletMappingError('PALLET_ALREADY_COMPLETED', `Pallet ${pallet.PalletID} is already completed and cannot be reused.`);
    }
    return { exists: true, status: pallet.Status, totalBoxCount: Number(pallet.TotalBoxCount) };
}

async function validatePalletAsync({ palletId }) {
    if (isBlank(palletId)) {
        throw new PalletMappingError('INVALID_PALLET_ID', 'Pallet ID is required.');
    }
    const trimmedPalletId = String(palletId).trim();

    const pallet = await repository.findLatestPalletByPalletId(trimmedPalletId);
    const state = describePalletState(pallet); // throws PALLET_ALREADY_COMPLETED

    return {
        palletId: trimmedPalletId,
        exists: state.exists,
        status: state.status,
        totalBoxCount: state.totalBoxCount
    };
}

/**
 * Box eligibility is resolved entirely from the existing Pre-Binning box master (T_PREBIN_BOX) — a
 * box must have finished Pre-Binning (Status = 'COMPLETED') before it can be placed on a pallet.
 */
async function validateBoxAsync({ boxNumber }) {
    if (isBlank(boxNumber)) {
        throw new PalletMappingError('INVALID_BOX_NUMBER', 'Box Number is required.');
    }
    const trimmedBoxNumber = String(boxNumber).trim();

    const box = await repository.findPrebinBoxByNumber(trimmedBoxNumber);
    if (!box) {
        throw new PalletMappingError('BOX_NOT_FOUND', `Box ${trimmedBoxNumber} was not found.`);
    }
    if (box.Status !== 'COMPLETED') {
        throw new PalletMappingError('BOX_NOT_ELIGIBLE', `Box ${trimmedBoxNumber} has not completed Pre-Binning yet and cannot be mapped to a pallet.`);
    }

    const existingMapping = await repository.findMappingByBoxNumber(trimmedBoxNumber);
    if (existingMapping) {
        throw new PalletMappingError('BOX_ALREADY_MAPPED', `Box ${trimmedBoxNumber} is already mapped to pallet ${existingMapping.PalletID}.`);
    }

    return {
        boxNumber: trimmedBoxNumber,
        warehouseCode: box.WarehouseCode,
        itemGroup: box.ItemGroup,
        totalQty: Number(box.TotalQty),
        eligible: true
    };
}

async function addBoxToPalletAsync(rawRequest, user) {
    if (isBlank(rawRequest && rawRequest.palletId) || isBlank(rawRequest && rawRequest.boxNumber)) {
        throw new PalletMappingError('MISSING_FIELDS', 'palletId and boxNumber are required.');
    }
    const trimmedPalletId = String(rawRequest.palletId).trim();
    const trimmedBoxNumber = String(rawRequest.boxNumber).trim();
    const mappedBy = user && user.UserName;

    return sequelize.transaction(async (transaction) => {
        // 1 — Pallet (single-use lifetime, see describePalletState)
        let pallet = await repository.lockLatestPalletByPalletId(transaction, trimmedPalletId);
        const state = describePalletState(pallet); // throws PALLET_ALREADY_COMPLETED
        if (!state.exists) pallet = null;

        // 2 — Box: must exist and have completed Pre-Binning (T_PREBIN_BOX is the source of truth)
        const box = await repository.lockPrebinBoxByNumber(transaction, trimmedBoxNumber);
        if (!box) {
            throw new PalletMappingError('BOX_NOT_FOUND', `Box ${trimmedBoxNumber} was not found.`);
        }
        if (box.Status !== 'COMPLETED') {
            throw new PalletMappingError('BOX_NOT_ELIGIBLE', `Box ${trimmedBoxNumber} has not completed Pre-Binning yet and cannot be mapped to a pallet.`);
        }

        // 3 — Duplicate / already-mapped-elsewhere check, locked to close the race window before insert
        const existingMapping = await repository.lockMappingByBoxNumber(transaction, trimmedBoxNumber);
        if (existingMapping) {
            throw new PalletMappingError('BOX_ALREADY_MAPPED', `Box ${trimmedBoxNumber} is already mapped to pallet ${existingMapping.PalletID}.`);
        }

        // Persist — create the pallet mapping header if this is the first box for a brand-new PalletID.
        if (!pallet) {
            try {
                pallet = await repository.createPalletMapping(transaction, {
                    palletId: trimmedPalletId,
                    createdBy: mappedBy
                });
            } catch (error) {
                // Two scanners racing to open the same brand-new PalletID.
                const rival = await repository.lockLatestPalletByPalletId(transaction, trimmedPalletId);
                if (!rival) throw error;
                describePalletState(rival); // throws PALLET_ALREADY_COMPLETED if applicable
                pallet = rival;
            }
        }

        try {
            await repository.insertMappedBox(transaction, {
                palletMappingID: pallet.PalletMappingID,
                palletId: trimmedPalletId,
                boxNumber: trimmedBoxNumber,
                warehouseCode: box.WarehouseCode,
                itemGroup: box.ItemGroup,
                boxTotalQty: box.TotalQty,
                mappedBy
            });
        } catch (error) {
            if (error.code === 'BOX_ALREADY_MAPPED') {
                throw new PalletMappingError('BOX_ALREADY_MAPPED', error.message);
            }
            throw error;
        }

        await repository.incrementPalletBoxCount(transaction, pallet.PalletMappingID);

        return {
            palletId: trimmedPalletId,
            boxNumber: trimmedBoxNumber,
            palletStatus: 'OPEN',
            totalBoxCount: Number(pallet.TotalBoxCount) + 1
        };
    });
}

async function completePalletAsync({ palletId }, user) {
    if (isBlank(palletId)) {
        throw new PalletMappingError('INVALID_PALLET_ID', 'Pallet ID is required.');
    }
    const trimmedPalletId = String(palletId).trim();
    const completedBy = user && user.UserName;

    return sequelize.transaction(async (transaction) => {
        const pallet = await repository.lockLatestPalletByPalletId(transaction, trimmedPalletId);
        if (!pallet) {
            throw new PalletMappingError('PALLET_NOT_FOUND', `Pallet ${trimmedPalletId} was not found.`);
        }
        if (pallet.Status === 'COMPLETED') {
            throw new PalletMappingError('PALLET_ALREADY_COMPLETED', `Pallet ${trimmedPalletId} is already completed.`);
        }

        const boxCount = await repository.getBoxCountForPallet(transaction, pallet.PalletMappingID);
        if (boxCount === 0) {
            throw new PalletMappingError('PALLET_EMPTY', `Pallet ${trimmedPalletId} has no mapped boxes.`);
        }

        await repository.completePalletMapping(transaction, pallet.PalletMappingID, completedBy);

        return {
            palletId: trimmedPalletId,
            status: 'COMPLETED',
            totalBoxCount: boxCount
        };
    });
}

async function getPalletMappingAsync(palletId) {
    if (isBlank(palletId)) {
        throw new PalletMappingError('INVALID_PALLET_ID', 'Pallet ID is required.');
    }
    const trimmedPalletId = String(palletId).trim();

    const result = await repository.getPalletWithBoxes(trimmedPalletId);
    if (!result) {
        throw new PalletMappingError('PALLET_NOT_FOUND', `Pallet ${trimmedPalletId} was not found.`);
    }

    return {
        palletId: result.pallet.PalletID,
        status: result.pallet.Status,
        totalBoxCount: Number(result.pallet.TotalBoxCount),
        createdBy: result.pallet.CreatedBy,
        createdAt: result.pallet.CreatedAt,
        completedBy: result.pallet.CompletedBy,
        completedAt: result.pallet.CompletedAt,
        boxes: result.boxes.map(box => ({
            boxNumber: box.BoxNumber,
            warehouseCode: box.WarehouseCode,
            itemGroup: box.ItemGroup,
            totalQty: box.BoxTotalQty === null ? null : Number(box.BoxTotalQty),
            mappedBy: box.MappedBy,
            mappedAt: box.MappedAt
        }))
    };
}

module.exports = {
    PalletMappingError,
    validatePalletAsync,
    validateBoxAsync,
    addBoxToPalletAsync,
    completePalletAsync,
    getPalletMappingAsync
};
