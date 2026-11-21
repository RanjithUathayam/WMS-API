const { planFullBoxes, allocateBoxQty, evaluateFullBox } = require('../service/pickingFullBox');

function row(overrides = {}) {
    return {
        InventoryID: 10, WarehouseCode: 'INTRTHDL', LocationCode: 'A01-01', BoxNumber: 'BOX001',
        ItemCode: 'FG0001', Quantity: 25, AllocatedQty: 0, Status: 'AVAILABLE', ...overrides
    };
}

function line(overrides = {}) {
    return {
        PickListDetailID: 1, SourceDocNum: 50001, SourceLineNum: 0, ItemCode: 'FG0001', FromWarehouse: 'INTRTHDL',
        RequestedQty: 10, PickedQty: 0, RemainingQty: 10, ...overrides
    };
}

const CTX = { boxNumber: 'BOX001', palletNumber: 'PAL001', pickListNumber: 'PL000100', fromWarehouse: 'INTRTHDL' };

describe('planFullBoxes', () => {
    test('required 10, one box of 25 -> plans 25, excess 15', () => {
        expect(planFullBoxes([{ qty: 25 }], 10)).toMatchObject({ plannedQty: 25, excessQty: 15, shortageQty: 0 });
    });

    test('takes the smallest box that covers what is left', () => {
        const plan = planFullBoxes([{ qty: 40, id: 'A' }, { qty: 12, id: 'C' }, { qty: 18, id: 'B' }], 15);
        expect(plan.boxes.map(b => b.id)).toEqual(['B']);
        expect(plan.excessQty).toBe(3);
    });

    test('combines boxes when none covers the requirement alone', () => {
        const plan = planFullBoxes([{ qty: 10, id: 'A' }, { qty: 8, id: 'B' }, { qty: 4, id: 'C' }], 20);
        expect(plan.boxes.map(b => b.id)).toEqual(['A', 'B', 'C']);
        expect(plan).toMatchObject({ plannedQty: 22, excessQty: 2, shortageQty: 0 });
    });

    test('reports a shortage when stock is not enough', () => {
        expect(planFullBoxes([{ qty: 5 }], 12)).toMatchObject({ plannedQty: 5, excessQty: 0, shortageQty: 7 });
    });

    test('decimal quantities do not drift', () => {
        expect(planFullBoxes([{ qty: 0.1 }, { qty: 0.2 }], 0.3)).toMatchObject({ plannedQty: 0.3, excessQty: 0, shortageQty: 0 });
    });
});

describe('allocateBoxQty', () => {
    test('fills open lines in order and puts the excess on the last line that received quantity', () => {
        const lines = [line({ PickListDetailID: 1, RemainingQty: 10 }), line({ PickListDetailID: 2, RemainingQty: 8 }), line({ PickListDetailID: 3, RemainingQty: 50 })];
        expect(allocateBoxQty(lines.slice(0, 2), 25).map(a => [a.line.PickListDetailID, a.qty, a.excessQty])).toEqual([[1, 10, 0], [2, 15, 7]]);
        expect(allocateBoxQty(lines, 25).map(a => [a.line.PickListDetailID, a.qty, a.excessQty])).toEqual([[1, 10, 0], [2, 8, 0], [3, 7, 0]]);
    });

    test('skips complete lines', () => {
        const lines = [line({ PickListDetailID: 1, RemainingQty: 0 }), line({ PickListDetailID: 2, RemainingQty: 4 })];
        expect(allocateBoxQty(lines, 6).map(a => [a.line.PickListDetailID, a.qty, a.excessQty])).toEqual([[2, 6, 2]]);
    });

    test('when every line is complete the whole box is excess on the last line', () => {
        const lines = [line({ PickListDetailID: 1, RemainingQty: 0 }), line({ PickListDetailID: 2, RemainingQty: 0 })];
        expect(allocateBoxQty(lines, 5).map(a => [a.line.PickListDetailID, a.qty, a.excessQty])).toEqual([[2, 5, 5]]);
    });
});

describe('evaluateFullBox', () => {
    test('whole box quantity with excess', () => {
        const result = evaluateFullBox({ ...CTX, boxRows: [row()], details: [line()] });
        expect(result).toMatchObject({ totalBoxQty: 25, totalRequiredQty: 10, totalExcessQty: 15 });
    });

    test('ignores cleared rows but rejects an entirely cleared box', () => {
        expect(() => evaluateFullBox({ ...CTX, boxRows: [row({ Quantity: 0, Status: 'CLEARED' })], details: [line()] }))
            .toThrow(expect.objectContaining({ code: 'BOX_ALREADY_PICKED' }));
    });

    test('rejects unlisted items, other warehouses and allocated stock', () => {
        expect(() => evaluateFullBox({ ...CTX, boxRows: [row(), row({ ItemCode: 'X' })], details: [line()] }))
            .toThrow(expect.objectContaining({ code: 'BOX_HAS_UNLISTED_ITEMS' }));
        expect(() => evaluateFullBox({ ...CTX, boxRows: [row({ WarehouseCode: 'OTHER' })], details: [line()] }))
            .toThrow(expect.objectContaining({ code: 'WAREHOUSE_MISMATCH' }));
        expect(() => evaluateFullBox({ ...CTX, boxRows: [row({ AllocatedQty: 1 })], details: [line()] }))
            .toThrow(expect.objectContaining({ code: 'BOX_PARTIALLY_ALLOCATED' }));
    });

    test('item codes match case-insensitively', () => {
        const result = evaluateFullBox({ ...CTX, boxRows: [row({ ItemCode: 'fg0001' })], details: [line()] });
        expect(result.totalBoxQty).toBe(25);
    });
});
