const { sequelize } = require('../config/database');
const { TableHints } = require('sequelize');

async function tableHeader(type){
  const model = require(`../models/Table_Header`);
  const result = await model.findAll({ attributes: ['details'],where:{type:type}, tableHint: TableHints.NOLOCK });
  if(result && result[0].details){
    return result[0].details;
  }
  else {
    return [];
  }
}

async function inventoryList(req, res) {
    try {
        let status = 1;
        let message = "";
        let tableType;
        tableType = 'InventoryList';
        const { type = '', itemCode = '', itemname = '', itemgroup = '', binid = '', craneid = '', exportFormat = '', sortKey = '', sortFormat = '' } = req.query;

        let invQuery;
        let cntQry;
        let exportStr = `TOP(500)`;
        if(exportFormat != '') {
            exportStr = ``;
        }

        if (type == 'Inventory')
        {
            if(itemname || itemCode || itemgroup || binid || craneid){
                invQuery = `WITH tp AS (
                    SELECT scm.InCrane, ls.BinID, ls.EquipmentNo, ls.LocationID, ls.BinWeight,
                        ROW_NUMBER() OVER (PARTITION BY ls.BinID ORDER BY scm.InCrane) AS row_num
                    FROM SideCraneMap scm WITH (NOLOCK)
                    INNER JOIN LocationSpecification ls WITH (NOLOCK) ON scm.SideID = ls.Side
                    WHERE BinID IS NOT NULL
                )
                SELECT ${exportStr} tp.InCrane AS CraneID, tp.EquipmentNo AS ShuttleID,
                    COALESCE(inv.AisleNo, '') AS AisleNo, inv.BinID, inv.ItemCode AS MaterialCode,
                    inv.ItemName AS MaterialName, tp.LocationID, inv.ItemGroup AS MaterialGroup,
                    inv.Quantity, inv.OutQuantity ,inv.UserName,
                    (CONVERT(VARCHAR(10), inv.UpdatedDate, 103) + ' ' + CONVERT(VARCHAR(10), inv.UpdatedDate, 108)) AS AccessedDate,
                    inv.GrossWeight, tp.BinWeight
                FROM Inv_PalletDetails inv WITH (NOLOCK)
                LEFT JOIN tp ON inv.BinID = tp.BinID AND tp.row_num = 1
                WHERE inv.ItemCode != '' AND inv.ItemCode IS NOT NULL`;
            }
            else{
                invQuery = `WITH tp AS (
                    SELECT scm.InCrane, ls.BinID, ls.EquipmentNo, ls.LocationID, ls.BinWeight,
                        ROW_NUMBER() OVER (PARTITION BY ls.BinID ORDER BY scm.InCrane) AS row_num
                    FROM SideCraneMap scm WITH (NOLOCK)
                    INNER JOIN LocationSpecification ls WITH (NOLOCK) ON scm.SideID = ls.Side
                    WHERE BinID IS NOT NULL
                )
                SELECT ${exportStr} tp.InCrane AS CraneID, tp.EquipmentNo AS ShuttleID,
                    COALESCE(inv.AisleNo, '') AS AisleNo, inv.BinID, inv.ItemCode AS MaterialCode,
                    inv.ItemName AS MaterialName, tp.LocationID, inv.ItemGroup AS MaterialGroup,
                    inv.Quantity, inv.OutQuantity ,inv.UserName,
                    (CONVERT(VARCHAR(10), inv.UpdatedDate, 103) + ' ' + CONVERT(VARCHAR(10), inv.UpdatedDate, 108)) AS AccessedDate,
                    inv.GrossWeight, tp.BinWeight
                FROM Inv_PalletDetails inv WITH (NOLOCK)
                LEFT JOIN tp ON inv.BinID = tp.BinID AND tp.row_num = 1
                WHERE inv.ItemCode != '' AND inv.ItemCode IS NOT NULL`;
            }

            cntQry = `SELECT COUNT(1) AS TotalCount FROM Inv_PalletDetails WITH (NOLOCK) WHERE 1=1`;

            if (itemCode) {
                invQuery += ` AND inv.ItemCode LIKE '${itemCode}%'`;
                cntQry += ` AND ItemCode LIKE '${itemCode}%'`;
            }
            if (itemname) {
                invQuery += ` AND inv.ItemName LIKE '${itemname}%'`;
                cntQry += ` AND ItemName LIKE '${itemname}%'`;
            }
            if (itemgroup) {
                invQuery += ` AND inv.ItemGroup LIKE '${itemgroup}%'`;
                cntQry += ` AND ItemGroup LIKE '${itemgroup}%'`;
            }
            if (craneid && craneid !== 'All') {
                invQuery += ` AND tp.InCrane LIKE '${craneid}%'`;
                cntQry += ` AND tp.InCrane LIKE '${craneid}%'`;
            }
            if (binid) {
                invQuery += ` AND inv.BinID LIKE '${binid}%'`;
                cntQry += ` AND BinID LIKE '${binid}%'`;
            }
            if(sortKey){
                invQuery += ` order by ${sortKey}  ${sortFormat}`;
            }else{
                invQuery += ` order by tp.InCrane desc, UpdatedDate desc`;
            }

        }
        else if(type == 'TotalInventory')
        {
            tableType = 'TotalInventoryList';
            invQuery = `SELECT ${exportStr}
                            Inv.ItemCode,
                            Inv.ItemName,
                            Inv.ItemGroup,
                            COALESCE(Inv.AisleNo, '') as AisleNo,
                            Ls.EquipmentNo as ShuttleID,
                            COUNT(DISTINCT Inv.BinID) AS TotalBin,
                            SUM(Inv.Quantity) AS TotalQty,
                            SUM(Inv.Quantity) / NULLIF(COUNT(DISTINCT Inv.BinID), 0) AS QtyPerBin
                        FROM
                            Inv_PalletDetails Inv WITH (NOLOCK)
                        INNER JOIN
                            LocationSpecification Ls WITH (NOLOCK) ON Ls.BinID = Inv.BinID
                        LEFT JOIN
                            PalletRequestDetails PRD WITH (NOLOCK) ON PRD.BinID = Inv.BinID AND PRD.Status NOT IN ('C', 'E', 'R', 'D')
                        WHERE
                            Inv.ItemCode IS NOT NULL AND Inv.ItemCode != ''
                            AND Inv.ItemName IS NOT NULL AND Inv.ItemName != ''
                            AND Inv.ItemGroup IS NOT NULL AND Inv.ItemGroup != ''
                            AND Inv.Quantity > 0
                            AND PRD.BinID IS NULL`;

            cntQry =`SELECT COUNT(1) AS TotalCount
                    FROM (
                        SELECT Inv.ItemCode
                        FROM Inv_PalletDetails Inv WITH (NOLOCK)
                        INNER JOIN LocationSpecification Ls WITH (NOLOCK)
                            ON Ls.BinID = Inv.BinID
                        LEFT JOIN PalletRequestDetails PRD WITH (NOLOCK)
                            ON PRD.BinID = Inv.BinID AND PRD.Status NOT IN ('C', 'E', 'R', 'D')
                        WHERE
                            Inv.ItemCode IS NOT NULL AND Inv.ItemCode != ''
                            AND Inv.ItemName IS NOT NULL AND Inv.ItemName != ''
                            AND Inv.ItemGroup IS NOT NULL AND Inv.ItemGroup != ''
                            AND Inv.Quantity > 0
                            AND PRD.BinID IS NULL`;

            if (itemCode) {
                invQuery += ` AND Inv.ItemCode LIKE '%${itemCode}%'`;
                cntQry += ` AND Inv.ItemCode LIKE '%${itemCode}%'`;
            }
            if (itemname) {
                invQuery += ` AND Inv.ItemName LIKE '%${itemname}%'`;
                cntQry += ` AND Inv.ItemName LIKE '%${itemname}%'`;
            }
            if (itemgroup) {
                invQuery += ` AND Inv.ItemGroup LIKE '%${itemgroup}%'`;
                cntQry+= ` AND Inv.ItemGroup LIKE '%${itemgroup}%'`;
            }

            invQuery += ` GROUP BY Inv.ItemCode, Inv.ItemName, Inv.ItemGroup, Inv.AisleNo, Ls.EquipmentNo
                        HAVING SUM(Inv.Quantity) > 0 AND COUNT(DISTINCT Inv.BinID) > 0
                        ORDER BY Inv.ItemCode;`;
            cntQry += ` GROUP BY Inv.ItemCode, Inv.ItemName, Inv.ItemGroup, Inv.AisleNo, Ls.EquipmentNo
                        HAVING SUM(Inv.Quantity) > 0 AND COUNT(DISTINCT Inv.BinID) > 0
                    ) AS GroupedResults;`;
        }
        else if(type == 'TotalInventoryAisle')
        {
            tableType = 'TotalInventoryListAisle';

            invQuery = `SELECT
                    Inv.ItemCode,
                    SUM(CASE WHEN Inv.AisleNo = '1' THEN Inv.Quantity ELSE 0 END) AS Aisle1Qty,
                    COUNT(DISTINCT CASE WHEN Inv.AisleNo = '1' THEN Inv.BinID END) AS Aisle1Bins,

                    SUM(CASE WHEN Inv.AisleNo = '2' THEN Inv.Quantity ELSE 0 END) AS Aisle2Qty,
                    COUNT(DISTINCT CASE WHEN Inv.AisleNo = '2' THEN Inv.BinID END) AS Aisle2Bins,

                    SUM(CASE WHEN Inv.AisleNo = '3' THEN Inv.Quantity ELSE 0 END) AS Aisle3Qty,
                    COUNT(DISTINCT CASE WHEN Inv.AisleNo = '3' THEN Inv.BinID END) AS Aisle3Bins,

                    SUM(CASE WHEN Inv.AisleNo = '4' THEN Inv.Quantity ELSE 0 END) AS Aisle4Qty,
                    COUNT(DISTINCT CASE WHEN Inv.AisleNo = '4' THEN Inv.BinID END) AS Aisle4Bins,

                    SUM(Inv.Quantity) AS TotalQty,
                    COUNT(DISTINCT Inv.BinID) AS TotalBins
                    FROM
                    Inv_PalletDetails Inv WITH (NOLOCK)
                    INNER JOIN
                    LocationSpecification Ls WITH (NOLOCK) ON Ls.BinID = Inv.BinID
                    LEFT JOIN
                    PalletRequestDetails PRD WITH (NOLOCK) ON PRD.BinID = Inv.BinID
                        AND PRD.Status NOT IN ('C','PCC','PC', 'E', 'R', 'D')
                    WHERE
                    Inv.ItemCode IS NOT NULL AND Inv.ItemCode != ''
                    AND Inv.Quantity > 0
                    AND PRD.BinID IS NULL`;

            if (itemCode) {
                invQuery += ` AND Inv.ItemCode LIKE '%${itemCode}%'`;
            }

            invQuery += ` GROUP BY Inv.ItemCode
                        HAVING SUM(Inv.Quantity) > 0 AND COUNT(DISTINCT Inv.BinID) > 0
                        ORDER BY Inv.ItemCode ASC`;
        }
        let totalCount = 0;
        console.log("cntQry", cntQry)
        if(type == 'Inventory'){
            totalCount = await sequelize.query(cntQry, { type: sequelize.QueryTypes.SELECT });
        }
        else (type == 'TotalInventory')
        {
            totalCount = await sequelize.query(cntQry, { type: sequelize.QueryTypes.SELECT });
        }


        const [list, metadata] = await sequelize.query(invQuery);

        const tblheader = await tableHeader(tableType);
        if (exportFormat === '') {
            res.status(200).json({ status: status, message: message, header: tblheader, data: list, totalRecord: totalCount[0]?.TotalCount});
        }
        else {
            const { exportData } = require('../models/Export');
            await exportData(res, exportFormat, `Inventory Report`, tblheader, list);
        }
    } catch (error) {
        console.log(error);
        res.status(202).json({ status: 0, message: error.message });
    }
}

module.exports = {
    inventoryList,
};
