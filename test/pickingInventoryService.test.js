jest.mock('../config/database', () => ({ sequelize: {} }));
jest.mock('../repository/palletMappingRepository');
jest.mock('../repository/inventoryRepository');
jest.mock('../repository/pickingRepository');

const palletMappingRepository = require('../repository/palletMappingRepository');
const inventoryRepository = require('../repository/inventoryRepository');
const pickingRepository = require('../repository/pickingRepository');
const service = require('../service/pickingInventoryService');

const HEADER = { PickListID: 100, PickListNumber: 'PL000100', Status: 'OPEN', FromWarehouse: 'INTRTHDL', ToWarehouse: 'INTRATTM' };
const DETAILS = [
    { PickListDetailID: 1, SourceDocEntry: 1001, SourceDocNum: 50001, SourceLineNum: 0, ItemCode: 'FG0001', ItemName: 'Finished Good 1', RequestedQty: 20, PickedQty: 5, RemainingQty: 15, FromWarehouse: 'INTRTHDL', ToWarehouse: 'INTRATTM', Status: 'PARTIAL' },
    { PickListDetailID: 2, SourceDocEntry: 1002, SourceDocNum: 50002, SourceLineNum: 0, ItemCode: 'FG0001', ItemName: 'Finished Good 1', RequestedQty: 10, PickedQty: 0, RemainingQty: 10, FromWarehouse: 'INTRTHDL', ToWarehouse: 'INTRATTM', Status: 'OPEN' }
];
const MAPPING = { PalletMappingID: 1, PalletID: 'PAL001', Status: 'COMPLETED', PickingStatus: null };

function inv(overrides = {}) {
    return {
        InventoryID: 10, WarehouseCode: 'INTRTHDL', LocationID: 5, LocationCode: 'A01-01', PalletMappingID: 1, PalletID: 'PAL001',
        BoxNumber: 'BOX001', ItemCode: 'FG0001', Quantity: 10, AllocatedQty: 0, Status: 'AVAILABLE', PalletMappingBoxID: 77,
        ...overrides
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    pickingRepository.findPickListById.mockResolvedValue(HEADER);
    pickingRepository.getPickListDetails.mockResolvedValue(DETAILS);
    palletMappingRepository.findMappingByPalletId.mockResolvedValue(MAPPING);
});

describe('getPickListInventoryAsync', () => {
    test('returns required/picked/remaining with real stock per line and an item roll-up', async () => {
        inventoryRepository.getPickableInventoryForItems.mockResolvedValue([
            inv(), inv({ InventoryID: 11, BoxNumber: 'BOX002', Quantity: 8 })
        ]);
        const result = await service.getPickListInventoryAsync(100);

        expect(inventoryRepository.getPickableInventoryForItems).toHaveBeenCalledWith({ warehouseCode: 'INTRTHDL', itemCodes: ['FG0001'] });
        expect(result.items[0]).toMatchObject({ itemCode: 'FG0001', requiredQty: 20, pickedQty: 5, remainingQty: 15, totalAvailableQty: 18 });
        expect(result.items[0].inventory[0]).toEqual(expect.objectContaining({
            warehouse: 'INTRTHDL', location: 'A01-01', palletNumber: 'PAL001', boxNumber: 'BOX001', availableQty: 10
        }));
        expect(result.itemSummary).toEqual([expect.objectContaining({ itemCode: 'FG0001', remainingQty: 25, availableQty: 18, shortageQty: 7 })]);
    });

    test('404 for an unknown Pick List', async () => {
        pickingRepository.findPickListById.mockResolvedValue(null);
        await expect(service.getPickListInventoryAsync(999)).rejects.toMatchObject({ code: 'PICKLIST_NOT_FOUND' });
    });
});

describe('scanPalletForPickListAsync', () => {
    test('rejects a pallet without any Pick List item', async () => {
        inventoryRepository.getAvailableInventoryByPallet.mockResolvedValue([inv({ ItemCode: 'OTHER' })]);
        await expect(service.scanPalletForPickListAsync({ pickListId: 100, palletNumber: 'PAL001' }))
            .rejects.toMatchObject({ code: 'PALLET_NOT_APPLICABLE' });
    });

    test('rejects a closed Pick List', async () => {
        pickingRepository.findPickListById.mockResolvedValue({ ...HEADER, Status: 'COMPLETED' });
        await expect(service.scanPalletForPickListAsync({ pickListId: 100, palletNumber: 'PAL001' }))
            .rejects.toMatchObject({ code: 'PICKLIST_CLOSED' });
    });

    test('returns only applicable lines with their Pick List lines and a suggested qty', async () => {
        inventoryRepository.getAvailableInventoryByPallet.mockResolvedValue([inv(), inv({ InventoryID: 12, ItemCode: 'OTHER' })]);
        const result = await service.scanPalletForPickListAsync({ pickListId: 100, palletNumber: 'PAL001' });
        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toMatchObject({ itemCode: 'FG0001', locationCode: 'A01-01', suggestedPickQty: 10, remainingRequiredQty: 25 });
        expect(result.items[0].pickListLines.map(l => l.pickListDetailId)).toEqual([1, 2]);
        expect(result.locations).toEqual(['A01-01']);
    });
});

describe('scanBoxForPickListAsync', () => {
    test('BOX_NOT_IN_PALLET when the box sits on another pallet', async () => {
        inventoryRepository.getInventoryByPalletAndBox.mockResolvedValue([]);
        inventoryRepository.boxExistsInInventory.mockResolvedValue(true);
        await expect(service.scanBoxForPickListAsync({ pickListId: 100, palletNumber: 'PAL001', boxNumber: 'BOX009' }))
            .rejects.toMatchObject({ code: 'BOX_NOT_IN_PALLET' });
    });

    test('BOX_NOT_APPLICABLE when the box holds no required item', async () => {
        inventoryRepository.getInventoryByPalletAndBox.mockResolvedValue([inv({ ItemCode: 'OTHER' })]);
        await expect(service.scanBoxForPickListAsync({ pickListId: 100, palletNumber: 'PAL001', boxNumber: 'BOX001' }))
            .rejects.toMatchObject({ code: 'BOX_NOT_APPLICABLE' });
    });

    test('INSUFFICIENT_STOCK when the required item is already cleared from the box', async () => {
        inventoryRepository.getInventoryByPalletAndBox.mockResolvedValue([inv({ Quantity: 0, Status: 'CLEARED' })]);
        await expect(service.scanBoxForPickListAsync({ pickListId: 100, palletNumber: 'PAL001', boxNumber: 'BOX001' }))
            .rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    });

    test('returns the item and its available quantity', async () => {
        inventoryRepository.getInventoryByPalletAndBox.mockResolvedValue([inv()]);
        palletMappingRepository.findMappingBoxByBoxNumber.mockResolvedValue({ PalletMappingBoxID: 77, PalletMappingID: 1 });
        const result = await service.scanBoxForPickListAsync({ pickListId: 100, palletNumber: 'PAL001', boxNumber: 'BOX001' });
        expect(result).toMatchObject({ boxId: 77, boxNumber: 'BOX001' });
        expect(result.items[0]).toMatchObject({ itemCode: 'FG0001', pickableQty: 10 });
    });
});
