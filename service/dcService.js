const { sequelize } = require('../config/database');
const pickingRepository = require('../repository/pickingRepository');
const dcRepository = require('../repository/dcRepository');
const { PickingError, sumQty } = require('./pickingCommon');

/** Pick List statuses from which a DC may be generated (picking validated-complete). */
const DC_ALLOWED_STATUSES = ['PICKED', 'DC_CREATED', 'COMPLETED'];

function toDCDto(dc) {
    return {
        dcId: dc.DCID,
        dcNumber: dc.DCNumber,
        pickListId: dc.PickListID,
        dcDate: dc.DCDate,
        fromWarehouse: dc.FromWarehouse,
        toWarehouse: dc.ToWarehouse,
        totalQty: Number(dc.TotalQty),
        status: dc.Status
    };
}

/**
 * Generates the Delivery Challan for a Pick List whose picking has been validated complete.
 * Idempotent: an existing DC (header reference or T_DC row) is returned instead of creating another,
 * and UX_DC_PICKLIST makes a second DC impossible even under a race.
 * Returns { ...dc, created: boolean }.
 */
async function generateDCFromPickList(pickListId, { user } = {}) {
    try {
        return await sequelize.transaction(async (transaction) => {
            const header = await pickingRepository.lockPickListById(transaction, pickListId);
            if (!header) {
                throw new PickingError('PICKLIST_NOT_FOUND', `Pick List ${pickListId} was not found.`);
            }

            const existing = await dcRepository.findDCByPickListId(pickListId, transaction);
            if (existing) {
                if (!header.DCID) {
                    await pickingRepository.markDCCreated(transaction, pickListId, {
                        dcId: existing.DCID, dcNumber: existing.DCNumber, updatedBy: user
                    });
                }
                return { ...toDCDto(existing), created: false };
            }

            if (!DC_ALLOWED_STATUSES.includes(header.Status) || !header.CompletedDate) {
                throw new PickingError('DC_NOT_ALLOWED', `Pick List ${header.PickListNumber} is ${header.Status}; a DC can only be generated after picking is completed.`);
            }

            const details = await pickingRepository.lockPickListDetails(transaction, pickListId);
            const unpicked = details.filter(d => Number(d.RemainingQty) > 0);
            if (details.length === 0 || unpicked.length > 0) {
                throw new PickingError('PICKING_INCOMPLETE', `Pick List ${header.PickListNumber} still has unpicked quantity.`);
            }

            const dc = await dcRepository.insertDC(transaction, {
                pickListId,
                dcDate: header.CompletedDateText,
                fromWarehouse: header.FromWarehouse,
                toWarehouse: header.ToWarehouse,
                totalQty: sumQty(details.map(d => d.PickedQty)),
                createdBy: user
            });

            for (const d of details) {
                if (Number(d.PickedQty) <= 0) continue;
                await dcRepository.insertDCDetail(transaction, {
                    dcId: dc.DCID,
                    pickListDetailId: d.PickListDetailID,
                    sourceDocEntry: d.SourceDocEntry,
                    sourceDocNum: d.SourceDocNum,
                    sourceLineNum: d.SourceLineNum,
                    itemCode: d.ItemCode,
                    itemName: d.ItemName,
                    quantity: Number(d.PickedQty),
                    fromWarehouse: d.FromWarehouse,
                    toWarehouse: d.ToWarehouse
                });
            }

            await pickingRepository.markDCCreated(transaction, pickListId, {
                dcId: dc.DCID, dcNumber: dc.DCNumber, updatedBy: user
            });
            return { ...toDCDto(dc), created: true };
        });
    } catch (error) {
        if (error && error.isDuplicateDC) {
            // Lost a race to another request: its DC is committed, adopt it.
            const existing = await dcRepository.findDCByPickListId(pickListId);
            if (existing) return { ...toDCDto(existing), created: false };
        }
        throw error;
    }
}

async function getDCForPickList(pickListId) {
    const dc = await dcRepository.findDCByPickListId(pickListId);
    if (!dc) return null;
    const lines = await dcRepository.getDCDetails(dc.DCID);
    return {
        ...toDCDto(dc),
        lines: lines.map(l => ({
            pickListDetailId: l.PickListDetailID,
            sourceDocEntry: l.SourceDocEntry,
            sourceDocNum: l.SourceDocNum,
            sourceLineNum: l.SourceLineNum,
            itemCode: l.ItemCode,
            itemName: l.ItemName,
            quantity: Number(l.Quantity),
            fromWarehouse: l.FromWarehouse,
            toWarehouse: l.ToWarehouse
        }))
    };
}

module.exports = {
    generateDCFromPickList,
    getDCForPickList
};
