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
