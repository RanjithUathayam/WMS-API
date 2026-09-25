const pickingRepository = require('../repository/pickingRepository');
const inventoryRepository = require('../repository/inventoryRepository');
const palletMappingRepository = require('../repository/palletMappingRepository');
const {
    PickingError, PICKABLE_STATUSES, isBlank, readPalletNumber, readBoxNumber, readId,
    sumQty, subtractQty, pickableQty, assertPalletPickable, toInventoryLineDto
} = require('./pickingCommon');

/**
 * Read-only stock views for Pick List picking. Every quantity here is read from T_INVENTORY on the
 * server — nothing supplied by the frontend is trusted. The mutating pick itself lives in
 * pickingService.savePickTransactionAsync, which re-validates everything under row locks.
 */

async function loadPickList(pickListId) {
    const id = readId(pickListId);
    if (!id) {
        throw new PickingError('MISSING_FIELDS', 'A valid pickListId is required.');
    }
    const header = await pickingRepository.findPickListById(id);
    if (!header) {
        throw new PickingError('PICKLIST_NOT_FOUND', `Pick List ${id} was not found.`);
    }
    const details = await pickingRepository.getPickListDetails(id);
    return { header, details };
}

function assertPickListPickable(header) {
    if (!PICKABLE_STATUSES.includes(header.Status)) {
        throw new PickingError('PICKLIST_CLOSED', `Pick List ${header.PickListNumber} is ${header.Status} and cannot be picked.`);
    }
}

/** Open (RemainingQty > 0) details keyed by "WAREHOUSE|ITEMCODE" — the key a T_INVENTORY row must match to be applicable. */
function indexOpenDetails(details) {
    const index = new Map();
    for (const d of details) {
        if (Number(d.RemainingQty) <= 0) continue;
        const key = `${String(d.FromWarehouse).toUpperCase()}|${String(d.ItemCode).toUpperCase()}`;
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(d);
    }
    return index;
}

function detailKeyForInventory(row) {
    return `${String(row.WarehouseCode || '').toUpperCase()}|${String(row.ItemCode).toUpperCase()}`;
}

function toPickListLineRef(d) {
    return {
        pickListDetailId: d.PickListDetailID,
        sourceDocEntry: d.SourceDocEntry,
        sourceDocNum: d.SourceDocNum,
        sourceLineNum: d.SourceLineNum,
        requiredQty: Number(d.RequestedQty),
        pickedQty: Number(d.PickedQty),
        remainingQty: Number(d.RemainingQty)
    };
}

/** An inventory line plus the Pick List lines it can satisfy and the most it makes sense to pick from it. */
function toApplicableLineDto(row, matchingDetails) {
    const remainingForItem = sumQty(matchingDetails.map(d => d.RemainingQty));
    const pickable = pickableQty(row);
    return {
        ...toInventoryLineDto(row),
        itemName: row.ItemName || (matchingDetails[0] && matchingDetails[0].ItemName) || null,
        remainingRequiredQty: remainingForItem,
        suggestedPickQty: Math.min(pickable, remainingForItem),
        pickListLines: matchingDetails.map(toPickListLineRef)
    };
}

function toInventoryPositionDto(row) {
    return {
        inventoryId: row.InventoryID,
        warehouse: row.WarehouseCode,
        rowCode: row.RowCode || null,
        locationId: row.LocationID,
        location: row.LocationCode,
        palletMappingId: row.PalletMappingID,
        palletNumber: row.PalletID,
        boxId: row.PalletMappingBoxID || null,
        boxNumber: row.BoxNumber,
        availableQty: pickableQty(row)
    };
}

/** GET /picklist/:id/inventory — pickable stock (warehouse -> location -> pallet -> box) for every Pick List line. */
async function getPickListInventoryAsync(pickListId) {
    const { header, details } = await loadPickList(pickListId);

    // A Pick List normally has one From warehouse; grouping keeps this correct if that ever changes.
    const itemsByWarehouse = new Map();
    for (const d of details) {
        if (!itemsByWarehouse.has(d.FromWarehouse)) itemsByWarehouse.set(d.FromWarehouse, new Set());
        itemsByWarehouse.get(d.FromWarehouse).add(d.ItemCode);
    }

    const stockByKey = new Map();
    for (const [warehouseCode, itemSet] of itemsByWarehouse) {
        const rows = await inventoryRepository.getPickableInventoryForItems({ warehouseCode, itemCodes: [...itemSet] });
        for (const row of rows) {
            const key = detailKeyForInventory(row);
            if (!stockByKey.has(key)) stockByKey.set(key, []);
            stockByKey.get(key).push(toInventoryPositionDto(row));
        }
    }

    const keyOf = d => `${String(d.FromWarehouse).toUpperCase()}|${String(d.ItemCode).toUpperCase()}`;

    const items = details.map(d => {
        const inventory = stockByKey.get(keyOf(d)) || [];
        return {
            pickListDetailId: d.PickListDetailID,
            sourceDocEntry: d.SourceDocEntry,
            sourceDocNum: d.SourceDocNum,
            sourceLineNum: d.SourceLineNum,
            itemCode: d.ItemCode,
            itemName: d.ItemName,
            fromWarehouse: d.FromWarehouse,
            toWarehouse: d.ToWarehouse,
            requiredQty: Number(d.RequestedQty),
            pickedQty: Number(d.PickedQty),
            remainingQty: Number(d.RemainingQty),
            status: d.Status,
            totalAvailableQty: sumQty(inventory.map(i => i.availableQty)),
            inventory
        };
    });

    // Item-level roll-up: the same item can appear on several STR lines, all competing for the same stock.
    const summaryMap = new Map();
    for (const d of details) {
        const key = keyOf(d);
        if (!summaryMap.has(key)) {
            const inventory = stockByKey.get(key) || [];
            summaryMap.set(key, {
                itemCode: d.ItemCode, itemName: d.ItemName, warehouse: d.FromWarehouse,
                requiredQty: 0, pickedQty: 0, remainingQty: 0,
                availableQty: sumQty(inventory.map(i => i.availableQty))
            });
        }
        const s = summaryMap.get(key);
        s.requiredQty = sumQty([s.requiredQty, d.RequestedQty]);
        s.pickedQty = sumQty([s.pickedQty, d.PickedQty]);
        s.remainingQty = sumQty([s.remainingQty, d.RemainingQty]);
    }
    const itemSummary = [...summaryMap.values()].map(s => ({
        ...s,
        shortageQty: Math.max(subtractQty(s.remainingQty, s.availableQty), 0)
    }));

    return {
        pickListId: header.PickListID,
        pickListNumber: header.PickListNumber,
        status: header.Status,
        fromWarehouse: header.FromWarehouse,
        toWarehouse: header.ToWarehouse,
        items,
        itemSummary
    };
}

/** POST /pick/pallet (with pickListId) — pallet must exist, be pickable, and hold stock for an open line of this Pick List. */
async function scanPalletForPickListAsync(rawRequest) {
    const palletNumber = readPalletNumber(rawRequest);
    if (isBlank(palletNumber)) {
        throw new PickingError('MISSING_FIELDS', 'pickListId and palletNumber are required.');
    }
    const { header, details } = await loadPickList(rawRequest.pickListId);
    assertPickListPickable(header);

    const mapping = await palletMappingRepository.findMappingByPalletId(palletNumber);
    assertPalletPickable(mapping, palletNumber);

    const lines = await inventoryRepository.getAvailableInventoryByPallet(mapping.PalletMappingID);
    const withStock = lines.filter(l => pickableQty(l) > 0);
    if (withStock.length === 0) {
        throw new PickingError('PALLET_NOT_AVAILABLE', `Pallet ${palletNumber} has no inventory available for picking.`);
    }

    const openDetails = indexOpenDetails(details);
    const applicable = withStock
        .map(row => ({ row, matches: openDetails.get(detailKeyForInventory(row)) || [] }))
        .filter(x => x.matches.length > 0);

    if (applicable.length === 0) {
        throw new PickingError('PALLET_NOT_APPLICABLE',
            `Pallet ${palletNumber} does not hold any item still required by Pick List ${header.PickListNumber} in warehouse ${header.FromWarehouse}.`);
    }

    return {
        pickListId: header.PickListID,
        pickListNumber: header.PickListNumber,
        palletMappingId: mapping.PalletMappingID,
        palletNumber: mapping.PalletID,
        palletStatus: mapping.Status,
        pickingStatus: mapping.PickingStatus || 'PENDING',
        locations: [...new Set(applicable.map(x => x.row.LocationCode).filter(Boolean))],
        boxNumbers: [...new Set(applicable.map(x => x.row.BoxNumber))],
        items: applicable.map(x => toApplicableLineDto(x.row, x.matches))
    };
}

/** POST /pick/box (with pickListId) — box must exist, sit on the scanned pallet, and hold a still-required item with stock. */
async function scanBoxForPickListAsync(rawRequest) {
    const palletNumber = readPalletNumber(rawRequest);
    const boxNumber = readBoxNumber(rawRequest);
    if (isBlank(palletNumber) || isBlank(boxNumber)) {
        throw new PickingError('MISSING_FIELDS', 'pickListId, palletNumber and boxNumber are required.');
    }
    const { header, details } = await loadPickList(rawRequest.pickListId);
    assertPickListPickable(header);

    const mapping = await palletMappingRepository.findMappingByPalletId(palletNumber);
    assertPalletPickable(mapping, palletNumber);

    const boxLines = await inventoryRepository.getInventoryByPalletAndBox(mapping.PalletMappingID, boxNumber);
    if (boxLines.length === 0) {
        const existsElsewhere = await inventoryRepository.boxExistsInInventory(boxNumber);
        if (existsElsewhere) {
            throw new PickingError('BOX_NOT_IN_PALLET', `Box ${boxNumber} does not belong to pallet ${palletNumber}.`);
        }
        throw new PickingError('BOX_NOT_FOUND', `Box ${boxNumber} was not found.`);
    }

    const openDetails = indexOpenDetails(details);
    const requiredLines = boxLines
        .map(row => ({ row, matches: openDetails.get(detailKeyForInventory(row)) || [] }))
        .filter(x => x.matches.length > 0);
    if (requiredLines.length === 0) {
        throw new PickingError('BOX_NOT_APPLICABLE',
            `Box ${boxNumber} does not contain any item still required by Pick List ${header.PickListNumber}.`);
    }

    const available = requiredLines.filter(x => x.row.Status === 'AVAILABLE' && pickableQty(x.row) > 0);
    if (available.length === 0) {
        throw new PickingError('INSUFFICIENT_STOCK', `Box ${boxNumber} has no available quantity left for the required item(s).`);
    }

    const box = await palletMappingRepository.findMappingBoxByBoxNumber(boxNumber);

    return {
        pickListId: header.PickListID,
        pickListNumber: header.PickListNumber,
        palletMappingId: mapping.PalletMappingID,
        palletNumber: mapping.PalletID,
        boxId: box && box.PalletMappingID === mapping.PalletMappingID ? box.PalletMappingBoxID : null,
        boxNumber,
        items: available.map(x => toApplicableLineDto(x.row, x.matches))
    };
}

module.exports = {
    getPickListInventoryAsync,
    scanPalletForPickListAsync,
    scanBoxForPickListAsync
};
