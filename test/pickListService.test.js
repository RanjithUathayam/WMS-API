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
});

describe('savePickTransactionAsync', () => {
    const REQUEST = {
        pickListId: 100, pickListDetailId: 1001, itemCode: 'FG0001',
        palletNumber: 'PAL001', boxNumber: 'BOX001', location: 'A01-01', pickQty: 10
    };

    beforeEach(() => {
        pickingRepository.lockPickListById.mockResolvedValue(header());
        pickingRepository.lockPickListDetail.mockResolvedValue(detail());
        palletMappingRepository.lockLatestMappingByPalletId.mockResolvedValue({ PalletMappingID: 1, PalletID: 'PAL001', Status: 'COMPLETED', PickingStatus: null });
        inventoryRepository.lockInventoryRow.mockResolvedValue(invRow());
        pickingRepository.applyPickToDetail.mockResolvedValue({ PickListDetailID: 1001, RequestedQty: 20, PickedQty: 15, RemainingQty: 5, Status: 'PARTIAL' });
        inventoryRepository.deductInventoryQty.mockResolvedValue();
        pickingRepository.insertPickingHistory.mockResolvedValue({ PickingID: 555 });
        palletMappingRepository.findMappingBoxByBoxNumber.mockResolvedValue({ PalletMappingBoxID: 77, PalletMappingID: 1 });
        pickingRepository.insertPickTransaction.mockResolvedValue({ PickTransactionID: 9001 });
        pickingRepository.refreshPickListProgress.mockResolvedValue({ Status: 'IN_PROGRESS' });
        inventoryRepository.countAvailableInventoryForPallet.mockResolvedValue(0);
        pickingRepository.updatePalletPickingStatus.mockResolvedValue();
    });

    test('rejects missing location', async () => {
        await expect(service.savePickTransactionAsync({ ...REQUEST, location: '' }, USER)).rejects.toMatchObject({ code: 'MISSING_FIELDS' });
    });

    test('rejects a non-positive pickQty', async () => {
        await expect(service.savePickTransactionAsync({ ...REQUEST, pickQty: 0 }, USER)).rejects.toMatchObject({ code: 'INVALID_PICK_QTY' });
    });

    test('rejects a completed Pick List', async () => {
        pickingRepository.lockPickListById.mockResolvedValue(header({ Status: 'COMPLETED' }));
        await expect(service.savePickTransactionAsync(REQUEST, USER)).rejects.toMatchObject({ code: 'PICKLIST_CLOSED' });
    });

    test('rejects a detail from another Pick List', async () => {
        pickingRepository.lockPickListDetail.mockResolvedValue(detail({ PickListID: 999 }));
        await expect(service.savePickTransactionAsync(REQUEST, USER)).rejects.toMatchObject({ code: 'ITEM_NOT_IN_PICKLIST' });
    });

    test('rejects an item that does not match the line', async () => {
        await expect(service.savePickTransactionAsync({ ...REQUEST, itemCode: 'FG0002' }, USER)).rejects.toMatchObject({ code: 'ITEM_NOT_IN_PICKLIST' });
    });

    test('rejects a pick above the remaining required quantity', async () => {
        await expect(service.savePickTransactionAsync({ ...REQUEST, pickQty: 16 }, USER)).rejects.toMatchObject({ code: 'PICK_QTY_EXCEEDS_REMAINING' });
    });

    test('rejects a location that does not match the pallet', async () => {
        await expect(service.savePickTransactionAsync({ ...REQUEST, location: 'B09-09' }, USER)).rejects.toMatchObject({ code: 'LOCATION_MISMATCH' });
    });

    test('rejects stock from another warehouse', async () => {
        inventoryRepository.lockInventoryRow.mockResolvedValue(invRow({ WarehouseCode: 'OTHER' }));
        await expect(service.savePickTransactionAsync(REQUEST, USER)).rejects.toMatchObject({ code: 'WAREHOUSE_MISMATCH' });
    });

    test('rejects when the server-side available quantity is lower than pickQty', async () => {
        inventoryRepository.lockInventoryRow.mockResolvedValue(invRow({ Quantity: 6 }));
        await expect(service.savePickTransactionAsync(REQUEST, USER)).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
        expect(inventoryRepository.deductInventoryQty).not.toHaveBeenCalled();
        expect(pickingRepository.insertPickTransaction).not.toHaveBeenCalled();
    });

    test('rejects a box that is on another pallet', async () => {
        inventoryRepository.lockInventoryRow.mockResolvedValue(null);
        inventoryRepository.getInventoryByPalletAndBox.mockResolvedValue([]);
        inventoryRepository.boxExistsInInventory.mockResolvedValue(true);
        await expect(service.savePickTransactionAsync(REQUEST, USER)).rejects.toMatchObject({ code: 'BOX_NOT_IN_PALLET' });
    });

    test('saves the transaction, updates the line, reduces inventory and keeps the source refs', async () => {
        const result = await service.savePickTransactionAsync(REQUEST, USER);

        expect(pickingRepository.applyPickToDetail).toHaveBeenCalledWith(expect.anything(), 1001, 10);
        expect(inventoryRepository.deductInventoryQty).toHaveBeenCalledWith(expect.anything(), 10, { remainingQty: 0, updatedBy: 'operator1' });
        expect(pickingRepository.insertPickTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            pickListId: 100, pickListDetailId: 1001, sourceDocEntry: 1001, sourceDocNum: 50001, sourceLineNum: 0,
            warehouse: 'INTRTHDL', location: 'A01-01', palletNumber: 'PAL001', boxId: 77, boxNumber: 'BOX001',
            availableQty: 10, pickQty: 10, pickingHistoryId: 555
        }));
        expect(pickingRepository.updatePalletPickingStatus).toHaveBeenCalledWith(expect.anything(), 1, 'COMPLETED');
        expect(result).toMatchObject({ pickListId: 100, itemCode: 'FG0001', pickQty: 10, remainingQty: 5, duplicate: false });
    });

    test('a repeated clientRequestId returns the original pick without writing again', async () => {
        pickingRepository.findPickTransactionByClientRequestId.mockResolvedValue({
            PickTransactionID: 9001, PickListID: 100, PickListDetailID: 1001, ItemCode: 'FG0001', PickQty: 10, RemainingQty: 5
        });
        const result = await service.savePickTransactionAsync({ ...REQUEST, clientRequestId: 'hht-1' }, USER);
        expect(result).toMatchObject({ duplicate: true, pickTransactionId: 9001 });
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
