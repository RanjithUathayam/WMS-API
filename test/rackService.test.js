jest.mock('../config/database', () => ({
    sequelize: { transaction: jest.fn(fn => fn({})) }
}));
jest.mock('../repository/rackRepository');
jest.mock('../repository/locationRepository');
jest.mock('../repository/preBinningRepository');

const repository = require('../repository/rackRepository');
const locationRepository = require('../repository/locationRepository');
const service = require('../service/rackService');

const RACK = { LocationID: 5, WarehouseCode: 'WH1', RowCode: 'A', PositionNo: 5, LocationCode: 'WH1-A-005', Status: 'AVAILABLE' };
const OTHER_RACK = { ...RACK, LocationID: 6, LocationCode: 'WH1-A-006' };
const ITEM = { ItemCode: 'ITM-1', ItemName: 'Widget', ItemGroup: 'GRP' };
const TAG_QR = 'ITM-1|T1|GRN1|GRP|0001|2';
const TAG_QR_2 = 'ITM-1|T1|GRN1|GRP|0002|3';

beforeEach(() => {
    jest.clearAllMocks();
    repository.findRackByCode.mockResolvedValue(RACK);
    repository.findItem.mockResolvedValue(ITEM);
    repository.findRackStockRow.mockResolvedValue(null);
    repository.findTag.mockResolvedValue(null);
    repository.getRackStock.mockResolvedValue([]);
    repository.findTransactionByClientRequestId.mockResolvedValue(null);
    locationRepository.lockLocationByCode.mockResolvedValue(RACK);
    repository.lockRackStockRow.mockResolvedValue(null);
    repository.lockTag.mockResolvedValue(null);
    repository.insertRackStockRow.mockImplementation(async (tx, r) => ({ RackInventoryID: 77, Quantity: r.quantity }));
    repository.insertTransaction.mockImplementation(async (tx, h) => ({
        RackTransactionID: 900, TransactionNo: h.transactionType === 'STORE' ? 'RS00000900' : 'RP00000900',
        TransactionType: h.transactionType, LocationID: h.locationId, LocationCode: h.locationCode,
        WarehouseCode: h.warehouseCode, RowCode: h.rowCode, TotalLines: h.totalLines, TotalQty: h.totalQty,
        CreatedBy: h.createdBy, CreatedAt: '2026-10-21T10:00:00Z'
    }));
});

describe('parseItemScan', () => {
    test('parses a pre-binning label as a tagged line with the QR quantity', () => {
        expect(service.parseItemScan(TAG_QR)).toMatchObject({
            itemCode: 'ITM-1', grnNo: 'GRN1', uniqueNumber: '0001', itemGroup: 'GRP', qty: 2, tagged: true
        });
    });

    test('treats a bare item code as untagged with no quantity', () => {
        expect(service.parseItemScan('  ITM-1 ')).toMatchObject({ itemCode: 'ITM-1', tagged: false, qty: null });
    });

    test('rejects a malformed label', () => {
        expect(() => service.parseItemScan('ITM-1|T1|GRN1')).toThrow(expect.objectContaining({ code: 'INVALID_ITEM_QR' }));
    });

    test('rejects a label with a non-positive quantity', () => {
        expect(() => service.parseItemScan('ITM-1|T1|GRN1|GRP|0001|0')).toThrow(expect.objectContaining({ code: 'INVALID_ITEM_QR' }));
    });
});

describe('scanRackAsync', () => {
    test('requires a warehouse', async () => {
        await expect(service.scanRackAsync({ mode: 'STORE', rackCode: 'WH1-A-005' })).rejects.toMatchObject({ code: 'WAREHOUSE_REQUIRED' });
    });

    test('rejects a rack from another warehouse', async () => {
        await expect(service.scanRackAsync({ whsCode: 'WH2', mode: 'STORE', rackCode: 'WH1-A-005' }))
            .rejects.toMatchObject({ code: 'WAREHOUSE_MISMATCH' });
    });

    test('matches the warehouse case-insensitively', async () => {
        await expect(service.scanRackAsync({ whsCode: 'wh1', mode: 'STORE', rackCode: 'WH1-A-005' })).resolves.toBeTruthy();
    });

    test('rejects an invalid mode', async () => {
        await expect(service.scanRackAsync({ whsCode: 'WH1', mode: 'MOVE', rackCode: 'WH1-A-005' })).rejects.toMatchObject({ code: 'INVALID_MODE' });
    });

    test('rejects an unknown rack', async () => {
        repository.findRackByCode.mockResolvedValue(null);
        await expect(service.scanRackAsync({ whsCode: 'WH1', mode: 'STORE', rackCode: 'NOPE' })).rejects.toMatchObject({ code: 'RACK_NOT_FOUND' });
    });

    test('rejects an inactive or blocked rack', async () => {
        repository.findRackByCode.mockResolvedValue({ ...RACK, Status: 'INACTIVE' });
        await expect(service.scanRackAsync({ whsCode: 'WH1', mode: 'STORE', rackCode: 'WH1-A-005' })).rejects.toMatchObject({ code: 'RACK_INACTIVE' });
        repository.findRackByCode.mockResolvedValue({ ...RACK, Status: 'BLOCKED' });
        await expect(service.scanRackAsync({ whsCode: 'WH1', mode: 'STORE', rackCode: 'WH1-A-005' })).rejects.toMatchObject({ code: 'RACK_BLOCKED' });
    });

    test('allows storing into an empty rack (and a pallet-occupied one)', async () => {
        repository.findRackByCode.mockResolvedValue({ ...RACK, Status: 'OCCUPIED' });
        const result = await service.scanRackAsync({ whsCode: 'WH1', mode: 'STORE', rackCode: 'WH1-A-005' });
        expect(result).toMatchObject({ mode: 'STORE', rack: { rackCode: 'WH1-A-005' }, stock: [], totalQty: 0 });
    });

    test('rejects picking from an empty rack', async () => {
        await expect(service.scanRackAsync({ whsCode: 'WH1', mode: 'pick', rackCode: 'WH1-A-005' })).rejects.toMatchObject({ code: 'RACK_EMPTY' });
    });

    test('returns current rack stock', async () => {
        repository.getRackStock.mockResolvedValue([{ RackInventoryID: 1, ItemCode: 'ITM-1', ItemName: 'Widget', Quantity: '4.000' }]);
        const result = await service.scanRackAsync({ whsCode: 'WH1', mode: 'PICK', rackCode: 'WH1-A-005' });
        expect(result.stock).toEqual([expect.objectContaining({ itemCode: 'ITM-1', quantity: 4 })]);
        expect(result.totalQty).toBe(4);
    });
});

describe('scanItemAsync', () => {
    test('rejects an item missing from the item master', async () => {
        repository.findItem.mockResolvedValue(null);
        await expect(service.scanItemAsync({ whsCode: 'WH1', mode: 'STORE', rackCode: 'WH1-A-005', itemQr: 'XX' })).rejects.toMatchObject({ code: 'ITEM_NOT_FOUND' });
    });

    test('store: returns the tagged line with the rack quantity', async () => {
        repository.findRackStockRow.mockResolvedValue({ RackInventoryID: 1, Quantity: 3 });
        const result = await service.scanItemAsync({ whsCode: 'WH1', mode: 'STORE', rackCode: 'WH1-A-005', itemQr: TAG_QR });
        expect(result.item).toMatchObject({ itemCode: 'ITM-1', itemName: 'Widget', qty: 2, availableQty: 3, tagged: true, itemQr: TAG_QR });
    });

    test('store: untagged item defaults to qty 1', async () => {
        const result = await service.scanItemAsync({ whsCode: 'WH1', mode: 'STORE', rackCode: 'WH1-A-005', itemQr: 'ITM-1' });
        expect(result.item).toMatchObject({ qty: 1, tagged: false, itemQr: null });
    });

    test('store: rejects a label already stored in a rack', async () => {
        repository.findTag.mockResolvedValue({ Status: 'STORED', LocationID: 6, LocationCode: 'WH1-A-006' });
        await expect(service.scanItemAsync({ whsCode: 'WH1', mode: 'STORE', rackCode: 'WH1-A-005', itemQr: TAG_QR }))
            .rejects.toMatchObject({ code: 'TAG_ALREADY_STORED' });
    });

    test('store: a previously picked label can be stored again', async () => {
        repository.findTag.mockResolvedValue({ Status: 'PICKED', LocationID: 6, LocationCode: 'WH1-A-006' });
        await expect(service.scanItemAsync({ whsCode: 'WH1', mode: 'STORE', rackCode: 'WH1-A-005', itemQr: TAG_QR })).resolves.toBeTruthy();
    });

    test('pick: rejects an item the rack does not hold', async () => {
        await expect(service.scanItemAsync({ whsCode: 'WH1', mode: 'PICK', rackCode: 'WH1-A-005', itemQr: 'ITM-1' }))
            .rejects.toMatchObject({ code: 'ITEM_NOT_IN_RACK' });
    });

    test('pick: rejects a label stored in a different rack', async () => {
        repository.findRackStockRow.mockResolvedValue({ RackInventoryID: 1, Quantity: 10 });
        repository.findTag.mockResolvedValue({ Status: 'STORED', LocationID: 6, LocationCode: 'WH1-A-006' });
        await expect(service.scanItemAsync({ whsCode: 'WH1', mode: 'PICK', rackCode: 'WH1-A-005', itemQr: TAG_QR }))
            .rejects.toMatchObject({ code: 'ITEM_NOT_IN_RACK' });
    });

    test('pick: rejects a label already picked', async () => {
        repository.findRackStockRow.mockResolvedValue({ RackInventoryID: 1, Quantity: 10 });
        repository.findTag.mockResolvedValue({ Status: 'PICKED', LocationID: 5, LocationCode: 'WH1-A-005' });
        await expect(service.scanItemAsync({ whsCode: 'WH1', mode: 'PICK', rackCode: 'WH1-A-005', itemQr: TAG_QR }))
            .rejects.toMatchObject({ code: 'TAG_ALREADY_PICKED' });
    });

    test('pick: counts quantity already in the unsaved list against rack stock', async () => {
        repository.findRackStockRow.mockResolvedValue({ RackInventoryID: 1, Quantity: 3 });
        await expect(service.scanItemAsync({ whsCode: 'WH1', mode: 'PICK', rackCode: 'WH1-A-005', itemQr: TAG_QR, scannedQty: 2 }))
            .rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK', data: { availableQty: 3, requestedQty: 4 } });
        await expect(service.scanItemAsync({ whsCode: 'WH1', mode: 'PICK', rackCode: 'WH1-A-005', itemQr: TAG_QR, scannedQty: 1 }))
            .resolves.toMatchObject({ item: { qty: 2, availableQty: 3 } });
    });
});

describe('saveAsync — validation', () => {
    test('rejects an empty item list', async () => {
        await expect(service.saveAsync({ whsCode: 'WH1', mode: 'STORE', rackCode: 'WH1-A-005', items: [] }, { UserName: 'op' }))
            .rejects.toMatchObject({ code: 'MISSING_FIELDS' });
    });

    test('rejects the same label scanned twice', async () => {
        await expect(service.saveAsync({ whsCode: 'WH1', mode: 'STORE', rackCode: 'WH1-A-005', items: [{ itemQr: TAG_QR }, { itemQr: TAG_QR }] }, { UserName: 'op' }))
            .rejects.toMatchObject({ code: 'DUPLICATE_SCAN' });
    });

    test('rejects a non-positive or over-precise untagged quantity', async () => {
        await expect(service.saveAsync({ whsCode: 'WH1', mode: 'STORE', rackCode: 'WH1-A-005', items: [{ itemCode: 'ITM-1', qty: 0 }] }, {}))
            .rejects.toMatchObject({ code: 'INVALID_QTY' });
        await expect(service.saveAsync({ whsCode: 'WH1', mode: 'STORE', rackCode: 'WH1-A-005', items: [{ itemCode: 'ITM-1', qty: 1.2345 }] }, {}))
            .rejects.toMatchObject({ code: 'INVALID_QTY' });
    });

    test('returns the original transaction for a repeated clientRequestId without touching inventory', async () => {
        repository.findTransactionByClientRequestId.mockResolvedValue({
            RackTransactionID: 900, TransactionNo: 'RS00000900', TransactionType: 'STORE', LocationCode: 'WH1-A-005', TotalLines: 1, TotalQty: 2
        });
        repository.getTransactionDetails.mockResolvedValue([{ LineNum: 1, ItemCode: 'ITM-1', Qty: 2, QtyBefore: 0, QtyAfter: 2 }]);

        const result = await service.saveAsync({ whsCode: 'WH1', mode: 'STORE', rackCode: 'WH1-A-005', clientRequestId: 'abc', items: [{ itemQr: TAG_QR }] }, { UserName: 'op' });

        expect(result).toMatchObject({ duplicate: true, transactionNo: 'RS00000900' });
        expect(locationRepository.lockLocationByCode).not.toHaveBeenCalled();
        expect(repository.setRackStockQty).not.toHaveBeenCalled();
    });

    test('a concurrent duplicate Save (unique-index race) also resolves to the original transaction', async () => {
        const dupError = new Error('dup');
        dupError.isDuplicateClientRequest = true;
        repository.insertTransaction.mockRejectedValue(dupError);
        repository.findTransactionByClientRequestId
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ RackTransactionID: 900, TransactionNo: 'RS00000900', TransactionType: 'STORE', TotalLines: 1, TotalQty: 2 });
        repository.getTransactionDetails.mockResolvedValue([]);

        const result = await service.saveAsync({ whsCode: 'WH1', mode: 'STORE', rackCode: 'WH1-A-005', clientRequestId: 'abc', items: [{ itemQr: TAG_QR }] }, {});
        expect(result).toMatchObject({ duplicate: true });
    });
});

describe('getWarehousesAsync', () => {
    test('maps warehouses that have racks', async () => {
        repository.getRackWarehouses.mockResolvedValue([{ whsCode: 'WH1', whsName: 'Main', rackCount: 12 }, { whsCode: 'WH9', whsName: null, rackCount: 1 }]);
        await expect(service.getWarehousesAsync()).resolves.toEqual([
            { warehouseCode: 'WH1', warehouseName: 'Main', rackCount: 12 },
            { warehouseCode: 'WH9', warehouseName: 'WH9', rackCount: 1 }
        ]);
    });
});

describe('saveAsync — store', () => {
    test('rejects a save whose rack is not in the selected warehouse', async () => {
        await expect(service.saveAsync({ whsCode: 'WH2', mode: 'STORE', rackCode: 'WH1-A-005', items: [{ itemQr: TAG_QR }] }, {}))
            .rejects.toMatchObject({ code: 'WAREHOUSE_MISMATCH' });
        expect(repository.insertTransaction).not.toHaveBeenCalled();
    });

    test('rejects a save without a warehouse', async () => {
        await expect(service.saveAsync({ mode: 'STORE', rackCode: 'WH1-A-005', items: [{ itemQr: TAG_QR }] }, {}))
            .rejects.toMatchObject({ code: 'WAREHOUSE_REQUIRED' });
    });

    test('creates the stock row, writes header/details and marks labels STORED', async () => {
        const result = await service.saveAsync({
            whsCode: 'WH1', mode: 'STORE', rackCode: 'WH1-A-005', clientRequestId: 'r1', deviceId: 'HHT-1',
            items: [{ itemQr: TAG_QR }, { itemQr: TAG_QR_2 }]
        }, { UserName: 'op' });

        expect(repository.insertRackStockRow).toHaveBeenCalledWith({}, expect.objectContaining({ locationId: 5, itemCode: 'ITM-1', quantity: 5, createdBy: 'op' }));
        expect(repository.insertTransaction).toHaveBeenCalledWith({}, expect.objectContaining({
            transactionType: 'STORE', locationId: 5, totalLines: 2, totalQty: 5, clientRequestId: 'r1', deviceId: 'HHT-1', createdBy: 'op'
        }));
        expect(repository.upsertTag).toHaveBeenCalledTimes(2);
        expect(repository.upsertTag).toHaveBeenCalledWith({}, expect.objectContaining({ uniqueNumber: '0001', status: 'STORED', locationId: 5 }));
        expect(result.items.map(i => [i.qtyBefore, i.qtyAfter])).toEqual([[0, 2], [2, 5]]);
        expect(result).toMatchObject({ mode: 'STORE', transactionNo: 'RS00000900', totalQty: 5, duplicate: false });
    });

    test('adds to an existing stock row', async () => {
        repository.lockRackStockRow.mockResolvedValue({ RackInventoryID: 11, Quantity: '10.000' });
        await service.saveAsync({ whsCode: 'WH1', mode: 'STORE', rackCode: 'WH1-A-005', items: [{ itemCode: 'ITM-1', qty: 2.5 }] }, { UserName: 'op' });
        expect(repository.setRackStockQty).toHaveBeenCalledWith({}, 11, expect.objectContaining({ quantity: 12.5 }));
        expect(repository.insertRackStockRow).not.toHaveBeenCalled();
    });

    test('rejects (and rolls back) when a label was stored by someone else in the meantime', async () => {
        repository.lockTag.mockResolvedValue({ Status: 'STORED', LocationID: 6, LocationCode: 'WH1-A-006' });
        await expect(service.saveAsync({ whsCode: 'WH1', mode: 'STORE', rackCode: 'WH1-A-005', items: [{ itemQr: TAG_QR }] }, {}))
            .rejects.toMatchObject({ code: 'TAG_ALREADY_STORED' });
        expect(repository.insertTransactionDetail).not.toHaveBeenCalled();
    });

    test('rejects a rack deactivated after it was scanned', async () => {
        locationRepository.lockLocationByCode.mockResolvedValue({ ...RACK, Status: 'INACTIVE' });
        await expect(service.saveAsync({ whsCode: 'WH1', mode: 'STORE', rackCode: 'WH1-A-005', items: [{ itemQr: TAG_QR }] }, {}))
            .rejects.toMatchObject({ code: 'RACK_INACTIVE' });
        expect(repository.insertTransaction).not.toHaveBeenCalled();
    });
});

describe('saveAsync — pick', () => {
    test('deducts stock and marks labels PICKED', async () => {
        repository.lockRackStockRow.mockResolvedValue({ RackInventoryID: 11, Quantity: 10 });
        repository.lockTag.mockResolvedValue({ Status: 'STORED', LocationID: 5, LocationCode: 'WH1-A-005' });

        const result = await service.saveAsync({ whsCode: 'WH1', mode: 'PICK', rackCode: 'WH1-A-005', items: [{ itemQr: TAG_QR }, { itemCode: 'ITM-1', qty: 1 }] }, { UserName: 'op' });

        expect(repository.setRackStockQty).toHaveBeenCalledWith({}, 11, expect.objectContaining({ quantity: 7 }));
        expect(repository.upsertTag).toHaveBeenCalledWith({}, expect.objectContaining({ status: 'PICKED' }));
        expect(result.items.map(i => [i.qtyBefore, i.qtyAfter])).toEqual([[10, 8], [8, 7]]);
        expect(result.transactionNo).toBe('RP00000900');
    });

    test('rejects picking more than the rack holds (aggregated across lines)', async () => {
        repository.lockRackStockRow.mockResolvedValue({ RackInventoryID: 11, Quantity: 2 });
        await expect(service.saveAsync({ whsCode: 'WH1', mode: 'PICK', rackCode: 'WH1-A-005', items: [{ itemCode: 'ITM-1', qty: 1 }, { itemCode: 'itm-1', qty: 2 }] }, {}))
            .rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK', data: { availableQty: 2, requestedQty: 3 } });
        expect(repository.setRackStockQty).not.toHaveBeenCalled();
    });

    test('rejects an item the rack does not hold', async () => {
        await expect(service.saveAsync({ whsCode: 'WH1', mode: 'PICK', rackCode: 'WH1-A-005', items: [{ itemCode: 'ITM-1', qty: 1 }] }, {}))
            .rejects.toMatchObject({ code: 'ITEM_NOT_IN_RACK' });
    });

    test('rejects a label that belongs to another rack', async () => {
        repository.lockRackStockRow.mockResolvedValue({ RackInventoryID: 11, Quantity: 10 });
        repository.lockTag.mockResolvedValue({ Status: 'STORED', LocationID: OTHER_RACK.LocationID, LocationCode: OTHER_RACK.LocationCode });
        await expect(service.saveAsync({ whsCode: 'WH1', mode: 'PICK', rackCode: 'WH1-A-005', items: [{ itemQr: TAG_QR }] }, {}))
            .rejects.toMatchObject({ code: 'ITEM_NOT_IN_RACK' });
    });
});

describe('history', () => {
    test('lists with paging defaults and normalized filters', async () => {
        repository.listTransactions.mockResolvedValue({ rows: [], total: 0 });
        const result = await service.listHistoryAsync({ whsCode: 'WH1', mode: 'store', fromDate: '2026-10-01' });
        expect(repository.listTransactions).toHaveBeenCalledWith(expect.objectContaining({ transactionType: 'STORE', warehouseCode: 'WH1', fromDate: '2026-10-01', offset: 0, limit: 50 }));
        expect(result).toMatchObject({ page: 1, pageSize: 50, total: 0 });
    });

    test('rejects a malformed date', async () => {
        await expect(service.listHistoryAsync({ fromDate: '21/10/2026' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    });

    test('returns 404 for an unknown transaction', async () => {
        repository.findTransactionById.mockResolvedValue(null);
        await expect(service.getHistoryAsync('5')).rejects.toMatchObject({ code: 'TRANSACTION_NOT_FOUND' });
    });
});
