const repository = require('../repository/reportRepository');

class ReportError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 200;
const MAX_EXPORT_ROWS = 50000;

function normalizePaging(query) {
    let page = parseInt(query.page, 10);
    if (!Number.isFinite(page) || page < 1) page = 1;

    let pageSize = parseInt(query.pageSize, 10);
    if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = DEFAULT_PAGE_SIZE;
    if (pageSize > MAX_PAGE_SIZE) pageSize = MAX_PAGE_SIZE;

    return { page, pageSize, offset: (page - 1) * pageSize };
}

/** Resolves sortBy/sortDir against a per-report whitelist so nothing gets interpolated into ORDER BY unvalidated. */
function resolveSort(query, sortColumns, defaultOrderBy) {
    if (!query.sortBy) return defaultOrderBy;

    const column = sortColumns[query.sortBy];
    if (!column) {
        throw new ReportError('INVALID_SORT_COLUMN', `Cannot sort by "${query.sortBy}".`);
    }
    const dir = String(query.sortDir || '').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    return `${column} ${dir}`;
}

function trimOrUndefined(value) {
    if (value === undefined || value === null) return undefined;
    const trimmed = String(value).trim();
    return trimmed === '' ? undefined : trimmed;
}

function buildPagination(page, pageSize, totalRecords) {
    return {
        page,
        pageSize,
        totalRecords,
        totalPages: pageSize > 0 ? Math.ceil(totalRecords / pageSize) : 0
    };
}

/** Converts a raw SUM(...) result row into camelCase totals, defaulting missing/NULL sums to 0. */
function toTotals(totals, keyMap) {
    const result = {};
    Object.keys(keyMap).forEach((sqlKey) => {
        const value = totals ? totals[sqlKey] : undefined;
        result[keyMap[sqlKey]] = value !== undefined && value !== null ? Number(value) : 0;
    });
    return result;
}

function buildItemMaster(row) {
    if (!row.MasterItemCode) return null;
    return {
        itemName: row.MasterItemName || null,
        itemGroup: row.MasterItemGroup || null,
        category: row.Category || null,
        description: row.Description || null,
        color: row.Color || null,
        size: row.Size || null,
        style: row.Style || null,
        binCapacity: row.BinCapacity !== undefined && row.BinCapacity !== null ? Number(row.BinCapacity) : null
    };
}

// ---------------------------------------------------------------------------
// Pre-Binning Report
// ---------------------------------------------------------------------------
const PREBINNING_SORT_COLUMNS = {
    grnNo: 'GRNNo', itemCode: 'ItemCode', itemName: 'ItemName', itemGroup: 'ItemGroup', binId: 'BinID',
    binnedQty: 'BinnedQty', requestedQty: 'RequestedQty', binningStatus: 'BinningStatus', itemStatus: 'ItemStatus',
    createdDate: 'CreatedDate'
};
const PREBINNING_DEFAULT_ORDER = 'CreatedDate DESC';
const PREBINNING_EXPORT_COLUMNS = [
    { header: 'GRN No', data: 'GRNNo' }, { header: 'GRN Type', data: 'GRNType' }, { header: 'Doc No', data: 'DocNo' },
    { header: 'Bin ID', data: 'BinID' }, { header: 'Item Code', data: 'ItemCode' }, { header: 'Item Name', data: 'ItemName' },
    { header: 'Item Group', data: 'ItemGroup' }, { header: 'Binned Qty', data: 'BinnedQty' }, { header: 'Requested Qty', data: 'RequestedQty' },
    { header: 'Binning Status', data: 'BinningStatus' }, { header: 'Item Status', data: 'ItemStatus' }, { header: 'GRN Status', data: 'GRNStatus' },
    { header: 'Remarks', data: 'GRNRemarks' }, { header: 'Party Name', data: 'PartyName' }, { header: 'Warehouse', data: 'WhsCode' },
    { header: 'Created By', data: 'CreatedBy' }, { header: 'Created Date', data: 'CreatedDate' },
    { header: 'Master Item Name', data: 'MasterItemName' }, { header: 'Master Item Group', data: 'MasterItemGroup' },
    { header: 'Category', data: 'Category' }, { header: 'Description', data: 'Description' }, { header: 'Color', data: 'Color' },
    { header: 'Size', data: 'Size' }, { header: 'Style', data: 'Style' }, { header: 'Bin Capacity', data: 'BinCapacity' }
];

function toPreBinningFilters(query) {
    return {
        grnNo: trimOrUndefined(query.grnNo),
        itemCode: trimOrUndefined(query.itemCode),
        itemName: trimOrUndefined(query.itemName),
        binId: trimOrUndefined(query.binId),
        status: trimOrUndefined(query.status),
        fromDate: trimOrUndefined(query.fromDate),
        toDate: trimOrUndefined(query.toDate),
        search: trimOrUndefined(query.search)
    };
}

function toPreBinningDto(row) {
    return {
        binCompleteId: row.BinCompleteId,
        grnNo: row.GRNNo,
        grnType: row.GRNType,
        docNo: row.DocNo,
        binId: row.BinID,
        itemCode: row.ItemCode,
        itemName: row.ItemName,
        itemGroup: row.ItemGroup,
        binnedQty: row.BinnedQty !== null ? Number(row.BinnedQty) : null,
        requestedQty: row.RequestedQty !== null && row.RequestedQty !== undefined ? Number(row.RequestedQty) : null,
        binningStatus: row.BinningStatus,
        itemStatus: row.ItemStatus,
        grnStatus: row.GRNStatus || null,
        grnRemarks: row.GRNRemarks || null,
        partyName: row.PartyName || null,
        whsCode: row.WhsCode || null,
        createdBy: row.CreatedBy,
        createdDate: row.CreatedDate,
        updatedBy: row.UpdatedBy || null,
        updatedDate: row.UpdatedDate || null,
        itemMaster: buildItemMaster(row)
    };
}

async function getPreBinningReportAsync(query) {
    const filters = toPreBinningFilters(query);
    const { page, pageSize, offset } = normalizePaging(query);
    const orderBy = resolveSort(query, PREBINNING_SORT_COLUMNS, PREBINNING_DEFAULT_ORDER);

    const { rows, totalRecords, totals } = await repository.getPreBinningReport(filters, { offset, pageSize, orderBy });
    return {
        data: rows.map(toPreBinningDto),
        pagination: buildPagination(page, pageSize, totalRecords),
        totals: toTotals(totals, { BinnedQty: 'binnedQty', RequestedQty: 'requestedQty' })
    };
}

async function getPreBinningReportExportAsync(query) {
    const filters = toPreBinningFilters(query);
    const orderBy = resolveSort(query, PREBINNING_SORT_COLUMNS, PREBINNING_DEFAULT_ORDER);
    const rows = await repository.getPreBinningReportForExport(filters, { orderBy, maxRows: MAX_EXPORT_ROWS });
    return { rows, columns: PREBINNING_EXPORT_COLUMNS };
}

// ---------------------------------------------------------------------------
// Pallet Mapping Report
// ---------------------------------------------------------------------------
const PALLETMAPPING_SORT_COLUMNS = {
    palletId: 'PalletID', boxNumber: 'BoxNumber', itemCode: 'ItemCode', warehouseCode: 'WarehouseCode',
    boxTotalQty: 'BoxTotalQty', itemQty: 'ItemQty', status: 'PalletStatus', mappedAt: 'MappedAt'
};
const PALLETMAPPING_DEFAULT_ORDER = 'MappedAt DESC';
const PALLETMAPPING_EXPORT_COLUMNS = [
    { header: 'Pallet ID', data: 'PalletID' }, { header: 'Pallet Mapping ID', data: 'PalletMappingID' },
    { header: 'Pallet Status', data: 'PalletStatus' }, { header: 'Box Number', data: 'BoxNumber' },
    { header: 'Warehouse', data: 'WarehouseCode' }, { header: 'Box Total Qty', data: 'BoxTotalQty' },
    { header: 'Item Code', data: 'ItemCode' }, { header: 'Item Qty', data: 'ItemQty' },
    { header: 'Mapped By', data: 'MappedBy' }, { header: 'Mapped At', data: 'MappedAt' },
    { header: 'Master Item Name', data: 'MasterItemName' }, { header: 'Master Item Group', data: 'MasterItemGroup' },
    { header: 'Category', data: 'Category' }, { header: 'Description', data: 'Description' }, { header: 'Color', data: 'Color' },
    { header: 'Size', data: 'Size' }, { header: 'Style', data: 'Style' }, { header: 'Bin Capacity', data: 'BinCapacity' }
];

function toPalletMappingFilters(query) {
    return {
        palletId: trimOrUndefined(query.palletId),
        boxNumber: trimOrUndefined(query.boxNumber),
        itemCode: trimOrUndefined(query.itemCode),
        itemName: trimOrUndefined(query.itemName),
        warehouseCode: trimOrUndefined(query.warehouseCode),
        status: trimOrUndefined(query.status),
        fromDate: trimOrUndefined(query.fromDate),
        toDate: trimOrUndefined(query.toDate),
        search: trimOrUndefined(query.search)
    };
}

function toPalletMappingDto(row) {
    return {
        palletMappingId: row.PalletMappingID,
        palletId: row.PalletID,
        palletStatus: row.PalletStatus,
        palletCreatedBy: row.PalletCreatedBy,
        palletCreatedAt: row.PalletCreatedAt,
        palletCompletedBy: row.PalletCompletedBy || null,
        palletCompletedAt: row.PalletCompletedAt || null,
        palletMappingBoxId: row.PalletMappingBoxID,
        boxNumber: row.BoxNumber,
        warehouseCode: row.WarehouseCode || null,
        boxItemGroup: row.BoxItemGroup || null,
        boxTotalQty: row.BoxTotalQty !== null && row.BoxTotalQty !== undefined ? Number(row.BoxTotalQty) : null,
        itemCode: row.ItemCode || null,
        itemQty: row.ItemQty !== null && row.ItemQty !== undefined ? Number(row.ItemQty) : null,
        mappedBy: row.MappedBy,
        mappedAt: row.MappedAt,
        itemMaster: buildItemMaster(row)
    };
}

async function getPalletMappingReportAsync(query) {
    const filters = toPalletMappingFilters(query);
    const { page, pageSize, offset } = normalizePaging(query);
    const orderBy = resolveSort(query, PALLETMAPPING_SORT_COLUMNS, PALLETMAPPING_DEFAULT_ORDER);

    const { rows, totalRecords, totals } = await repository.getPalletMappingReport(filters, { offset, pageSize, orderBy });
    return {
        data: rows.map(toPalletMappingDto),
        pagination: buildPagination(page, pageSize, totalRecords),
        totals: toTotals(totals, { ItemQty: 'itemQty' })
    };
}

async function getPalletMappingReportExportAsync(query) {
    const filters = toPalletMappingFilters(query);
    const orderBy = resolveSort(query, PALLETMAPPING_SORT_COLUMNS, PALLETMAPPING_DEFAULT_ORDER);
    const rows = await repository.getPalletMappingReportForExport(filters, { orderBy, maxRows: MAX_EXPORT_ROWS });
    return { rows, columns: PALLETMAPPING_EXPORT_COLUMNS };
}

// ---------------------------------------------------------------------------
// Location Mapping Report
// ---------------------------------------------------------------------------
const LOCATIONMAPPING_SORT_COLUMNS = {
    locationCode: 'LocationCode', warehouseCode: 'WarehouseCode', rowCode: 'RowCode', positionNo: 'PositionNo',
    palletId: 'PalletID', status: 'MappingStatus', mappedAt: 'MappedAt'
};
const LOCATIONMAPPING_DEFAULT_ORDER = 'MappedAt DESC';
const LOCATIONMAPPING_EXPORT_COLUMNS = [
    { header: 'Location Code', data: 'LocationCode' }, { header: 'Warehouse', data: 'WarehouseCode' },
    { header: 'Row', data: 'RowCode' }, { header: 'Position No', data: 'PositionNo' }, { header: 'Pallet ID', data: 'PalletID' },
    { header: 'Pallet Mapping ID', data: 'PalletMappingID' }, { header: 'Action', data: 'Action' },
    { header: 'Mapping Status', data: 'MappingStatus' }, { header: 'Current Location Status', data: 'CurrentLocationStatus' },
    { header: 'Currently Occupying Pallet', data: 'CurrentOccupyingPalletID' }, { header: 'Mapped By', data: 'MappedBy' },
    { header: 'Mapped At', data: 'MappedAt' }
];

function toLocationMappingFilters(query) {
    return {
        warehouseCode: trimOrUndefined(query.warehouseCode),
        rowCode: trimOrUndefined(query.rowCode),
        locationCode: trimOrUndefined(query.locationCode),
        palletId: trimOrUndefined(query.palletId),
        status: trimOrUndefined(query.status),
        itemCode: trimOrUndefined(query.itemCode),
        fromDate: trimOrUndefined(query.fromDate),
        toDate: trimOrUndefined(query.toDate),
        search: trimOrUndefined(query.search)
    };
}

function toLocationMappingDto(row) {
    return {
        locationMappingId: row.LocationMappingID,
        locationId: row.LocationID,
        locationCode: row.LocationCode,
        warehouseCode: row.WarehouseCode,
        rowCode: row.RowCode,
        positionNo: row.PositionNo,
        palletMappingId: row.PalletMappingID,
        palletId: row.PalletID,
        action: row.Action,
        mappingStatus: row.MappingStatus,
        currentLocationStatus: row.CurrentLocationStatus || null,
        currentOccupyingPalletId: row.CurrentOccupyingPalletID || null,
        mappedBy: row.MappedBy,
        mappedAt: row.MappedAt
    };
}

async function getLocationMappingReportAsync(query) {
    const filters = toLocationMappingFilters(query);
    const { page, pageSize, offset } = normalizePaging(query);
    const orderBy = resolveSort(query, LOCATIONMAPPING_SORT_COLUMNS, LOCATIONMAPPING_DEFAULT_ORDER);

    const { rows, totalRecords } = await repository.getLocationMappingReport(filters, { offset, pageSize, orderBy });
    return { data: rows.map(toLocationMappingDto), pagination: buildPagination(page, pageSize, totalRecords) };
}

async function getLocationMappingReportExportAsync(query) {
    const filters = toLocationMappingFilters(query);
    const orderBy = resolveSort(query, LOCATIONMAPPING_SORT_COLUMNS, LOCATIONMAPPING_DEFAULT_ORDER);
    const rows = await repository.getLocationMappingReportForExport(filters, { orderBy, maxRows: MAX_EXPORT_ROWS });
    return { rows, columns: LOCATIONMAPPING_EXPORT_COLUMNS };
}

// ---------------------------------------------------------------------------
// Inventory Details Report
// ---------------------------------------------------------------------------
const INVENTORY_SORT_COLUMNS = {
    warehouseCode: 'WarehouseCode', locationCode: 'LocationCode', palletId: 'PalletID', boxNumber: 'BoxNumber',
    itemCode: 'ItemCode', quantity: 'Quantity', status: 'Status', createdAt: 'CreatedAt'
};
const INVENTORY_DEFAULT_ORDER = 'CreatedAt DESC';
const INVENTORY_EXPORT_COLUMNS = [
    { header: 'Warehouse', data: 'WarehouseCode' }, { header: 'Row', data: 'RowCode' }, { header: 'Location', data: 'LocationCode' },
    { header: 'Pallet ID', data: 'PalletID' }, { header: 'Box Number', data: 'BoxNumber' }, { header: 'Item Code', data: 'ItemCode' },
    { header: 'Item Group', data: 'InventoryItemGroup' }, { header: 'Quantity', data: 'Quantity' }, { header: 'Allocated Qty', data: 'AllocatedQty' },
    { header: 'Status', data: 'Status' }, { header: 'Created By', data: 'CreatedBy' }, { header: 'Created At', data: 'CreatedAt' },
    { header: 'Master Item Name', data: 'MasterItemName' }, { header: 'Master Item Group', data: 'MasterItemGroup' },
    { header: 'Category', data: 'Category' }, { header: 'Description', data: 'Description' }, { header: 'Color', data: 'Color' },
    { header: 'Size', data: 'Size' }, { header: 'Style', data: 'Style' }, { header: 'Bin Capacity', data: 'BinCapacity' }
];

function toInventoryDetailsFilters(query) {
    return {
        itemCode: trimOrUndefined(query.itemCode),
        itemName: trimOrUndefined(query.itemName),
        itemGroup: trimOrUndefined(query.itemGroup),
        warehouseCode: trimOrUndefined(query.warehouseCode),
        locationCode: trimOrUndefined(query.locationCode),
        palletId: trimOrUndefined(query.palletId),
        boxNumber: trimOrUndefined(query.boxNumber),
        status: trimOrUndefined(query.status),
        fromDate: trimOrUndefined(query.fromDate),
        toDate: trimOrUndefined(query.toDate),
        search: trimOrUndefined(query.search)
    };
}

function toInventoryDetailsDto(row) {
    return {
        inventoryId: row.InventoryID,
        warehouseCode: row.WarehouseCode,
        rowCode: row.RowCode,
        locationId: row.LocationID,
        locationCode: row.LocationCode || null,
        palletMappingId: row.PalletMappingID,
        palletId: row.PalletID || null,
        boxNumber: row.BoxNumber,
        itemCode: row.ItemCode,
        itemGroup: row.InventoryItemGroup || null,
        quantity: row.Quantity !== null && row.Quantity !== undefined ? Number(row.Quantity) : null,
        allocatedQty: row.AllocatedQty !== null && row.AllocatedQty !== undefined ? Number(row.AllocatedQty) : null,
        status: row.Status,
        createdBy: row.CreatedBy,
        createdAt: row.CreatedAt,
        updatedBy: row.UpdatedBy || null,
        updatedAt: row.UpdatedAt || null,
        itemMaster: buildItemMaster(row)
    };
}

async function getInventoryDetailsReportAsync(query) {
    const filters = toInventoryDetailsFilters(query);
    const { page, pageSize, offset } = normalizePaging(query);
    const orderBy = resolveSort(query, INVENTORY_SORT_COLUMNS, INVENTORY_DEFAULT_ORDER);

    const { rows, totalRecords, totals } = await repository.getInventoryDetailsReport(filters, { offset, pageSize, orderBy });
    return {
        data: rows.map(toInventoryDetailsDto),
        pagination: buildPagination(page, pageSize, totalRecords),
        totals: toTotals(totals, { Quantity: 'quantity', AllocatedQty: 'allocatedQty' })
    };
}

async function getInventoryDetailsReportExportAsync(query) {
    const filters = toInventoryDetailsFilters(query);
    const orderBy = resolveSort(query, INVENTORY_SORT_COLUMNS, INVENTORY_DEFAULT_ORDER);
    const rows = await repository.getInventoryDetailsReportForExport(filters, { orderBy, maxRows: MAX_EXPORT_ROWS });
    return { rows, columns: INVENTORY_EXPORT_COLUMNS };
}

// ---------------------------------------------------------------------------
// Picking History Report
// ---------------------------------------------------------------------------
const PICKINGHISTORY_SORT_COLUMNS = {
    palletId: 'PalletID', boxNumber: 'BoxNumber', itemCode: 'ItemCode', pickedQty: 'PickedQty',
    status: 'Status', pickedBy: 'PickedBy', pickedAt: 'PickedAt'
};
const PICKINGHISTORY_DEFAULT_ORDER = 'PickedAt DESC';
const PICKINGHISTORY_EXPORT_COLUMNS = [
    { header: 'Picking ID', data: 'PickingID' }, { header: 'Pallet ID', data: 'PalletID' },
    { header: 'Box Number', data: 'BoxNumber' }, { header: 'Item Code', data: 'ItemCode' },
    { header: 'Warehouse', data: 'WarehouseCode' }, { header: 'Location', data: 'LocationCode' },
    { header: 'Picked Qty', data: 'PickedQty' }, { header: 'Remaining Qty', data: 'RemainingQty' },
    { header: 'Status', data: 'Status' }, { header: 'Picked By', data: 'PickedBy' }, { header: 'Picked At', data: 'PickedAt' },
    { header: 'Master Item Name', data: 'MasterItemName' }, { header: 'Master Item Group', data: 'MasterItemGroup' },
    { header: 'Category', data: 'Category' }, { header: 'Description', data: 'Description' }, { header: 'Color', data: 'Color' },
    { header: 'Size', data: 'Size' }, { header: 'Style', data: 'Style' }, { header: 'Bin Capacity', data: 'BinCapacity' }
];

function toPickingHistoryFilters(query) {
    return {
        palletId: trimOrUndefined(query.palletId),
        boxNumber: trimOrUndefined(query.boxNumber),
        itemCode: trimOrUndefined(query.itemCode),
        status: trimOrUndefined(query.status),
        pickedBy: trimOrUndefined(query.user || query.pickedBy),
        fromDate: trimOrUndefined(query.fromDate),
        toDate: trimOrUndefined(query.toDate),
        search: trimOrUndefined(query.search)
    };
}

function toPickingHistoryDto(row) {
    return {
        pickingId: row.PickingID,
        inventoryId: row.InventoryID,
        palletMappingId: row.PalletMappingID,
        palletId: row.PalletID,
        boxNumber: row.BoxNumber,
        itemCode: row.ItemCode,
        itemGroup: row.ItemGroup || null,
        warehouseCode: row.WarehouseCode || null,
        locationCode: row.LocationCode || null,
        pickedQty: row.PickedQty !== null && row.PickedQty !== undefined ? Number(row.PickedQty) : null,
        remainingQty: row.RemainingQty !== null && row.RemainingQty !== undefined ? Number(row.RemainingQty) : null,
        status: row.Status,
        pickedBy: row.PickedBy,
        pickedAt: row.PickedAt,
        itemMaster: buildItemMaster(row)
    };
}

async function getPickingHistoryReportAsync(query) {
    const filters = toPickingHistoryFilters(query);
    const { page, pageSize, offset } = normalizePaging(query);
    const orderBy = resolveSort(query, PICKINGHISTORY_SORT_COLUMNS, PICKINGHISTORY_DEFAULT_ORDER);

    const { rows, totalRecords, totals } = await repository.getPickingHistoryReport(filters, { offset, pageSize, orderBy });
    return {
        data: rows.map(toPickingHistoryDto),
        pagination: buildPagination(page, pageSize, totalRecords),
        totals: toTotals(totals, { PickedQty: 'pickedQty' })
    };
}

async function getPickingHistoryReportExportAsync(query) {
    const filters = toPickingHistoryFilters(query);
    const orderBy = resolveSort(query, PICKINGHISTORY_SORT_COLUMNS, PICKINGHISTORY_DEFAULT_ORDER);
    const rows = await repository.getPickingHistoryReportForExport(filters, { orderBy, maxRows: MAX_EXPORT_ROWS });
    return { rows, columns: PICKINGHISTORY_EXPORT_COLUMNS };
}

module.exports = {
    ReportError,
    getPreBinningReportAsync,
    getPreBinningReportExportAsync,
    getPalletMappingReportAsync,
    getPalletMappingReportExportAsync,
    getLocationMappingReportAsync,
    getLocationMappingReportExportAsync,
    getInventoryDetailsReportAsync,
    getInventoryDetailsReportExportAsync,
    getPickingHistoryReportAsync,
    getPickingHistoryReportExportAsync
};
