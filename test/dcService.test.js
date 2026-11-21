jest.mock('../config/database', () => ({
    sequelize: { transaction: jest.fn(fn => fn({})) }
}));
jest.mock('../repository/pickingRepository');
jest.mock('../repository/dcRepository');

const pickingRepository = require('../repository/pickingRepository');
const dcRepository = require('../repository/dcRepository');
const dcService = require('../service/dcService');

const HEADER = {
    PickListID: 100, PickListNumber: 'PL000100', Status: 'PICKED', DCID: null,
    FromWarehouse: 'INTRTHDL', ToWarehouse: 'INTRATTM', CompletedDate: new Date(), CompletedDateText: '2026-05-21'
};
const DC = { DCID: 7, DCNumber: 'DC000007', PickListID: 100, DCDate: '2026-05-21', FromWarehouse: 'INTRTHDL', ToWarehouse: 'INTRATTM', TotalQty: 30, Status: 'CREATED' };

beforeEach(() => {
    jest.clearAllMocks();
    pickingRepository.lockPickListById.mockResolvedValue(HEADER);
    dcRepository.findDCByPickListId.mockResolvedValue(null);
    pickingRepository.lockPickListDetails.mockResolvedValue([
        { PickListDetailID: 1, SourceDocEntry: 1001, SourceDocNum: 50001, SourceLineNum: 0, ItemCode: 'FG0001', PickedQty: 10, RemainingQty: 0, FromWarehouse: 'INTRTHDL', ToWarehouse: 'INTRATTM' },
        { PickListDetailID: 2, SourceDocEntry: 1002, SourceDocNum: 50002, SourceLineNum: 0, ItemCode: 'FG0001', PickedQty: 20, RemainingQty: 0, FromWarehouse: 'INTRTHDL', ToWarehouse: 'INTRATTM' }
    ]);
    dcRepository.insertDC.mockResolvedValue(DC);
    dcRepository.insertDCDetail.mockResolvedValue();
    pickingRepository.markDCCreated.mockResolvedValue();
});

test('creates one DC with a line per source STR line and stores it on the Pick List', async () => {
    const result = await dcService.generateDCFromPickList(100, { user: 'u' });
    expect(result).toMatchObject({ dcNumber: 'DC000007', created: true, totalQty: 30 });
    expect(dcRepository.insertDC).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ dcDate: '2026-05-21', totalQty: 30 }));
    expect(dcRepository.insertDCDetail).toHaveBeenCalledTimes(2);
    expect(pickingRepository.markDCCreated).toHaveBeenCalledWith(expect.anything(), 100, { dcId: 7, dcNumber: 'DC000007', updatedBy: 'u' });
});

test('full box: DC quantity is the actual picked qty (25), not the required qty (10)', async () => {
    pickingRepository.lockPickListDetails.mockResolvedValue([
        { PickListDetailID: 1, SourceDocEntry: 1001, SourceDocNum: 50001, SourceLineNum: 0, ItemCode: 'FG0001', RequestedQty: 10, PickedQty: 25, RemainingQty: 0, FromWarehouse: 'INTRTHDL', ToWarehouse: 'INTRATTM' }
    ]);
    await dcService.generateDCFromPickList(100, { user: 'u' });
    expect(dcRepository.insertDC).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ totalQty: 25 }));
    expect(dcRepository.insertDCDetail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ pickListDetailId: 1, quantity: 25 }));
});

test('getDCForPickList: item-wise lines with required / excess and the boxes behind each line', async () => {
    dcRepository.findDCByPickListId.mockResolvedValue({ ...DC, TotalQty: 25 });
    dcRepository.getDCDetails.mockResolvedValue([
        { PickListDetailID: 1, SourceDocEntry: 1001, SourceDocNum: 50001, SourceLineNum: 0, ItemCode: 'FG0001', ItemName: 'FG 1', Quantity: 25, RequestedQty: 10, FromWarehouse: 'INTRTHDL', ToWarehouse: 'INTRATTM' }
    ]);
    pickingRepository.getPickTransactions.mockResolvedValue([
        { PickListDetailID: 1, PalletNumber: 'PAL001', BoxNumber: 'BOX001', AvailableQty: 25, PickQty: 25, IsFullBox: true }
    ]);
    const dc = await dcService.getDCForPickList(100);
    expect(dc).toMatchObject({ totalQty: 25, totalRequestedQty: 10, totalExcessQty: 15 });
    expect(dc.lines[0]).toMatchObject({ quantity: 25, requestedQty: 10, excessQty: 15, boxes: [{ palletNumber: 'PAL001', boxNumber: 'BOX001', boxQty: 25, qty: 25, fullBox: true }] });
});

test('returns the existing DC instead of creating a second one', async () => {
    dcRepository.findDCByPickListId.mockResolvedValue(DC);
    pickingRepository.lockPickListById.mockResolvedValue({ ...HEADER, DCID: 7, Status: 'DC_CREATED' });
    const result = await dcService.generateDCFromPickList(100, { user: 'u' });
    expect(result).toMatchObject({ dcNumber: 'DC000007', created: false });
    expect(dcRepository.insertDC).not.toHaveBeenCalled();
});

test('refuses before picking is validated complete', async () => {
    pickingRepository.lockPickListById.mockResolvedValue({ ...HEADER, Status: 'IN_PROGRESS', CompletedDate: null });
    await expect(dcService.generateDCFromPickList(100, { user: 'u' })).rejects.toMatchObject({ code: 'DC_NOT_ALLOWED' });
});

test('adopts the winner DC when a concurrent request hits the unique index', async () => {
    const dup = new Error('dup');
    dup.isDuplicateDC = true;
    dcRepository.insertDC.mockRejectedValue(dup);
    dcRepository.findDCByPickListId.mockResolvedValueOnce(null).mockResolvedValueOnce(DC);
    const result = await dcService.generateDCFromPickList(100, { user: 'u' });
    expect(result).toMatchObject({ dcNumber: 'DC000007', created: false });
});
