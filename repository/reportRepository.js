const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');

const MASTER_PART_JOIN = `LEFT JOIN Master_Part mp WITH (NOLOCK) ON mp.ItemCode = %ALIAS%.ItemCode AND (mp.isDelete = 0 OR mp.isDelete IS NULL)`;
const MASTER_PART_SELECT = `mp.ItemCode AS MasterItemCode, mp.ItemName AS MasterItemName, mp.ItemGroup AS MasterItemGroup, mp.Category AS Category, mp.Description AS Description, mp.Color AS Color, mp.Size AS Size, mp.Style AS Style, mp.BinCapacity AS BinCapacity`;
/** Global-search fragment over every displayed Master_Part text column (expects a :search replacement). */
const MASTER_PART_SEARCH = `mp.ItemName LIKE :search OR mp.ItemGroup LIKE :search OR mp.Category LIKE :search OR mp.Description LIKE :search OR mp.Color LIKE :search OR mp.Size LIKE :search OR mp.Style LIKE :search`;

/**
 * Runs a paged data query + a matching COUNT(*) query against the same FROM/JOIN/WHERE (and GROUP BY, if any).
 * When `sumSelect` is given (e.g. "SUM(bc.Quantity) AS BinnedQty"), also runs a flat SUM(...) query across every
 * row matching the same FROM/JOIN/WHERE (ignoring GROUP BY/paging) so totals reflect the whole filtered set, not
 * just the current page. Sum is associative, so a flat SUM equals the sum of any GROUP BY'd per-row sums.
 */
async function runPagedQuery({ selectColumns, fromJoin, whereSql, groupBy, orderBy, replacements, offset, pageSize, sumSelect }) {
    const dataSql = `
        SELECT ${selectColumns}
        FROM ${fromJoin}
        ${whereSql}
        ${groupBy ? `GROUP BY ${groupBy}` : ''}
        ORDER BY ${orderBy}
        OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY
    `;
    const countSql = groupBy
        ? `SELECT COUNT(*) AS Total FROM (SELECT 1 AS x FROM ${fromJoin} ${whereSql} GROUP BY ${groupBy}) t`
        : `SELECT COUNT(*) AS Total FROM ${fromJoin} ${whereSql}`;

    const queries = [
        sequelize.query(dataSql, { replacements: { ...replacements, offset, pageSize }, type: QueryTypes.SELECT }),
        sequelize.query(countSql, { replacements, type: QueryTypes.SELECT })
    ];
    if (sumSelect) {
        const sumSql = `SELECT ${sumSelect} FROM ${fromJoin} ${whereSql}`;
        queries.push(sequelize.query(sumSql, { replacements, type: QueryTypes.SELECT }));
    }

    const [rows, countRows, sumRows] = await Promise.all(queries);
    return {
        rows,
        totalRecords: Number(countRows[0].Total),
        totals: sumSelect ? sumRows[0] : undefined
    };
}

/** Runs the same query as an unpaged, capped TOP(N) — used for export (full filtered set, not one page). */
async function runFullQuery({ selectColumns, fromJoin, whereSql, groupBy, orderBy, replacements, maxRows }) {
    const sql = `
        SELECT TOP (:maxRows) ${selectColumns}
        FROM ${fromJoin}
        ${whereSql}
        ${groupBy ? `GROUP BY ${groupBy}` : ''}
        ORDER BY ${orderBy}
    `;
    return sequelize.query(sql, { replacements: { ...replacements, maxRows }, type: QueryTypes.SELECT });
}

// ---------------------------------------------------------------------------
// Pre-Binning Report — T_BIN_COMPLETE (one row per bin completion) left-joined
// to ERP_Pre_Binning (requested qty/GRN status/remarks) and Master_Part.
// ---------------------------------------------------------------------------
function buildPreBinningQuery(filters) {
    const conditions = [];
    const replacements = {};

    if (filters.grnNo) { conditions.push('bc.GRNNo LIKE :grnNo'); replacements.grnNo = `%${filters.grnNo}%`; }
    if (filters.whsCode) { conditions.push('bc.WhsCode = :whsCode'); replacements.whsCode = filters.whsCode; }
    if (filters.itemCode) { conditions.push('bc.ItemCode LIKE :itemCode'); replacements.itemCode = `%${filters.itemCode}%`; }
    if (filters.itemName) { conditions.push('bc.ItemName LIKE :itemName'); replacements.itemName = `%${filters.itemName}%`; }
    if (filters.binId) { conditions.push('bc.BinID LIKE :binId'); replacements.binId = `%${filters.binId}%`; }
    if (filters.status) { conditions.push('bc.BinningStatus = :status'); replacements.status = filters.status; }
    if (filters.fromDate) { conditions.push('CAST(bc.CreatedDate AS DATE) >= :fromDate'); replacements.fromDate = filters.fromDate; }
    if (filters.toDate) { conditions.push('CAST(bc.CreatedDate AS DATE) <= :toDate'); replacements.toDate = filters.toDate; }
    if (filters.search) {
        conditions.push(`(bc.GRNNo LIKE :search OR bc.WhsCode LIKE :search OR bc.GRNType LIKE :search OR bc.DocNo LIKE :search
            OR bc.BinID LIKE :search OR bc.ItemCode LIKE :search OR bc.ItemName LIKE :search OR bc.ItemGroup LIKE :search
            OR bc.BinningStatus LIKE :search OR bc.ItemStatus LIKE :search OR bc.CreatedBy LIKE :search OR pb.PartyName LIKE :search
            OR ${MASTER_PART_SEARCH})`);
        replacements.search = `%${filters.search}%`;
    }

    return {
        selectColumns: `
            bc.id AS BinCompleteId, bc.GRNNo AS GRNNo, bc.GRNType AS GRNType, bc.DocNo AS DocNo, bc.BinID AS BinID,
            bc.ItemCode AS ItemCode, bc.ItemName AS ItemName, bc.ItemGroup AS ItemGroup, bc.Quantity AS BinnedQty,
            bc.BinningStatus AS BinningStatus, bc.ItemStatus AS ItemStatus, bc.WhsCode AS WhsCode,
            bc.CreatedDate AS CreatedDate, bc.CreatedBy AS CreatedBy, bc.UpdatedDate AS UpdatedDate, bc.UpdatedBy AS UpdatedBy,
            pb.Quantity AS RequestedQty, pb.GRNStatus AS GRNStatus, pb.GRNRemarks AS GRNRemarks, pb.PartyName AS PartyName,
            ${MASTER_PART_SELECT}
        `,
        fromJoin: `
            T_BIN_COMPLETE bc WITH (NOLOCK)
            LEFT JOIN ERP_Pre_Binning pb WITH (NOLOCK) ON pb.GRNNo = bc.GRNNo AND pb.ItemCode = bc.ItemCode
            ${MASTER_PART_JOIN.replace('%ALIAS%', 'bc')}
        `,
        whereSql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
        groupBy: null,
        sumSelect: 'SUM(bc.Quantity) AS BinnedQty, SUM(pb.Quantity) AS RequestedQty',
        replacements
    };
}

async function getPreBinningReport(filters, { offset, pageSize, orderBy }) {
    const q = buildPreBinningQuery(filters);
    return runPagedQuery({ ...q, orderBy, offset, pageSize });
}

async function getPreBinningReportForExport(filters, { orderBy, maxRows }) {
    const q = buildPreBinningQuery(filters);
    return runFullQuery({ ...q, orderBy, maxRows });
}

// ---------------------------------------------------------------------------
// Pallet Mapping Report — one row per (box, item) mapped onto a pallet.
// T_PALLET_MAPPING_BOX -> T_PALLET_MAPPING (status) -> T_PREBIN_BOX -> T_PREBIN_ITEM (qty per item) -> Master_Part.
// T_PREBIN_ITEM holds one row per scanned unit, so it is pre-aggregated to (box, item) BEFORE joining Master_Part.
// Joining Master_Part per unit row and grouping afterwards timed out (40s): Master_Part.ItemCode is VARCHAR vs
// NVARCHAR here, so every unit row paid for an implicit-conversion lookup. For the same reason Master_Part is joined
// on a VARCHAR copy of the item code (ItemCodeV): that lets SQL Server seek PK_Master_Part instead of scanning it,
// which the paged query could get away with but global search / export (no TOP 25) could not.
// ---------------------------------------------------------------------------
const PALLETMAPPING_ITEM_SOURCE = `(
    SELECT PreBinBoxID, ItemCode, CAST(ItemCode AS VARCHAR(500)) AS ItemCodeV, SUM(Qty) AS Qty
    FROM T_PREBIN_ITEM WITH (NOLOCK)
    GROUP BY PreBinBoxID, ItemCode
) pi`;
const PALLETMAPPING_MASTER_PART_JOIN = `LEFT JOIN Master_Part mp WITH (NOLOCK) ON mp.ItemCode = pi.ItemCodeV AND (mp.isDelete = 0 OR mp.isDelete IS NULL)`;

/** Adds stable tie-breakers so OFFSET paging never repeats/skips rows that share the sort value (e.g. same MappedAt). */
function withPalletMappingTieBreak(orderBy) {
    const extra = ['PalletMappingBoxID DESC'];
    if (!/\bItemCode\b/i.test(orderBy)) extra.push('ItemCode ASC');
    return `${orderBy}, ${extra.join(', ')}`;
}

function buildPalletMappingQuery(filters) {
    const conditions = [];
    const replacements = {};

    if (filters.palletId) { conditions.push('pm.PalletID LIKE :palletId'); replacements.palletId = `%${filters.palletId}%`; }
    if (filters.boxNumber) { conditions.push('pmb.BoxNumber LIKE :boxNumber'); replacements.boxNumber = `%${filters.boxNumber}%`; }
    if (filters.itemCode) { conditions.push('pi.ItemCode LIKE :itemCode'); replacements.itemCode = `%${filters.itemCode}%`; }
    if (filters.itemName) { conditions.push('mp.ItemName LIKE :itemName'); replacements.itemName = `%${filters.itemName}%`; }
    if (filters.warehouseCode) { conditions.push('pmb.WarehouseCode = :warehouseCode'); replacements.warehouseCode = filters.warehouseCode; }
    if (filters.status) { conditions.push('pm.Status = :status'); replacements.status = filters.status; }
    if (filters.fromDate) { conditions.push('CAST(pmb.MappedAt AS DATE) >= :fromDate'); replacements.fromDate = filters.fromDate; }
    if (filters.toDate) { conditions.push('CAST(pmb.MappedAt AS DATE) <= :toDate'); replacements.toDate = filters.toDate; }
    if (filters.search) {
        conditions.push(`(pm.PalletID LIKE :search OR pm.Status LIKE :search OR pmb.BoxNumber LIKE :search OR pmb.WarehouseCode LIKE :search
            OR pmb.ItemGroup LIKE :search OR pi.ItemCode LIKE :search OR pmb.MappedBy LIKE :search
            OR ${MASTER_PART_SEARCH})`);
        replacements.search = `%${filters.search}%`;
    }

    return {
        selectColumns: `
            pm.PalletMappingID AS PalletMappingID, pm.PalletID AS PalletID, pm.Status AS PalletStatus,
            pm.CreatedBy AS PalletCreatedBy, pm.CreatedAt AS PalletCreatedAt, pm.CompletedBy AS PalletCompletedBy, pm.CompletedAt AS PalletCompletedAt,
            pmb.PalletMappingBoxID AS PalletMappingBoxID, pmb.BoxNumber AS BoxNumber, pmb.WarehouseCode AS WarehouseCode,
            pmb.ItemGroup AS BoxItemGroup, pmb.BoxTotalQty AS BoxTotalQty, pmb.MappedBy AS MappedBy, pmb.MappedAt AS MappedAt,
            pi.ItemCode AS ItemCode, pi.Qty AS ItemQty,
            ${MASTER_PART_SELECT}
        `,
        fromJoin: `
            T_PALLET_MAPPING_BOX pmb WITH (NOLOCK)
            INNER JOIN T_PALLET_MAPPING pm WITH (NOLOCK) ON pm.PalletMappingID = pmb.PalletMappingID
            LEFT JOIN T_PREBIN_BOX pb WITH (NOLOCK) ON pb.BoxNumber = pmb.BoxNumber
            LEFT JOIN ${PALLETMAPPING_ITEM_SOURCE} ON pi.PreBinBoxID = pb.PreBinBoxID
            ${PALLETMAPPING_MASTER_PART_JOIN}
        `,
        whereSql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
        groupBy: null,
        sumSelect: 'SUM(pi.Qty) AS ItemQty',
        replacements
    };
}

async function getPalletMappingReport(filters, { offset, pageSize, orderBy }) {
    const q = buildPalletMappingQuery(filters);
    return runPagedQuery({ ...q, orderBy: withPalletMappingTieBreak(orderBy), offset, pageSize });
}

async function getPalletMappingReportForExport(filters, { orderBy, maxRows }) {
    const q = buildPalletMappingQuery(filters);
    return runFullQuery({ ...q, orderBy: withPalletMappingTieBreak(orderBy), maxRows });
}

// ---------------------------------------------------------------------------
// Location Mapping Report — T_LOCATION_MAPPING (append-only audit trail) left-joined
// to T_LOCATION for the location's *current* status. ItemCode is filter-only (via EXISTS),
// not a displayed column, since a location mapping row is pallet-grain, not item-grain.
// ---------------------------------------------------------------------------
function buildLocationMappingQuery(filters) {
    const conditions = [];
    const replacements = {};

    if (filters.warehouseCode) { conditions.push('lm.WarehouseCode = :warehouseCode'); replacements.warehouseCode = filters.warehouseCode; }
    if (filters.rowCode) { conditions.push('lm.RowCode = :rowCode'); replacements.rowCode = filters.rowCode; }
    if (filters.locationCode) { conditions.push('lm.LocationCode LIKE :locationCode'); replacements.locationCode = `%${filters.locationCode}%`; }
    if (filters.palletId) { conditions.push('lm.PalletID LIKE :palletId'); replacements.palletId = `%${filters.palletId}%`; }
    if (filters.status) { conditions.push('lm.Status = :status'); replacements.status = filters.status; }
    if (filters.fromDate) { conditions.push('CAST(lm.MappedAt AS DATE) >= :fromDate'); replacements.fromDate = filters.fromDate; }
    if (filters.toDate) { conditions.push('CAST(lm.MappedAt AS DATE) <= :toDate'); replacements.toDate = filters.toDate; }
    if (filters.itemCode) {
        conditions.push(`EXISTS (
            SELECT 1 FROM T_PALLET_MAPPING_BOX pmb WITH (NOLOCK)
            INNER JOIN T_PREBIN_BOX pb WITH (NOLOCK) ON pb.BoxNumber = pmb.BoxNumber
            INNER JOIN T_PREBIN_ITEM pi WITH (NOLOCK) ON pi.PreBinBoxID = pb.PreBinBoxID
            WHERE pmb.PalletMappingID = lm.PalletMappingID AND pi.ItemCode LIKE :itemCode
        )`);
        replacements.itemCode = `%${filters.itemCode}%`;
    }
    if (filters.search) {
        conditions.push(`(lm.LocationCode LIKE :search OR lm.WarehouseCode LIKE :search OR lm.RowCode LIKE :search
            OR CAST(lm.PositionNo AS NVARCHAR(20)) LIKE :search OR lm.PalletID LIKE :search OR CAST(lm.PalletMappingID AS NVARCHAR(20)) LIKE :search
            OR lm.Action LIKE :search OR lm.Status LIKE :search OR lm.MappedBy LIKE :search
            OR loc.Status LIKE :search OR loc.CurrentPalletID LIKE :search)`);
        replacements.search = `%${filters.search}%`;
    }

    return {
        selectColumns: `
            lm.LocationMappingID AS LocationMappingID, lm.LocationID AS LocationID, lm.LocationCode AS LocationCode,
            lm.WarehouseCode AS WarehouseCode, lm.RowCode AS RowCode, lm.PositionNo AS PositionNo,
            lm.PalletMappingID AS PalletMappingID, lm.PalletID AS PalletID, lm.Action AS Action, lm.Status AS MappingStatus,
            lm.MappedBy AS MappedBy, lm.MappedAt AS MappedAt,
            loc.Status AS CurrentLocationStatus, loc.CurrentPalletID AS CurrentOccupyingPalletID
        `,
        fromJoin: `
            T_LOCATION_MAPPING lm WITH (NOLOCK)
            LEFT JOIN T_LOCATION loc WITH (NOLOCK) ON loc.LocationID = lm.LocationID
        `,
        whereSql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
        groupBy: null,
        replacements
    };
}

async function getLocationMappingReport(filters, { offset, pageSize, orderBy }) {
    const q = buildLocationMappingQuery(filters);
    return runPagedQuery({ ...q, orderBy, offset, pageSize });
}

async function getLocationMappingReportForExport(filters, { orderBy, maxRows }) {
    const q = buildLocationMappingQuery(filters);
    return runFullQuery({ ...q, orderBy, maxRows });
}

// ---------------------------------------------------------------------------
// Inventory Details Report — T_INVENTORY left-joined to Master_Part.
// ---------------------------------------------------------------------------
function buildInventoryDetailsQuery(filters) {
    const conditions = [];
    const replacements = {};

    if (filters.itemCode) { conditions.push('inv.ItemCode LIKE :itemCode'); replacements.itemCode = `%${filters.itemCode}%`; }
    if (filters.itemName) { conditions.push('mp.ItemName LIKE :itemName'); replacements.itemName = `%${filters.itemName}%`; }
    if (filters.itemGroup) { conditions.push('inv.ItemGroup LIKE :itemGroup'); replacements.itemGroup = `%${filters.itemGroup}%`; }
    if (filters.warehouseCode) { conditions.push('inv.WarehouseCode = :warehouseCode'); replacements.warehouseCode = filters.warehouseCode; }
    if (filters.locationCode) { conditions.push('inv.LocationCode LIKE :locationCode'); replacements.locationCode = `%${filters.locationCode}%`; }
    if (filters.palletId) { conditions.push('inv.PalletID LIKE :palletId'); replacements.palletId = `%${filters.palletId}%`; }
    if (filters.boxNumber) { conditions.push('inv.BoxNumber LIKE :boxNumber'); replacements.boxNumber = `%${filters.boxNumber}%`; }
    if (filters.status) { conditions.push('inv.Status = :status'); replacements.status = filters.status; }
    if (filters.fromDate) { conditions.push('CAST(inv.CreatedAt AS DATE) >= :fromDate'); replacements.fromDate = filters.fromDate; }
    if (filters.toDate) { conditions.push('CAST(inv.CreatedAt AS DATE) <= :toDate'); replacements.toDate = filters.toDate; }
    if (filters.search) {
        conditions.push(`(inv.WarehouseCode LIKE :search OR inv.RowCode LIKE :search OR inv.LocationCode LIKE :search OR inv.PalletID LIKE :search
            OR inv.BoxNumber LIKE :search OR inv.ItemCode LIKE :search OR inv.ItemGroup LIKE :search OR inv.Status LIKE :search
            OR inv.CreatedBy LIKE :search OR ${MASTER_PART_SEARCH})`);
        replacements.search = `%${filters.search}%`;
    }

    return {
        selectColumns: `
            inv.InventoryID AS InventoryID, inv.WarehouseCode AS WarehouseCode, inv.RowCode AS RowCode,
            inv.LocationID AS LocationID, inv.LocationCode AS LocationCode, inv.PalletMappingID AS PalletMappingID,
            inv.PalletID AS PalletID, inv.BoxNumber AS BoxNumber, inv.ItemCode AS ItemCode, inv.ItemGroup AS InventoryItemGroup,
            inv.Quantity AS Quantity, inv.AllocatedQty AS AllocatedQty, inv.Status AS Status,
            inv.CreatedBy AS CreatedBy, inv.CreatedAt AS CreatedAt, inv.UpdatedBy AS UpdatedBy, inv.UpdatedAt AS UpdatedAt,
            ${MASTER_PART_SELECT}
        `,
        fromJoin: `
            T_INVENTORY inv WITH (NOLOCK)
            ${MASTER_PART_JOIN.replace('%ALIAS%', 'inv')}
        `,
        whereSql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
        groupBy: null,
        sumSelect: 'SUM(inv.Quantity) AS Quantity, SUM(inv.AllocatedQty) AS AllocatedQty',
        replacements
    };
}

async function getInventoryDetailsReport(filters, { offset, pageSize, orderBy }) {
    const q = buildInventoryDetailsQuery(filters);
    return runPagedQuery({ ...q, orderBy, offset, pageSize });
}

async function getInventoryDetailsReportForExport(filters, { orderBy, maxRows }) {
    const q = buildInventoryDetailsQuery(filters);
    return runFullQuery({ ...q, orderBy, maxRows });
}

// ---------------------------------------------------------------------------
// Warehouse Stock Report — warehouse-wise, item-wise stock, plus a drill-down
// listing the box / pallet / location lines behind one warehouse + item.
//
// One stock line per (box, item), built from two sources (UNION ALL):
//   A) Boxes that have reached T_INVENTORY (location mapping done) — the
//      AVAILABLE, Quantity > 0 inventory rows, which already reflect picking.
//   B) Pre-binning COMPLETED boxes that have NOT reached T_INVENTORY yet —
//      quantities from T_PREBIN_ITEM; pallet (T_PALLET_MAPPING_BOX) and
//      location (T_LOCATION currently holding that pallet) shown when present,
//      NULL otherwise. A box is in exactly one source (NOT EXISTS on BoxNumber).
// Stage tells where the line is: PRE-BINNED / PALLET MAPPED / IN LOCATION.
// Master_Part is a plain LEFT JOIN: ItemCode is its primary key, so it can't
// multiply lines. (Don't switch to a per-row OUTER APPLY — Master_Part.ItemCode
// is VARCHAR vs NVARCHAR here, and the per-row lookup timed out at 40s.)
// ---------------------------------------------------------------------------
const STOCK_LINES_SOURCE = `
    (
        SELECT inv.WarehouseCode, inv.ItemCode, inv.ItemGroup, inv.BoxNumber, inv.PalletID, inv.PalletMappingID,
               inv.LocationCode, inv.RowCode, CAST(inv.Quantity AS DECIMAL(18, 3)) AS Quantity,
               CAST(ISNULL(inv.AllocatedQty, 0) AS DECIMAL(18, 3)) AS AllocatedQty,
               CAST('IN LOCATION' AS NVARCHAR(20)) AS Stage, inv.CreatedAt AS StockDate
        FROM T_INVENTORY inv WITH (NOLOCK)
        WHERE inv.Status = 'AVAILABLE' AND inv.Quantity > 0

        UNION ALL

        SELECT pb.WarehouseCode, pi.ItemCode, MAX(pi.ItemGroup) AS ItemGroup, pb.BoxNumber, pmb.PalletID, pmb.PalletMappingID,
               loc.LocationCode, loc.RowCode, CAST(SUM(pi.Qty) AS DECIMAL(18, 3)) AS Quantity, CAST(0 AS DECIMAL(18, 3)) AS AllocatedQty,
               CAST(CASE WHEN loc.LocationID IS NOT NULL THEN 'IN LOCATION'
                         WHEN pmb.PalletMappingBoxID IS NOT NULL THEN 'PALLET MAPPED'
                         ELSE 'PRE-BINNED' END AS NVARCHAR(20)) AS Stage,
               pb.CompletedAt AS StockDate
        FROM T_PREBIN_BOX pb WITH (NOLOCK)
        INNER JOIN T_PREBIN_ITEM pi WITH (NOLOCK) ON pi.PreBinBoxID = pb.PreBinBoxID
        LEFT JOIN T_PALLET_MAPPING_BOX pmb WITH (NOLOCK) ON pmb.BoxNumber = pb.BoxNumber
        LEFT JOIN T_LOCATION loc WITH (NOLOCK) ON pmb.PalletMappingID IS NOT NULL AND loc.CurrentPalletMappingID = pmb.PalletMappingID
        WHERE pb.Status = 'COMPLETED'
          AND NOT EXISTS (SELECT 1 FROM T_INVENTORY i WITH (NOLOCK) WHERE i.BoxNumber = pb.BoxNumber)
        GROUP BY pb.WarehouseCode, pi.ItemCode, pb.BoxNumber, pmb.PalletID, pmb.PalletMappingID, pmb.PalletMappingBoxID,
                 loc.LocationID, loc.LocationCode, loc.RowCode, pb.CompletedAt
        HAVING SUM(pi.Qty) > 0
    ) s`;
const STOCK_MASTER_PART_JOIN = MASTER_PART_JOIN.replace('%ALIAS%', 's');
const STOCK_SUM_SELECT = 'SUM(s.Quantity) AS Quantity, SUM(s.AllocatedQty) AS AllocatedQty, SUM(s.Quantity) - SUM(s.AllocatedQty) AS AvailableQty';
const STOCK_STAGE_SUM_SELECT = `
    SUM(CASE WHEN s.Stage = 'PRE-BINNED' THEN s.Quantity ELSE 0 END) AS PreBinnedQty,
    SUM(CASE WHEN s.Stage = 'PALLET MAPPED' THEN s.Quantity ELSE 0 END) AS PalletMappedQty,
    SUM(CASE WHEN s.Stage = 'IN LOCATION' THEN s.Quantity ELSE 0 END) AS InLocationQty`;

function buildWarehouseStockQuery(filters) {
    const conditions = [];
    const replacements = {};

    if (filters.warehouseCode) { conditions.push('s.WarehouseCode = :warehouseCode'); replacements.warehouseCode = filters.warehouseCode; }
    if (filters.itemCode) { conditions.push('s.ItemCode LIKE :itemCode'); replacements.itemCode = `%${filters.itemCode}%`; }
    if (filters.itemName) { conditions.push('mp.ItemName LIKE :itemName'); replacements.itemName = `%${filters.itemName}%`; }
    if (filters.itemGroup) { conditions.push('(s.ItemGroup LIKE :itemGroup OR mp.ItemGroup LIKE :itemGroup)'); replacements.itemGroup = `%${filters.itemGroup}%`; }
    if (filters.category) { conditions.push('mp.Category LIKE :category'); replacements.category = `%${filters.category}%`; }
    if (filters.stage) { conditions.push('s.Stage = :stage'); replacements.stage = filters.stage; }
    if (filters.search) {
        conditions.push(`(s.WarehouseCode LIKE :search OR s.ItemCode LIKE :search OR s.ItemGroup LIKE :search OR ${MASTER_PART_SEARCH})`);
        replacements.search = `%${filters.search}%`;
    }

    return {
        selectColumns: `
            s.WarehouseCode AS WarehouseCode, s.ItemCode AS ItemCode, MAX(s.ItemGroup) AS InventoryItemGroup,
            ${STOCK_SUM_SELECT}, ${STOCK_STAGE_SUM_SELECT},
            COUNT(DISTINCT s.LocationCode) AS LocationCount, COUNT(DISTINCT s.PalletID) AS PalletCount,
            COUNT(DISTINCT s.BoxNumber) AS BoxCount,
            MAX(mp.ItemCode) AS MasterItemCode, MAX(mp.ItemName) AS MasterItemName, MAX(mp.ItemGroup) AS MasterItemGroup,
            MAX(mp.Category) AS Category, MAX(mp.Description) AS Description, MAX(mp.Color) AS Color,
            MAX(mp.Size) AS Size, MAX(mp.Style) AS Style, MAX(mp.BinCapacity) AS BinCapacity
        `,
        fromJoin: `${STOCK_LINES_SOURCE} ${STOCK_MASTER_PART_JOIN}`,
        whereSql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
        groupBy: 's.WarehouseCode, s.ItemCode',
        sumSelect: `${STOCK_SUM_SELECT}, ${STOCK_STAGE_SUM_SELECT}`,
        replacements
    };
}

async function getWarehouseStockReport(filters, { offset, pageSize, orderBy }) {
    const q = buildWarehouseStockQuery(filters);
    return runPagedQuery({ ...q, orderBy, offset, pageSize });
}

async function getWarehouseStockReportForExport(filters, { orderBy, maxRows }) {
    const q = buildWarehouseStockQuery(filters);
    return runFullQuery({ ...q, orderBy, maxRows });
}

function buildWarehouseStockDetailsQuery(filters) {
    // warehouseCode + itemCode are required (validated in the service) and matched exactly —
    // this is the drill-down for one row of the grouped report above.
    const conditions = ['s.WarehouseCode = :warehouseCode', 's.ItemCode = :itemCode'];
    const replacements = { warehouseCode: filters.warehouseCode, itemCode: filters.itemCode };

    if (filters.stage) { conditions.push('s.Stage = :stage'); replacements.stage = filters.stage; }
    if (filters.search) {
        conditions.push('(s.RowCode LIKE :search OR s.LocationCode LIKE :search OR s.PalletID LIKE :search OR s.BoxNumber LIKE :search OR s.Stage LIKE :search)');
        replacements.search = `%${filters.search}%`;
    }

    return {
        selectColumns: `
            s.WarehouseCode AS WarehouseCode, s.ItemCode AS ItemCode, s.Stage AS Stage, s.RowCode AS RowCode,
            s.LocationCode AS LocationCode, s.PalletMappingID AS PalletMappingID, s.PalletID AS PalletID,
            s.BoxNumber AS BoxNumber, s.Quantity AS Quantity, s.AllocatedQty AS AllocatedQty,
            s.Quantity - s.AllocatedQty AS AvailableQty, s.StockDate AS StockDate
        `,
        fromJoin: STOCK_LINES_SOURCE,
        whereSql: `WHERE ${conditions.join(' AND ')}`,
        groupBy: null,
        sumSelect: STOCK_SUM_SELECT,
        replacements
    };
}

async function getWarehouseStockDetailsReport(filters, { offset, pageSize, orderBy }) {
    const q = buildWarehouseStockDetailsQuery(filters);
    return runPagedQuery({ ...q, orderBy, offset, pageSize });
}

async function getWarehouseStockDetailsReportForExport(filters, { orderBy, maxRows }) {
    const q = buildWarehouseStockDetailsQuery(filters);
    return runFullQuery({ ...q, orderBy, maxRows });
}

// ---------------------------------------------------------------------------
// Picking History Report — T_PICKING_HISTORY (one row per completed picking
// transaction) left-joined to Master_Part for item name.
// ---------------------------------------------------------------------------
function buildPickingHistoryQuery(filters) {
    const conditions = [];
    const replacements = {};

    if (filters.palletId) { conditions.push('ph.PalletID LIKE :palletId'); replacements.palletId = `%${filters.palletId}%`; }
    if (filters.boxNumber) { conditions.push('ph.BoxNumber LIKE :boxNumber'); replacements.boxNumber = `%${filters.boxNumber}%`; }
    if (filters.itemCode) { conditions.push('ph.ItemCode LIKE :itemCode'); replacements.itemCode = `%${filters.itemCode}%`; }
    if (filters.status) { conditions.push('ph.Status = :status'); replacements.status = filters.status; }
    if (filters.pickedBy) { conditions.push('ph.PickedBy LIKE :pickedBy'); replacements.pickedBy = `%${filters.pickedBy}%`; }
    if (filters.fromDate) { conditions.push('CAST(ph.PickedAt AS DATE) >= :fromDate'); replacements.fromDate = filters.fromDate; }
    if (filters.toDate) { conditions.push('CAST(ph.PickedAt AS DATE) <= :toDate'); replacements.toDate = filters.toDate; }
    if (filters.search) {
        conditions.push(`(ph.PalletID LIKE :search OR ph.BoxNumber LIKE :search OR ph.ItemCode LIKE :search OR ph.ItemGroup LIKE :search
            OR ph.WarehouseCode LIKE :search OR ph.LocationCode LIKE :search OR ph.Status LIKE :search OR ph.PickedBy LIKE :search
            OR ${MASTER_PART_SEARCH})`);
        replacements.search = `%${filters.search}%`;
    }

    return {
        selectColumns: `
            ph.PickingID AS PickingID, ph.InventoryID AS InventoryID, ph.PalletMappingID AS PalletMappingID,
            ph.PalletID AS PalletID, ph.BoxNumber AS BoxNumber, ph.ItemCode AS ItemCode, ph.ItemGroup AS ItemGroup,
            ph.WarehouseCode AS WarehouseCode, ph.LocationCode AS LocationCode, ph.PickedQty AS PickedQty,
            ph.RemainingQty AS RemainingQty, ph.Status AS Status, ph.PickedBy AS PickedBy, ph.PickedAt AS PickedAt,
            ${MASTER_PART_SELECT}
        `,
        fromJoin: `
            T_PICKING_HISTORY ph WITH (NOLOCK)
            ${MASTER_PART_JOIN.replace('%ALIAS%', 'ph')}
        `,
        whereSql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
        groupBy: null,
        sumSelect: 'SUM(ph.PickedQty) AS PickedQty',
        replacements
    };
}

async function getPickingHistoryReport(filters, { offset, pageSize, orderBy }) {
    const q = buildPickingHistoryQuery(filters);
    return runPagedQuery({ ...q, orderBy, offset, pageSize });
}

async function getPickingHistoryReportForExport(filters, { orderBy, maxRows }) {
    const q = buildPickingHistoryQuery(filters);
    return runFullQuery({ ...q, orderBy, maxRows });
}

module.exports = {
    getPreBinningReport,
    getPreBinningReportForExport,
    getPalletMappingReport,
    getPalletMappingReportForExport,
    getLocationMappingReport,
    getLocationMappingReportForExport,
    getInventoryDetailsReport,
    getInventoryDetailsReportForExport,
    getWarehouseStockReport,
    getWarehouseStockReportForExport,
    getWarehouseStockDetailsReport,
    getWarehouseStockDetailsReportForExport,
    getPickingHistoryReport,
    getPickingHistoryReportForExport
};
