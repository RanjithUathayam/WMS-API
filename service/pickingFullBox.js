const { PickingError, toQty, subtractQty, sumQty, sameCode } = require('./pickingCommon');

/**
 * Full Box Picking rules for Pick Lists — pure functions, no database access, shared by Pick List
 * generation (box plan), the box scan (preview) and the save pick (authoritative, under row locks)
 * so all three apply exactly the same rules.
 *
 *   - A box is always picked whole: every item line in it, at its full quantity. Partial box picking is
 *     not possible — the quantity is never taken from the operator.
 *   - The picked quantity is the actual box quantity, so it can exceed the required quantity
 *     (required 10, box 25 -> picked 25, excess 15). Excess is recorded, never discarded.
 *   - A box whose contents are not all on the Pick List is rejected: moving it physically would move
 *     stock that no Stock Transfer covers.
 */

function itemKey(warehouse, itemCode) {
    return `${String(warehouse || '').trim().toUpperCase()}|${String(itemCode || '').trim().toUpperCase()}`;
}

function excessOf(requestedQty, pickedQty) {
    return Math.max(subtractQty(pickedQty, requestedQty), 0);
}

/**
 * Chooses whole boxes to cover `requiredQty` from `rows` (each { qty, ... }).
 * Greedy, minimising excess and box count: when one box covers what is left, the smallest such box is
 * taken; otherwise the largest box is taken and the loop continues.
 * Returns { boxes, plannedQty (sum of chosen boxes), excessQty, shortageQty }.
 */
function planFullBoxes(rows, requiredQty) {
    const pool = rows.filter(r => toQty(r.qty) > 0).slice().sort((a, b) => toQty(b.qty) - toQty(a.qty));
    const boxes = [];
    let left = toQty(requiredQty);
    while (left > 0 && pool.length > 0) {
        let index = -1;
        for (let i = pool.length - 1; i >= 0; i--) {   // ascending from the end: first fit is the smallest
            if (toQty(pool[i].qty) >= left) { index = i; break; }
        }
        if (index === -1) index = 0;                     // nothing covers it: take the largest
        const [box] = pool.splice(index, 1);
        boxes.push(box);
        left = subtractQty(left, box.qty);
    }
    const plannedQty = sumQty(boxes.map(b => b.qty));
    return {
        boxes,
        plannedQty,
        excessQty: Math.max(subtractQty(plannedQty, requiredQty), 0),
        shortageQty: Math.max(left, 0)
    };
}

/**
 * Splits a full box quantity over the Pick List lines of one item (ordered by source DocNum/LineNum):
 * each open line is filled up to its remaining quantity, and whatever is left (the excess) goes to the
 * last line that received quantity — or, if every line was already complete, to the item's last line.
 * `lines` are { PickListDetailID, RemainingQty, ... } and are NOT mutated.
 * Returns [{ line, qty, excessQty }] with qty > 0 only.
 */
function allocateBoxQty(lines, boxQty) {
    if (lines.length === 0) return [];
    let left = toQty(boxQty);
    const allocations = [];
    for (const line of lines) {
        if (left <= 0) break;
        const remaining = toQty(line.RemainingQty);
        if (remaining <= 0) continue;
        const qty = Math.min(remaining, left);
        allocations.push({ line, qty, excessQty: 0 });
        left = subtractQty(left, qty);
    }
    if (left > 0) {
        const target = allocations.length > 0 ? allocations[allocations.length - 1] : null;
        if (target) {
            target.qty = sumQty([target.qty, left]);
            target.excessQty = left;
        } else {
            allocations.push({ line: lines[lines.length - 1], qty: left, excessQty: left });
        }
    }
    return allocations;
}

/**
 * Validates a scanned box against the Pick List and works out what picking it means.
 * `boxRows` are the T_INVENTORY rows of (pallet, box); `details` are all Pick List lines.
 * Throws PickingError when the box cannot be picked whole. Returns:
 *   { lines: [{ row, boxQty, itemLines, remainingRequiredQty, excessQty, allocations }],
 *     totalBoxQty, totalRequiredQty (still required, covered by this box), totalExcessQty }
 */
function evaluateFullBox({ boxRows, details, boxNumber, palletNumber, pickListNumber, fromWarehouse }) {
    const live = boxRows.filter(r => r.Status === 'AVAILABLE' && toQty(r.Quantity) > 0);
    if (live.length === 0) {
        throw new PickingError('BOX_ALREADY_PICKED', `Box ${boxNumber} has already been picked (no stock left in it).`);
    }

    const wrongWarehouse = live.find(r => fromWarehouse && !sameCode(r.WarehouseCode, fromWarehouse));
    if (wrongWarehouse) {
        throw new PickingError('WAREHOUSE_MISMATCH',
            `Box ${boxNumber} is in warehouse ${wrongWarehouse.WarehouseCode}; Pick List ${pickListNumber} picks from ${fromWarehouse}.`);
    }

    const allocated = live.filter(r => toQty(r.AllocatedQty) > 0);
    if (allocated.length > 0) {
        throw new PickingError('BOX_PARTIALLY_ALLOCATED',
            `Box ${boxNumber} has quantity allocated elsewhere (${allocated.map(r => r.ItemCode).join(', ')}); a full box cannot be picked.`);
    }

    const linesByItem = new Map();
    for (const d of details) {
        const key = itemKey(d.FromWarehouse, d.ItemCode);
        if (!linesByItem.has(key)) linesByItem.set(key, []);
        linesByItem.get(key).push(d);
    }

    const unlisted = live.filter(r => !linesByItem.has(itemKey(r.WarehouseCode, r.ItemCode)));
    if (unlisted.length > 0) {
        throw new PickingError('BOX_HAS_UNLISTED_ITEMS',
            `Box ${boxNumber} also contains ${unlisted.map(r => `${r.ItemCode} (${toQty(r.Quantity)})`).join(', ')}, `
            + `which ${unlisted.length === 1 ? 'is' : 'are'} not on Pick List ${pickListNumber}. Only full boxes can be picked — use another box.`,
            { unlistedItems: unlisted.map(r => ({ itemCode: r.ItemCode, qty: toQty(r.Quantity) })) });
    }

    const lines = live.map(row => {
        const itemLines = linesByItem.get(itemKey(row.WarehouseCode, row.ItemCode));
        const boxQty = toQty(row.Quantity);
        const remainingRequiredQty = sumQty(itemLines.map(d => Math.max(toQty(d.RemainingQty), 0)));
        return {
            row,
            boxQty,
            itemLines,
            remainingRequiredQty,
            excessQty: Math.max(subtractQty(boxQty, remainingRequiredQty), 0),
            allocations: allocateBoxQty(itemLines, boxQty)
        };
    });

    if (!lines.some(l => l.remainingRequiredQty > 0)) {
        throw new PickingError('BOX_NOT_APPLICABLE',
            `Box ${boxNumber} on pallet ${palletNumber} holds only items that are already fully picked on Pick List ${pickListNumber}.`);
    }

    return {
        lines,
        totalBoxQty: sumQty(lines.map(l => l.boxQty)),
        totalRequiredQty: sumQty(lines.map(l => Math.min(l.boxQty, l.remainingRequiredQty))),
        totalExcessQty: sumQty(lines.map(l => l.excessQty))
    };
}

module.exports = {
    itemKey,
    excessOf,
    planFullBoxes,
    allocateBoxQty,
    evaluateFullBox
};
