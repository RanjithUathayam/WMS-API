jest.mock('../config/database', () => ({
    sequelize: { transaction: jest.fn(fn => fn({})) }
}));
jest.mock('../repository/palletMappingRepository');
jest.mock('../repository/inventoryRepository');
jest.mock('../repository/pickingRepository');
jest.mock('../service/dcService');
jest.mock('../service/sapStockTransferService', () => {
    const { PickingError } = jest.requireActual('../service/pickingCommon');
    class SapServiceError extends PickingError {}
    return { SapServiceError, postStockTransferForPickList: jest.fn() };
});

const palletMappingRepository = require('../repository/palletMappingRepository');
const inventoryRepository = require('../repository/inventoryRepository');
const pickingRepository = require('../repository/pickingRepository');
const dcService = require('../service/dcService');
const sapStockTransferService = require('../service/sapStockTransferService');
const service = require('../service/pickingService');

const USER = { UserName: 'operator1' };

function strLine(overrides = {}) {
    return {
        DocEntry: 1001, DocNum: 50001, DocDate: '2026-05-20', DocDueDate: '2026-05-25', LineNum: 0,
        ItemCode: 'FG0001', ItemName: 'Finished Good 1', RequestedQty: 10, OpenQty: 10,
        FromWarehouse: 'INTRTHDL', FromWarehouseName: 'Thindal', ToWarehouse: 'INTRATTM', ToWarehouseName: 'Attur',
        LineStatus: 'O', ...overrides
    };
}

function header(overrides = {}) {
    return {
        PickListID: 100, PickListNumber: 'PL000100', Status: 'IN_PROGRESS',
        FromWarehouse: 'INTRTHDL', ToWarehouse: 'INTRATTM', ProcessingToken: null, ProcessingAgeSeconds: null,
        ...overrides
    };
}

function detail(overrides = {}) {
    return {
        PickListDetailID: 1001, PickListID: 100, SourceDocEntry: 1001, SourceDocNum: 50001, SourceLineNum: 0,
        ItemCode: 'FG0001', ItemName: 'Finished Good 1', RequestedQty: 20, PickedQty: 5, RemainingQty: 15,
        FromWarehouse: 'INTRTHDL', ToWarehouse: 'INTRATTM', Status: 'PARTIAL', ...overrides
    };
}

function invRow(overrides = {}) {
    return {
        InventoryID: 10, WarehouseCode: 'INTRTHDL', RowCode: 'A', LocationID: 5, LocationCode: 'A01-01',
        PalletMappingID: 1, PalletID: 'PAL001', BoxNumber: 'BOX001', ItemCode: 'FG0001', ItemGroup: 'FG',
        Quantity: 10, AllocatedQty: 0, Status: 'AVAILABLE', ...overrides
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('createPickListAsync', () => {
    beforeEach(() => {
        pickingRepository.acquirePickListCreationLock.mockResolvedValue(true);
        pickingRepository.getTransferRequestHeaders.mockResolvedValue([
            { DocEntry: 1001, DocNum: 50001, DocStatus: 'O', Canceled: 'N' },
            { DocEntry: 1002, DocNum: 50002, DocStatus: 'O', Canceled: 'N' }
        ]);
        pickingRepository.getReservedQtyBySourceLines.mockResolvedValue([]);
        inventoryRepository.getPickableInventoryForItems.mockResolvedValue([]);
        pickingRepository.insertPickListHeader.mockImplementation(async (tx, h) => ({
            PickListID: 100, PickListNumber: 'PL000100', Status: 'OPEN', FromWarehouse: h.fromWarehouse,
            ToWarehouse: h.toWarehouse, TotalRequestedQty: h.totalRequestedQty, CreatedBy: h.createdBy
        }));
        let id = 1;
        pickingRepository.insertPickListDetail.mockImplementation(async (tx, d) => ({
            PickListDetailID: id++, PickListID: d.pickListId, SourceDocEntry: d.sourceDocEntry, SourceDocNum: d.sourceDocNum,
            SourceLineNum: d.sourceLineNum, ItemCode: d.itemCode, ItemName: d.itemName, SourceOpenQty: d.sourceOpenQty,
            RequestedQty: d.requestedQty, PickedQty: 0, RemainingQty: d.requestedQty,
            FromWarehouse: d.fromWarehouse, ToWarehouse: d.toWarehouse, Status: 'OPEN'
        }));
    });

    test('rejects an empty documents array', async () => {
        await expect(service.createPickListAsync({ documents: [] }, USER)).rejects.toMatchObject({ code: 'MISSING_FIELDS' });
    });

    test('rejects a DocNum that does not match its DocEntry', async () => {
        pickingRepository.getOpenTransferRequestLines.mockResolvedValue([strLine()]);
        await expect(service.createPickListAsync({ documents: [{ docEntry: 1001, docNum: 99999 }] }, USER))
            .rejects.toMatchObject({ code: 'INVALID_DOCUMENT' });
    });

    test('rejects an unknown DocEntry', async () => {
        await expect(service.createPickListAsync({ documents: [{ docEntry: 7777, docNum: 1 }] }, USER))
            .rejects.toMatchObject({ code: 'DOCUMENT_NOT_FOUND' });
    });

    test('rejects a document with no open lines', async () => {
        pickingRepository.getOpenTransferRequestLines.mockResolvedValue([]);
        await expect(service.createPickListAsync({ documents: [{ docEntry: 1001, docNum: 50001 }] }, USER))
            .rejects.toMatchObject({ code: 'NO_OPEN_LINES' });
    });

    test('rejects a duplicate when the whole remaining quantity is already reserved', async () => {
        pickingRepository.getOpenTransferRequestLines.mockResolvedValue([strLine({ OpenQty: 10 })]);
        pickingRepository.getReservedQtyBySourceLines.mockResolvedValue([{ SourceDocEntry: 1001, SourceLineNum: 0, ReservedQty: 10 }]);
        await expect(service.createPickListAsync({ documents: [{ docEntry: 1001, docNum: 50001 }] }, USER))
            .rejects.toMatchObject({ code: 'DUPLICATE_PICKLIST' });
        expect(pickingRepository.insertPickListHeader).not.toHaveBeenCalled();
    });

    test('rejects when the creation lock cannot be acquired', async () => {
        pickingRepository.acquirePickListCreationLock.mockResolvedValue(false);
        await expect(service.createPickListAsync({ documents: [{ docEntry: 1001, docNum: 50001 }] }, USER))
            .rejects.toMatchObject({ code: 'PICKLIST_BUSY' });
    });

    test('combines documents, keeps source refs and only takes the unreserved quantity', async () => {
        pickingRepository.getOpenTransferRequestLines.mockResolvedValue([
            strLine({ DocEntry: 1001, DocNum: 50001, LineNum: 0, ItemCode: 'FG0001', OpenQty: 10 }),
            strLine({ DocEntry: 1001, DocNum: 50001, LineNum: 1, ItemCode: 'FG0002', OpenQty: 5 }),
            strLine({ DocEntry: 1002, DocNum: 50002, LineNum: 0, ItemCode: 'FG0001', OpenQty: 15 }),
            strLine({ DocEntry: 1002, DocNum: 50002, LineNum: 1, ItemCode: 'FG0003', OpenQty: 20 })
        ]);
        pickingRepository.getReservedQtyBySourceLines.mockResolvedValue([
            { SourceDocEntry: 1002, SourceLineNum: 1, ReservedQty: 8 },  // partially on another Pick List
            { SourceDocEntry: 1001, SourceLineNum: 1, ReservedQty: 5 }   // fully on another Pick List
        ]);

        const result = await service.createPickListAsync({
            documents: [{ docEntry: 1001, docNum: 50001 }, { docEntry: 1002, docNum: 50002 }]
        }, USER);

        expect(result.pickListNumber).toBe('PL000100');
        expect(result.details.map(d => [d.sourceDocNum, d.sourceLineNum, d.itemCode, d.requestedQty])).toEqual([
            [50001, 0, 'FG0001', 10],
            [50002, 0, 'FG0001', 15],
            [50002, 1, 'FG0003', 12]
        ]);
        expect(pickingRepository.insertPickListHeader).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            fromWarehouse: 'INTRTHDL', toWarehouse: 'INTRATTM', totalRequestedQty: 37, createdBy: 'operator1'
        }));
    });

    test('full box plan: required 10 with a 25 box plans the whole 25 (excess 15)', async () => {
        pickingRepository.getOpenTransferRequestLines.mockResolvedValue([strLine({ OpenQty: 10 })]);
        inventoryRepository.getPickableInventoryForItems.mockResolvedValue([
            invRow({ InventoryID: 10, BoxNumber: 'BOX001', Quantity: 25 })
        ]);
        const result = await service.createPickListAsync({ documents: [{ docEntry: 1001, docNum: 50001 }] }, USER);

        expect(pickingRepository.insertPickListDetail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ requestedQty: 10, plannedQty: 25 }));
        expect(result.boxPlan).toEqual([expect.objectContaining({
            itemCode: 'FG0001', requiredQty: 10, plannedQty: 25, excessQty: 15, shortageQty: 0,
            boxes: [expect.objectContaining({ boxNumber: 'BOX001', boxQty: 25 })]
        })]);
        expect(result.totalPlannedQty).toBe(25);
        expect(result.warnings[0]).toContain('excess 15');
    });

    test('full box plan prefers the smallest box that covers the requirement, and spreads excess to the item\'s last line', async () => {
        pickingRepository.getOpenTransferRequestLines.mockResolvedValue([
            strLine({ DocEntry: 1001, DocNum: 50001, LineNum: 0, OpenQty: 10 }),
            strLine({ DocEntry: 1002, DocNum: 50002, LineNum: 0, OpenQty: 6 })
        ]);
        inventoryRepository.getPickableInventoryForItems.mockResolvedValue([
            invRow({ InventoryID: 10, BoxNumber: 'BOX-A', Quantity: 40 }),
            invRow({ InventoryID: 11, BoxNumber: 'BOX-B', Quantity: 18 }),
            invRow({ InventoryID: 12, BoxNumber: 'BOX-C', Quantity: 12 }),
            invRow({ InventoryID: 13, BoxNumber: 'BOX-D', Quantity: 5, AllocatedQty: 1 })  // cannot be taken whole
        ]);
        const result = await service.createPickListAsync({
            documents: [{ docEntry: 1001, docNum: 50001 }, { docEntry: 1002, docNum: 50002 }]
        }, USER);

        expect(result.boxPlan[0]).toMatchObject({ requiredQty: 16, plannedQty: 18, excessQty: 2 });
        expect(result.boxPlan[0].boxes.map(b => b.boxNumber)).toEqual(['BOX-B']);
        expect(pickingRepository.insertPickListDetail.mock.calls.map(c => [c[1].requestedQty, c[1].plannedQty])).toEqual([[10, 10], [6, 8]]);
    });

    test('full box plan reports a shortage but still creates the Pick List', async () => {
        pickingRepository.getOpenTransferRequestLines.mockResolvedValue([strLine({ OpenQty: 30 })]);
        inventoryRepository.getPickableInventoryForItems.mockResolvedValue([
            invRow({ InventoryID: 10, BoxNumber: 'BOX001', Quantity: 12 }),
            invRow({ InventoryID: 11, BoxNumber: 'BOX002', Quantity: 8 })
        ]);
        const result = await service.createPickListAsync({ documents: [{ docEntry: 1001, docNum: 50001 }] }, USER);
        expect(result.boxPlan[0]).toMatchObject({ requiredQty: 30, plannedQty: 30, excessQty: 0, shortageQty: 10 });
        expect(result.warnings[0]).toContain('short 10');
    });
});

describe('savePickTransactionAsync — full box picking', () => {
    const REQUEST = { pickListId: 100, palletNumber: 'PAL001', boxNumber: 'BOX001', clientRequestId: 'hht-1' };

    beforeEach(() => {
        pickingRepository.findPickTransactionsByClientRequestId.mockResolvedValue([]);
        pickingRepository.lockPickListById.mockResolvedValue(header());
        // Required 10, nothing picked yet.
        pickingRepository.lockPickListDetails.mockResolvedValue([detail({ RequestedQty: 10, PickedQty: 0, RemainingQty: 10, Status: 'OPEN' })]);
        palletMappingRepository.lockLatestMappingByPalletId.mockResolvedValue({ PalletMappingID: 1, PalletID: 'PAL001', Status: 'COMPLETED', PickingStatus: null });
        // The box holds 25.
        inventoryRepository.lockInventoryRowsForBox.mockResolvedValue([invRow({ Quantity: 25 })]);
        pickingRepository.applyFullBoxPickToDetail.mockImplementation(async (tx, id, qty) => ({
            PickListDetailID: id, RequestedQty: 10, PickedQty: qty, RemainingQty: Math.max(10 - qty, 0), Status: qty >= 10 ? 'PICKED' : 'PARTIAL'
        }));
        inventoryRepository.deductInventoryQty.mockResolvedValue();
        pickingRepository.insertPickingHistory.mockResolvedValue({ PickingID: 555 });
        palletMappingRepository.findMappingBoxByBoxNumber.mockResolvedValue({ PalletMappingBoxID: 77, PalletMappingID: 1 });
        let txId = 9001;
        pickingRepository.insertPickTransaction.mockImplementation(async () => ({ PickTransactionID: txId++ }));
        pickingRepository.refreshPickListProgress.mockResolvedValue({ Status: 'PICKED' });
        inventoryRepository.countAvailableInventoryForPallet.mockResolvedValue(0);
        pickingRepository.updatePalletPickingStatus.mockResolvedValue();
    });

    test('requires pallet and box', async () => {
        await expect(service.savePickTransactionAsync({ pickListId: 100, palletNumber: 'PAL001' }, USER)).rejects.toMatchObject({ code: 'MISSING_FIELDS' });
    });

    test('required 10, box 25: picks the whole 25, records excess 15, clears the box', async () => {
        const result = await service.savePickTransactionAsync(REQUEST, USER);

        expect(pickingRepository.applyFullBoxPickToDetail).toHaveBeenCalledWith(expect.anything(), 1001, 25);
        expect(inventoryRepository.deductInventoryQty).toHaveBeenCalledWith(expect.anything(), 10, { remainingQty: 0, updatedBy: 'operator1' });
        expect(pickingRepository.insertPickingHistory).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ pickedQty: 25, remainingQty: 0 }));
        expect(pickingRepository.insertPickTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            pickListId: 100, pickListDetailId: 1001, sourceDocEntry: 1001, sourceDocNum: 50001, sourceLineNum: 0,
            warehouse: 'INTRTHDL', location: 'A01-01', palletNumber: 'PAL001', boxId: 77, boxNumber: 'BOX001',
            availableQty: 25, pickQty: 25, isFullBox: true, pickingHistoryId: 555, clientRequestId: 'hht-1'
        }));
        expect(pickingRepository.updatePalletPickingStatus).toHaveBeenCalledWith(expect.anything(), 1, 'COMPLETED');
        expect(result).toMatchObject({
            fullBox: true, boxQty: 25, pickQty: 25, excessQty: 15, pickedQty: 25, remainingQty: 0,
            pickListStatus: 'PICKED', duplicate: false, items: [{ itemCode: 'FG0001', boxQty: 25, excessQty: 15 }]
        });
        expect(result.warning).toContain('15 FG0001');
    });

    test('spreads one box over the item\'s source lines in order; the excess goes on the last one', async () => {
        pickingRepository.lockPickListDetails.mockResolvedValue([
            detail({ PickListDetailID: 1001, SourceLineNum: 0, RequestedQty: 10, PickedQty: 0, RemainingQty: 10 }),
            detail({ PickListDetailID: 1002, SourceDocEntry: 1002, SourceDocNum: 50002, SourceLineNum: 0, RequestedQty: 8, PickedQty: 0, RemainingQty: 8 })
        ]);
        const result = await service.savePickTransactionAsync(REQUEST, USER);

        expect(pickingRepository.applyFullBoxPickToDetail.mock.calls.map(c => [c[1], c[2]])).toEqual([[1001, 10], [1002, 15]]);
        const txs = pickingRepository.insertPickTransaction.mock.calls.map(c => c[1]);
        expect(txs.map(t => [t.pickListDetailId, t.availableQty, t.pickQty, t.clientRequestId])).toEqual([
            [1001, 25, 10, 'hht-1'], [1002, 25, 15, 'hht-1#2']
        ]);
        // one history row / one inventory deduction for the one box line
        expect(pickingRepository.insertPickingHistory).toHaveBeenCalledTimes(1);
        expect(result.excessQty).toBe(7);
    });

    test('a box with several items picks every item line in full', async () => {
        pickingRepository.lockPickListDetails.mockResolvedValue([
            detail({ PickListDetailID: 1001, ItemCode: 'FG0001', RequestedQty: 10, PickedQty: 0, RemainingQty: 10 }),
            detail({ PickListDetailID: 1003, SourceLineNum: 1, ItemCode: 'FG0002', RequestedQty: 4, PickedQty: 0, RemainingQty: 4 })
        ]);
        inventoryRepository.lockInventoryRowsForBox.mockResolvedValue([
            invRow({ InventoryID: 10, ItemCode: 'FG0001', Quantity: 10 }),
            invRow({ InventoryID: 11, ItemCode: 'FG0002', Quantity: 6 })
        ]);
        const result = await service.savePickTransactionAsync(REQUEST, USER);

        expect(inventoryRepository.deductInventoryQty.mock.calls.map(c => c[1])).toEqual([10, 11]);
        expect(result).toMatchObject({ boxQty: 16, excessQty: 2 });
        expect(result.items).toEqual([
            { itemCode: 'FG0001', boxQty: 10, excessQty: 0 },
            { itemCode: 'FG0002', boxQty: 6, excessQty: 2 }
        ]);
    });

    test('rejects a partial quantity (legacy pickQty below the box quantity) and writes nothing', async () => {
        await expect(service.savePickTransactionAsync({ ...REQUEST, itemCode: 'FG0001', pickQty: 10 }, USER))
            .rejects.toMatchObject({ code: 'PARTIAL_BOX_NOT_ALLOWED', data: { boxQty: 25 } });
        expect(inventoryRepository.deductInventoryQty).not.toHaveBeenCalled();
        expect(pickingRepository.insertPickTransaction).not.toHaveBeenCalled();
    });

    test('accepts a legacy pickQty equal to the full box quantity', async () => {
        const result = await service.savePickTransactionAsync({ ...REQUEST, itemCode: 'FG0001', pickQty: 25 }, USER);
        expect(result.boxQty).toBe(25);
    });

    test('rejects when the box changed since the operator confirmed it', async () => {
        await expect(service.savePickTransactionAsync({ ...REQUEST, confirmedBoxQty: 20 }, USER))
            .rejects.toMatchObject({ code: 'BOX_QTY_CHANGED' });
    });

    test('a box that was already picked cannot be picked again', async () => {
        inventoryRepository.lockInventoryRowsForBox.mockResolvedValue([invRow({ Quantity: 0, Status: 'CLEARED' })]);
        await expect(service.savePickTransactionAsync(REQUEST, USER)).rejects.toMatchObject({ code: 'BOX_ALREADY_PICKED' });
        expect(pickingRepository.applyFullBoxPickToDetail).not.toHaveBeenCalled();
    });

    test('rejects a box that also holds an item that is not on the Pick List', async () => {
        inventoryRepository.lockInventoryRowsForBox.mockResolvedValue([invRow(), invRow({ InventoryID: 12, ItemCode: 'OTHER', Quantity: 3 })]);
        await expect(service.savePickTransactionAsync(REQUEST, USER)).rejects.toMatchObject({ code: 'BOX_HAS_UNLISTED_ITEMS' });
        expect(inventoryRepository.deductInventoryQty).not.toHaveBeenCalled();
    });

    test('rejects a box whose items are all fully picked already', async () => {
        pickingRepository.lockPickListDetails.mockResolvedValue([detail({ RequestedQty: 10, PickedQty: 25, RemainingQty: 0, Status: 'PICKED' })]);
        await expect(service.savePickTransactionAsync(REQUEST, USER)).rejects.toMatchObject({ code: 'BOX_NOT_APPLICABLE' });
    });

    test('rejects a completed Pick List', async () => {
        pickingRepository.lockPickListById.mockResolvedValue(header({ Status: 'COMPLETED' }));
        await expect(service.savePickTransactionAsync(REQUEST, USER)).rejects.toMatchObject({ code: 'PICKLIST_CLOSED' });
    });

    test('rejects a detail id from another Pick List', async () => {
        await expect(service.savePickTransactionAsync({ ...REQUEST, pickListDetailId: 4242 }, USER)).rejects.toMatchObject({ code: 'ITEM_NOT_IN_PICKLIST' });
    });

    test('rejects a location that does not match the pallet', async () => {
        await expect(service.savePickTransactionAsync({ ...REQUEST, location: 'B09-09' }, USER)).rejects.toMatchObject({ code: 'LOCATION_MISMATCH' });
    });

    test('rejects stock from another warehouse', async () => {
        inventoryRepository.lockInventoryRowsForBox.mockResolvedValue([invRow({ WarehouseCode: 'OTHER' })]);
        await expect(service.savePickTransactionAsync(REQUEST, USER)).rejects.toMatchObject({ code: 'WAREHOUSE_MISMATCH' });
    });

    test('rejects a box with quantity allocated elsewhere', async () => {
        inventoryRepository.lockInventoryRowsForBox.mockResolvedValue([invRow({ Quantity: 25, AllocatedQty: 5 })]);
        await expect(service.savePickTransactionAsync(REQUEST, USER)).rejects.toMatchObject({ code: 'BOX_PARTIALLY_ALLOCATED' });
    });

    test('rejects a box that is on another pallet', async () => {
        inventoryRepository.lockInventoryRowsForBox.mockResolvedValue([]);
        inventoryRepository.boxExistsInInventory.mockResolvedValue(true);
        await expect(service.savePickTransactionAsync(REQUEST, USER)).rejects.toMatchObject({ code: 'BOX_NOT_IN_PALLET' });
    });

    test('a repeated clientRequestId returns the original full box pick without writing again', async () => {
        pickingRepository.findPickTransactionsByClientRequestId.mockResolvedValue([
            { PickTransactionID: 9001, PickListID: 100, PickListDetailID: 1001, ItemCode: 'FG0001', PalletNumber: 'PAL001', BoxNumber: 'BOX001',
              AvailableQty: 25, PickQty: 10, RequestedQty: 10, PickedQty: 10, RemainingQty: 0 },
            { PickTransactionID: 9002, PickListID: 100, PickListDetailID: 1002, ItemCode: 'FG0001', PalletNumber: 'PAL001', BoxNumber: 'BOX001',
              AvailableQty: 25, PickQty: 15, RequestedQty: 8, PickedQty: 15, RemainingQty: 0 }
        ]);
        const result = await service.savePickTransactionAsync(REQUEST, USER);
        expect(result).toMatchObject({ duplicate: true, pickTransactionId: 9001, boxQty: 25, boxNumber: 'BOX001' });
        expect(result.lines).toHaveLength(2);
        expect(pickingRepository.lockPickListById).not.toHaveBeenCalled();
    });
});

describe('completePickListAsync', () => {
    const PICKED = detail({ PickedQty: 20, RemainingQty: 0, Status: 'PICKED' });

    beforeEach(() => {
        pickingRepository.lockPickListById.mockResolvedValue(header({ Status: 'PICKED' }));
        pickingRepository.lockPickListDetails.mockResolvedValue([PICKED]);
        pickingRepository.getPickTransactions.mockResolvedValue([
            { PickListDetailID: 1001, PickQty: 5 }, { PickListDetailID: 1001, PickQty: 15 }
        ]);
        pickingRepository.beginCompletion.mockResolvedValue();
        pickingRepository.insertProcessLog.mockResolvedValue();
        pickingRepository.recordPickListError.mockResolvedValue();
        pickingRepository.releaseProcessingLease.mockResolvedValue();
        dcService.generateDCFromPickList.mockResolvedValue({ dcId: 1, dcNumber: 'DC000123', created: true });
        sapStockTransferService.postStockTransferForPickList.mockResolvedValue({ docEntry: 456, docNum: 10456, created: true });
        pickingRepository.findPickListById.mockResolvedValue(header({
            Status: 'COMPLETED', DCNumber: 'DC000123', StockTransferDocEntry: 456, StockTransferNumber: '10456'
        }));
    });

    test('rejects while quantity remains', async () => {
        pickingRepository.lockPickListDetails.mockResolvedValue([detail()]);
        await expect(service.completePickListAsync(100, USER)).rejects.toMatchObject({ code: 'PICKING_INCOMPLETE' });
        expect(dcService.generateDCFromPickList).not.toHaveBeenCalled();
    });

    test('completes with full box excess: picked 25 for required 20 is valid, totals report the excess', async () => {
        pickingRepository.lockPickListDetails.mockResolvedValue([detail({ RequestedQty: 20, PickedQty: 25, RemainingQty: 0, Status: 'PICKED' })]);
        pickingRepository.getPickTransactions.mockResolvedValue([{ PickListDetailID: 1001, PickQty: 25 }]);
        dcService.generateDCFromPickList.mockResolvedValue({ dcId: 1, dcNumber: 'DC000123', totalQty: 25, created: true });

        const result = await service.completePickListAsync(100, USER);

        expect(result).toMatchObject({ requiredQty: 20, pickedQty: 25, excessQty: 5, dcQty: 25 });
        expect(pickingRepository.insertProcessLog).toHaveBeenCalledWith(expect.objectContaining({
            stage: 'VALIDATION', result: 'SUCCESS', message: expect.stringContaining('excess 5')
        }));
    });

    test('rejects when pick transactions do not add up to the picked quantity', async () => {
        pickingRepository.getPickTransactions.mockResolvedValue([{ PickListDetailID: 1001, PickQty: 5 }]);
        await expect(service.completePickListAsync(100, USER)).rejects.toMatchObject({ code: 'PICK_AUDIT_MISMATCH' });
    });

    test('rejects while another request holds the processing lease', async () => {
        pickingRepository.lockPickListById.mockResolvedValue(header({ Status: 'PICKED', ProcessingToken: 'X', ProcessingAgeSeconds: 10 }));
        await expect(service.completePickListAsync(100, USER)).rejects.toMatchObject({ code: 'PICKLIST_PROCESSING' });
    });

    test('an already completed Pick List returns its references and generates nothing', async () => {
        pickingRepository.lockPickListById.mockResolvedValue(header({
            Status: 'COMPLETED', DCNumber: 'DC000123', StockTransferDocEntry: 456, StockTransferNumber: '10456'
        }));
        const result = await service.completePickListAsync(100, USER);
        expect(result).toMatchObject({ alreadyCompleted: true, dcNumber: 'DC000123', stockTransferNumber: '10456' });
        expect(dcService.generateDCFromPickList).not.toHaveBeenCalled();
        expect(sapStockTransferService.postStockTransferForPickList).not.toHaveBeenCalled();
    });

    test('completes: DC then SAP Stock Transfer', async () => {
        const result = await service.completePickListAsync(100, USER);
        expect(pickingRepository.beginCompletion).toHaveBeenCalled();
        expect(dcService.generateDCFromPickList).toHaveBeenCalledWith(100, { user: 'operator1' });
        expect(sapStockTransferService.postStockTransferForPickList).toHaveBeenCalledWith(100, expect.objectContaining({ user: 'operator1' }));
        expect(result).toMatchObject({ status: 'COMPLETED', dcNumber: 'DC000123', stockTransferDocEntry: 456, stockTransferNumber: '10456' });
    });

    test('DC failure records the error, releases the lease and does not post to SAP', async () => {
        dcService.generateDCFromPickList.mockRejectedValue(new Error('db down'));
        await expect(service.completePickListAsync(100, USER)).rejects.toMatchObject({ code: 'DC_GENERATION_FAILED' });
        expect(pickingRepository.recordPickListError).toHaveBeenCalledWith(100, expect.objectContaining({ stage: 'DC' }));
        expect(pickingRepository.releaseProcessingLease).toHaveBeenCalled();
        expect(sapStockTransferService.postStockTransferForPickList).not.toHaveBeenCalled();
    });

    test('SAP failure records the error and releases the lease for a retry', async () => {
        sapStockTransferService.postStockTransferForPickList.mockRejectedValue(new Error('timeout'));
        await expect(service.completePickListAsync(100, USER)).rejects.toMatchObject({ code: 'SAP_STOCK_TRANSFER_FAILED' });
        expect(pickingRepository.recordPickListError).toHaveBeenCalledWith(100, expect.objectContaining({ stage: 'SAP' }));
        expect(pickingRepository.releaseProcessingLease).toHaveBeenCalled();
    });
});
