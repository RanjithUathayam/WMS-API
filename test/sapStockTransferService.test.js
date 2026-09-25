jest.mock('../config/database', () => ({
    sequelize: { transaction: jest.fn(fn => fn({})) }
}));
jest.mock('../repository/pickingRepository');
jest.mock('axios');

const axios = require('axios');
const pickingRepository = require('../repository/pickingRepository');
const sap = require('../service/sapStockTransferService');

const HEADER = {
    PickListID: 100, PickListNumber: 'PL000100', Status: 'DC_CREATED', DCID: 1, DCNumber: 'DC000123',
    FromWarehouse: 'INTRTHDL', ToWarehouse: 'INTRATTM', CompletedDateText: '2026-05-21',
    ProcessingToken: 'ABC-TOKEN', StockTransferDocEntry: null
};

const DETAILS = [
    { PickListDetailID: 1, SourceDocEntry: 1001, SourceDocNum: 50001, SourceLineNum: 0, ItemCode: 'FG0001', PickedQty: 10, FromWarehouse: 'INTRTHDL', ToWarehouse: 'INTRATTM' },
    { PickListDetailID: 2, SourceDocEntry: 1001, SourceDocNum: 50001, SourceLineNum: 1, ItemCode: 'FG0002', PickedQty: 5, FromWarehouse: 'INTRTHDL', ToWarehouse: 'INTRATTM' },
    { PickListDetailID: 3, SourceDocEntry: 1002, SourceDocNum: 50002, SourceLineNum: 0, ItemCode: 'FG0001', PickedQty: 15, FromWarehouse: 'INTRTHDL', ToWarehouse: 'INTRATTM' }
];

const ENV = {
    SAP_B1_URL: 'https://sap.example:50000/b1s/v1',
    SAP_B1_COMPANY_DB: 'TESTDB',
    SAP_B1_USERNAME: 'manager',
    SAP_B1_PASSWORD: 'secret'
};

let client;
beforeEach(() => {
    jest.clearAllMocks();
    sap.resetSession();
    Object.assign(process.env, ENV);
    delete process.env.SAP_B1_LINK_BASE_DOCUMENT;
    client = { post: jest.fn(), request: jest.fn() };
    axios.create.mockReturnValue(client);
    client.post.mockResolvedValue({
        status: 200, headers: { 'set-cookie': ['B1SESSION=s1; path=/b1s', 'ROUTEID=.node1; path=/'] },
        data: { SessionId: 's1', SessionTimeout: 30 }
    });
    pickingRepository.findPickListById.mockResolvedValue(HEADER);
    pickingRepository.getPickListDetails.mockResolvedValue(DETAILS);
    pickingRepository.markStockTransferPosted.mockResolvedValue();
    pickingRepository.insertProcessLog.mockResolvedValue();
});

describe('buildStockTransferPayload', () => {
    test('base-linked: one line per source STR line, all values from the Pick List', () => {
        const payload = sap.buildStockTransferPayload(HEADER, DETAILS, { linkBaseDocument: true, baseType: 'InventoryTransferRequest' });
        expect(payload).toMatchObject({
            DocDate: '2026-05-21', TaxDate: '2026-05-21', Reference2: 'PL000100',
            FromWarehouse: 'INTRTHDL', ToWarehouse: 'INTRATTM'
        });
        expect(payload.Comments).toContain('PL000100');
        expect(payload.Comments).toContain('50001,50002');
        expect(payload.StockTransferLines).toEqual([
            { ItemCode: 'FG0001', Quantity: 10, FromWarehouseCode: 'INTRTHDL', WarehouseCode: 'INTRATTM', BaseType: 'InventoryTransferRequest', BaseEntry: 1001, BaseLine: 0 },
            { ItemCode: 'FG0002', Quantity: 5, FromWarehouseCode: 'INTRTHDL', WarehouseCode: 'INTRATTM', BaseType: 'InventoryTransferRequest', BaseEntry: 1001, BaseLine: 1 },
            { ItemCode: 'FG0001', Quantity: 15, FromWarehouseCode: 'INTRTHDL', WarehouseCode: 'INTRATTM', BaseType: 'InventoryTransferRequest', BaseEntry: 1002, BaseLine: 0 }
        ]);
    });

    test('unlinked: compatible lines are combined per item', () => {
        const payload = sap.buildStockTransferPayload(HEADER, DETAILS, { linkBaseDocument: false });
        expect(payload.StockTransferLines).toEqual([
            { ItemCode: 'FG0001', Quantity: 25, FromWarehouseCode: 'INTRTHDL', WarehouseCode: 'INTRATTM' },
            { ItemCode: 'FG0002', Quantity: 5, FromWarehouseCode: 'INTRTHDL', WarehouseCode: 'INTRATTM' }
        ]);
    });
});

describe('postStockTransferForPickList', () => {
    test('returns the stored reference without calling SAP', async () => {
        pickingRepository.findPickListById.mockResolvedValue({ ...HEADER, Status: 'COMPLETED', StockTransferDocEntry: 456, StockTransferDocNum: 10456 });
        const result = await sap.postStockTransferForPickList(100, { user: 'u' });
        expect(result).toEqual({ docEntry: 456, docNum: 10456, created: false });
        expect(axios.create).not.toHaveBeenCalled();
    });

    test('fails clearly when SAP is not configured', async () => {
        delete process.env.SAP_B1_PASSWORD;
        await expect(sap.postStockTransferForPickList(100, { user: 'u', processingToken: 'abc-token' }))
            .rejects.toMatchObject({ code: 'SAP_NOT_CONFIGURED' });
    });

    test('refuses to post before a DC exists', async () => {
        pickingRepository.findPickListById.mockResolvedValue({ ...HEADER, DCID: null, Status: 'PICKED' });
        await expect(sap.postStockTransferForPickList(100, { user: 'u' })).rejects.toMatchObject({ code: 'STOCK_TRANSFER_NOT_ALLOWED' });
    });

    test('adopts an existing SAP transfer with the same Reference2 instead of posting a duplicate', async () => {
        client.request.mockResolvedValueOnce({ status: 200, data: { value: [{ DocEntry: 456, DocNum: 10456 }] } });
        const result = await sap.postStockTransferForPickList(100, { user: 'u', processingToken: 'abc-token' });
        expect(result).toMatchObject({ docEntry: 456, docNum: 10456, created: false });
        expect(client.request).toHaveBeenCalledTimes(1);
        expect(client.request.mock.calls[0][0].method).toBe('get');
        expect(pickingRepository.markStockTransferPosted).toHaveBeenCalledWith(expect.anything(), 100, expect.objectContaining({ docEntry: 456, docNum: 10456 }));
    });

    test('posts a new transfer with the session cookie and stores DocEntry/DocNum', async () => {
        client.request
            .mockResolvedValueOnce({ status: 200, data: { value: [] } })
            .mockResolvedValueOnce({ status: 201, data: { DocEntry: 789, DocNum: 10789 } });
        const result = await sap.postStockTransferForPickList(100, { user: 'u', processingToken: 'abc-token' });

        expect(result).toMatchObject({ docEntry: 789, docNum: 10789, created: true });
        const postCall = client.request.mock.calls[1][0];
        expect(postCall).toMatchObject({ method: 'post', url: '/StockTransfers' });
        expect(postCall.headers.Cookie).toBe('B1SESSION=s1; ROUTEID=.node1');
        expect(client.post).toHaveBeenCalledWith('/Login', { CompanyDB: 'TESTDB', UserName: 'manager', Password: 'secret' });
        expect(pickingRepository.markStockTransferPosted).toHaveBeenCalledWith(expect.anything(), 100, expect.objectContaining({ docEntry: 789, baseLinked: true }));
    });

    test('re-logs in once on 401 and retries', async () => {
        client.request
            .mockResolvedValueOnce({ status: 401, data: {} })
            .mockResolvedValueOnce({ status: 200, data: { value: [] } })
            .mockResolvedValueOnce({ status: 201, data: { DocEntry: 789, DocNum: 10789 } });
        await sap.postStockTransferForPickList(100, { user: 'u', processingToken: 'abc-token' });
        expect(client.post).toHaveBeenCalledTimes(2);
    });

    test('surfaces the SAP error message and stores nothing', async () => {
        client.request
            .mockResolvedValueOnce({ status: 200, data: { value: [] } })
            .mockResolvedValueOnce({ status: 400, data: { error: { code: -10, message: { lang: 'en-us', value: 'Quantity falls into negative inventory' } } } });
        await expect(sap.postStockTransferForPickList(100, { user: 'u', processingToken: 'abc-token' }))
            .rejects.toMatchObject({ code: 'SAP_STOCK_TRANSFER_FAILED', message: expect.stringContaining('negative inventory') });
        expect(pickingRepository.markStockTransferPosted).not.toHaveBeenCalled();
    });

    test('refuses when another request owns the processing lease', async () => {
        await expect(sap.postStockTransferForPickList(100, { user: 'u', processingToken: 'other' }))
            .rejects.toMatchObject({ code: 'PICKLIST_PROCESSING' });
    });
});
