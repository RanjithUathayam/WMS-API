jest.mock('../config/database', () => ({
    sequelize: { transaction: jest.fn(fn => fn({})) }
}));
jest.mock('../repository/palletMappingRepository');
jest.mock('../repository/inventoryRepository');
jest.mock('../repository/pickingRepository');

const palletMappingRepository = require('../repository/palletMappingRepository');
const inventoryRepository = require('../repository/inventoryRepository');
const pickingRepository = require('../repository/pickingRepository');
const service = require('../service/pickingService');
const { PickingError } = service;

const COMPLETED_MAPPING = {
    PalletMappingID: 1, PalletID: 'PLT-0001', Status: 'COMPLETED', PickingStatus: null
};

function inventoryRow(overrides = {}) {
    return {
        InventoryID: 10, WarehouseCode: 'WH1', RowCode: 'A', LocationID: 5, LocationCode: 'WH1-A-005',
        PalletMappingID: 1, PalletID: 'PLT-0001', BoxNumber: 'BOX-0001', ItemCode: 'ITM-1', ItemGroup: 'GRP',
        Quantity: 10, AllocatedQty: 0, Status: 'AVAILABLE', ItemName: 'Widget',
        ...overrides
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('scanPalletAsync', () => {
    test('rejects a blank palletNumber', async () => {
        await expect(service.scanPalletAsync({})).rejects.toMatchObject({ code: 'MISSING_FIELDS' });
    });

    test('rejects when the pallet has no mapping', async () => {
        palletMappingRepository.findMappingByPalletId.mockResolvedValue(null);
        await expect(service.scanPalletAsync({ palletNumber: 'PLT-0001' }))
            .rejects.toMatchObject({ code: 'PALLET_NOT_FOUND' });
    });

    test('rejects a pallet whose mapping is not yet COMPLETED', async () => {
        palletMappingRepository.findMappingByPalletId.mockResolvedValue({ ...COMPLETED_MAPPING, Status: 'OPEN' });
        await expect(service.scanPalletAsync({ palletNumber: 'PLT-0001' }))
            .rejects.toMatchObject({ code: 'PALLET_NOT_AVAILABLE' });
    });

    test('rejects a pallet already fully picked', async () => {
        palletMappingRepository.findMappingByPalletId.mockResolvedValue({ ...COMPLETED_MAPPING, PickingStatus: 'COMPLETED' });
        await expect(service.scanPalletAsync({ palletNumber: 'PLT-0001' }))
            .rejects.toMatchObject({ code: 'PALLET_NOT_AVAILABLE' });
    });

    test('rejects a pallet with no pickable inventory left', async () => {
        palletMappingRepository.findMappingByPalletId.mockResolvedValue(COMPLETED_MAPPING);
        inventoryRepository.getAvailableInventoryByPallet.mockResolvedValue([]);
        await expect(service.scanPalletAsync({ palletNumber: 'PLT-0001' }))
            .rejects.toMatchObject({ code: 'PALLET_NOT_AVAILABLE' });
    });

    test('returns pallet + distinct boxes + item lines on success', async () => {
        palletMappingRepository.findMappingByPalletId.mockResolvedValue(COMPLETED_MAPPING);
        inventoryRepository.getAvailableInventoryByPallet.mockResolvedValue([
            inventoryRow({ BoxNumber: 'BOX-0001', ItemCode: 'ITM-1' }),
            inventoryRow({ BoxNumber: 'BOX-0001', ItemCode: 'ITM-2' }),
            inventoryRow({ BoxNumber: 'BOX-0002', ItemCode: 'ITM-1' })
        ]);

        const result = await service.scanPalletAsync({ palletNumber: 'PLT-0001' });

        expect(result.palletId).toBe('PLT-0001');
        expect(result.pickingStatus).toBe('PENDING');
        expect(result.boxNumbers).toEqual(['BOX-0001', 'BOX-0002']);
        expect(result.items).toHaveLength(3);
        expect(result.items[0]).toMatchObject({ itemCode: 'ITM-1', itemName: 'Widget', availableQty: 10, pickingStatus: 'PENDING' });
    });
});

describe('scanBoxAsync', () => {
    beforeEach(() => {
        palletMappingRepository.findMappingByPalletId.mockResolvedValue(COMPLETED_MAPPING);
    });

    test('rejects missing boxNumber', async () => {
        await expect(service.scanBoxAsync({ palletNumber: 'PLT-0001' }))
            .rejects.toMatchObject({ code: 'MISSING_FIELDS' });
    });

    test('BOX_NOT_FOUND when the box does not exist anywhere', async () => {
        inventoryRepository.getInventoryByPalletAndBox.mockResolvedValue([]);
        inventoryRepository.boxExistsInInventory.mockResolvedValue(false);
        await expect(service.scanBoxAsync({ palletNumber: 'PLT-0001', boxNumber: 'BOX-9999' }))
            .rejects.toMatchObject({ code: 'BOX_NOT_FOUND' });
    });

    test('BOX_NOT_IN_PALLET when the box exists but under a different pallet', async () => {
        inventoryRepository.getInventoryByPalletAndBox.mockResolvedValue([]);
        inventoryRepository.boxExistsInInventory.mockResolvedValue(true);
        await expect(service.scanBoxAsync({ palletNumber: 'PLT-0001', boxNumber: 'BOX-0009' }))
            .rejects.toMatchObject({ code: 'BOX_NOT_IN_PALLET' });
    });

    test('BOX_ALREADY_PICKED when every line on the box is cleared', async () => {
        inventoryRepository.getInventoryByPalletAndBox.mockResolvedValue([
            inventoryRow({ Status: 'CLEARED', Quantity: 0 })
        ]);
        await expect(service.scanBoxAsync({ palletNumber: 'PLT-0001', boxNumber: 'BOX-0001' }))
            .rejects.toMatchObject({ code: 'BOX_ALREADY_PICKED' });
    });

    test('returns box lines when at least one line is still pickable', async () => {
        inventoryRepository.getInventoryByPalletAndBox.mockResolvedValue([
            inventoryRow({ ItemCode: 'ITM-1', Quantity: 10, Status: 'AVAILABLE' }),
            inventoryRow({ ItemCode: 'ITM-2', Quantity: 0, Status: 'CLEARED' })
        ]);
        const result = await service.scanBoxAsync({ palletNumber: 'PLT-0001', boxNumber: 'BOX-0001' });
        expect(result.items).toHaveLength(2);
        expect(result.items.find(i => i.itemCode === 'ITM-2').pickingStatus).toBe('PICKED');
    });
});

describe('completePickingAsync', () => {
    const REQUEST = { palletNumber: 'PLT-0001', boxNumber: 'BOX-0001', itemCode: 'ITM-1', pickedQuantity: 4 };
    const USER = { UserName: 'operator1' };

    beforeEach(() => {
        palletMappingRepository.lockLatestMappingByPalletId.mockResolvedValue(COMPLETED_MAPPING);
        inventoryRepository.lockInventoryRow.mockResolvedValue(inventoryRow());
        inventoryRepository.deductInventoryQty.mockResolvedValue();
        inventoryRepository.countAvailableInventoryForPallet.mockResolvedValue(1);
        pickingRepository.insertPickingHistory.mockResolvedValue({
            PickingID: 100, InventoryID: 10, PalletMappingID: 1, PalletID: 'PLT-0001',
            BoxNumber: 'BOX-0001', ItemCode: 'ITM-1', ItemGroup: 'GRP', WarehouseCode: 'WH1',
            LocationCode: 'WH1-A-005', PickedQty: 4, RemainingQty: 6, Status: 'COMPLETED',
            PickedBy: 'operator1', PickedAt: new Date()
        });
        pickingRepository.updatePalletPickingStatus.mockResolvedValue();
    });

    test('rejects a non-positive pickedQuantity', async () => {
        await expect(service.completePickingAsync({ ...REQUEST, pickedQuantity: 0 }, USER))
            .rejects.toMatchObject({ code: 'INVALID_PICKED_QUANTITY' });
        await expect(service.completePickingAsync({ ...REQUEST, pickedQuantity: -1 }, USER))
            .rejects.toMatchObject({ code: 'INVALID_PICKED_QUANTITY' });
    });

    test('PALLET_NOT_FOUND when the pallet mapping does not exist', async () => {
        palletMappingRepository.lockLatestMappingByPalletId.mockResolvedValue(null);
        await expect(service.completePickingAsync(REQUEST, USER)).rejects.toMatchObject({ code: 'PALLET_NOT_FOUND' });
        expect(inventoryRepository.deductInventoryQty).not.toHaveBeenCalled();
    });

    test('ITEM_NOT_FOUND when the box exists on the pallet but not that item', async () => {
        inventoryRepository.lockInventoryRow.mockResolvedValue(null);
        inventoryRepository.getInventoryByPalletAndBox.mockResolvedValue([inventoryRow({ ItemCode: 'ITM-OTHER' })]);
        await expect(service.completePickingAsync(REQUEST, USER)).rejects.toMatchObject({ code: 'ITEM_NOT_FOUND' });
        expect(inventoryRepository.deductInventoryQty).not.toHaveBeenCalled();
    });

    test('BOX_NOT_FOUND when nothing matches the box at all', async () => {
        inventoryRepository.lockInventoryRow.mockResolvedValue(null);
        inventoryRepository.getInventoryByPalletAndBox.mockResolvedValue([]);
        inventoryRepository.boxExistsInInventory.mockResolvedValue(false);
        await expect(service.completePickingAsync(REQUEST, USER)).rejects.toMatchObject({ code: 'BOX_NOT_FOUND' });
    });

    test('BOX_ALREADY_PICKED when the locked row is already CLEARED — the double-pick / idempotency guard', async () => {
        inventoryRepository.lockInventoryRow.mockResolvedValue(inventoryRow({ Status: 'CLEARED', Quantity: 0 }));
        await expect(service.completePickingAsync(REQUEST, USER)).rejects.toMatchObject({ code: 'BOX_ALREADY_PICKED' });
        expect(inventoryRepository.deductInventoryQty).not.toHaveBeenCalled();
        expect(pickingRepository.insertPickingHistory).not.toHaveBeenCalled();
    });

    test('INSUFFICIENT_INVENTORY when pickedQuantity exceeds available Quantity, and nothing is written', async () => {
        inventoryRepository.lockInventoryRow.mockResolvedValue(inventoryRow({ Quantity: 2 }));
        await expect(service.completePickingAsync({ ...REQUEST, pickedQuantity: 4 }, USER))
            .rejects.toMatchObject({ code: 'INSUFFICIENT_INVENTORY' });
        expect(inventoryRepository.deductInventoryQty).not.toHaveBeenCalled();
        expect(pickingRepository.insertPickingHistory).not.toHaveBeenCalled();
    });

    test('never allows Quantity to go negative — deducts exactly pickedQuantity and never past zero', async () => {
        inventoryRepository.lockInventoryRow.mockResolvedValue(inventoryRow({ Quantity: 4 }));
        await service.completePickingAsync({ ...REQUEST, pickedQuantity: 4 }, USER);
        expect(inventoryRepository.deductInventoryQty).toHaveBeenCalledWith(
            {}, 10, expect.objectContaining({ remainingQty: 0 })
        );
    });

    test('on success: deducts stock, records history under the authenticated user, and marks pallet IN_PROGRESS when stock remains', async () => {
        inventoryRepository.countAvailableInventoryForPallet.mockResolvedValue(2);

        const result = await service.completePickingAsync(REQUEST, USER);

        expect(inventoryRepository.deductInventoryQty).toHaveBeenCalledWith(
            {}, 10, { remainingQty: 6, updatedBy: 'operator1' }
        );
        expect(pickingRepository.insertPickingHistory).toHaveBeenCalledWith({}, expect.objectContaining({
            pickedQty: 4, remainingQty: 6, pickedBy: 'operator1'
        }));
        expect(pickingRepository.updatePalletPickingStatus).toHaveBeenCalledWith({}, 1, 'IN_PROGRESS');
        expect(result.pallet.pickingStatus).toBe('IN_PROGRESS');
        expect(result.box.pickingStatus).toBe('PENDING');
    });

    test('marks the pallet COMPLETED once no pickable inventory remains anywhere on it', async () => {
        inventoryRepository.lockInventoryRow.mockResolvedValue(inventoryRow({ Quantity: 4 }));
        inventoryRepository.countAvailableInventoryForPallet.mockResolvedValue(0);

        const result = await service.completePickingAsync({ ...REQUEST, pickedQuantity: 4 }, USER);

        expect(pickingRepository.updatePalletPickingStatus).toHaveBeenCalledWith({}, 1, 'COMPLETED');
        expect(result.pallet.pickingStatus).toBe('COMPLETED');
        expect(result.box.pickingStatus).toBe('PICKED');
    });

    test('ignores a client-supplied userId and always attributes the pick to the authenticated user', async () => {
        await service.completePickingAsync({ ...REQUEST, userId: 'someone-else' }, USER);
        expect(pickingRepository.insertPickingHistory).toHaveBeenCalledWith({}, expect.objectContaining({ pickedBy: 'operator1' }));
    });
});
