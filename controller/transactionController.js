const { Op, literal } = require('sequelize');
const moment = require('moment');
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

async function palletRequestList(req, res) {
    try {
        let status=0;
        let message="Invalid Request";
        let EquipmentType = req.body.equipmentType;
        const {FromDate='',ToDate='',StatusValue='',ProcessType='',CraneID='',BinID='',ShuttleID= '',AisleNo='',exportFormat=''} = req.query
        let startDate = moment(FromDate).startOf('day').format('YYYY-MM-DD HH:mm:ss')
        let endDate = moment(ToDate).endOf('day').format('YYYY-MM-DD HH:mm:ss')
        const result = await sequelize.query(`EXEC SP_ShowPalletRequestlist @Type = :Type,@FromDate= :FromDate,@ToDate= :ToDate,@StatusValue= :StatusValue,@ProcessType= :ProcessType,@AisleNo= :AisleNo,@ShuttleID= :ShuttleID,@BinID= :BinID,@load= :load`,
            {
                replacements: {
                    Type: 'Show',
                    FromDate: startDate
                    ,ToDate:endDate
                    ,StatusValue:StatusValue
                    ,ProcessType:ProcessType
                    ,AisleNo:(AisleNo??'All'),
                    ShuttleID:(ShuttleID??'All')
                    ,BinID:(BinID??'All')
                    ,load:'dgv' 
                },
                Type: 'Show'
            }
        );

        // const timezone = 'Asia/Kolkata';  // Change this to your desired timezone
        
        // result[0] = result[0].map(item => {
        //     if (item.ReqTime) {
        //         item.ReqTime = moment(item.ReqTime).tz(timezone).format('YYYY-MM-DD HH:mm:ss'); // Convert and format
        //     }
        //     if (item.CompletedTime) {
        //         item.CompletedTime = moment(item.CompletedTime).tz(timezone).format('YYYY-MM-DD HH:mm:ss'); // Convert and format if needed
        //     }
        //     return item;
        // });
        
        if(result)
        {
            status=1;
            message="Crane Alarm Reseted";
        }
        else
        {
            status=0
            message="Error Crane Alarm Reset";
        }
        
        const header=await tableHeader('BinRequest');

        if(exportFormat=='')
        {
            return res.status(200).json({ status: status, message: message,header,data:result[0] });
        }
        else
        {
            const {exportData} = require('../models/Export');
            await exportData(res,exportFormat,`Pallet Request Report`,header, result[0]);      
        }
    } 
    catch (error) 
    {
        return res.status(202).json({status: 0, message: error.message});
    }
}

async function toteliftRequestList(req, res) {
    try {
        let status=0;
        let message="Invalid Request";
        let EquipmentType = req.body.equipmentType;
        const {FromDate='',ToDate='',StatusValue='',ProcessType='',AisleNo='',BinID='',EquipmentNo= '',exportFormat=''} = req.query;
        let startDate = moment(FromDate).startOf('day').format('YYYY-MM-DD HH:mm:ss')
        let endDate = moment(ToDate).endOf('day').format('YYYY-MM-DD HH:mm:ss')
        

        const result = await sequelize.query(`EXEC SP_ToteLiftRequestDetails @Type = :Type,@FromDate= :FromDate,@ToDate= :ToDate,@StatusValue= :StatusValue,@ProcessType= :ProcessType,@AisleNo= :AisleNo,@EquipmentNo= :EquipmentNo,@BinID= :BinID,@load= :load`,
            {
                replacements: {
                    Type: 'Show',
                    load:'dgv',
                    FromDate:startDate
                    ,ToDate:endDate
                    ,StatusValue:StatusValue
                    ,ProcessType:ProcessType
                    ,AisleNo:(AisleNo??'All')
                    ,BinID:(BinID??'All'),
                    EquipmentNo:(EquipmentNo??'All')                    
                },
                Type: 'Show'
            }
        );
        
        if(result)
        {
            status=1;
            message="Crane Alarm Reseted";
        }
        else
        {
            status=0
            message="Error Crane Alarm Reset";
        }
        
        const header=await tableHeader('ToteLiftRequest');
        
        if(exportFormat=='')
        {
            return res.status(200).json({ status: status, message: message,header,data:result[0] });
        }
        else
        {
            const {exportData} = require('../models/Export');
            await exportData(res,exportFormat,`Pallet Request Report`,header,result[0]);      
        }
    } 
    catch (error) 
    {
        return res.status(202).json({status: 0, message: error.message});
    }
}

async function itemInventoryList(req, res) {
    try {
        const Inv_PalletDetails_Transaction = require(`../models/transaction/InvPalletDetailTransaction`);
        let {
            ItemCode = '',
            ItemGroup = '',
            ItemName = '',
            Type = '',
            FromDate,
            ToDate,
            ShuttleID = '',
            page = 1,
            pageSize = 10,
            exportFormat = '',
            PartNo = '',
            PartGrp = '',
            AisleNo = '',
            BinID = ''
        } = req.query;

        // Parse PartNo if provided
        if (PartNo.includes('/')) {
            [ItemCode, ItemName] = PartNo.split('/');
        }

        let queryOptions = {
            attributes: [
                'UpdatedDate',
                [sequelize.literal("(CONVERT(VARCHAR(8), UpdatedDate, 103)+' '+CONVERT(VARCHAR(8), UpdatedDate, 108))"), 'FormattedUpdatedDate'],
                'BinID', 'AisleNo', 'ShuttleID', 'ItemCode', 'ItemName', 'ItemGroup', 
                'Category', 'Quantity', 'BufferQty', ['InQuantity', 'InQty'], 
                ['OutQuantity', 'OutQty'], ['GrossWeight', 'GrossWeight'], 'UOM', 'UserName'
            ],
            where: {
                ItemCode: { [Op.ne]: '' },
                ItemCode: { [Op.like]: `%${ItemCode}%` },
                ItemGroup: { [Op.like]: `%${ItemGroup}%` },
                ItemName: { [Op.like]: `%${ItemName}%` },
                BinID: { [Op.like]: `%${BinID}%` },
            },
            order: [['UpdatedDate', 'DESC']],
            limit: 500,
            tableHint: TableHints.NOLOCK
        };

        if (Type === 'In') 
        {
            queryOptions.where.InQuantity = { [Op.ne]: 0 };
        } 
        else if (Type === 'Out') 
        {
            queryOptions.where.OutQuantity = { [Op.ne]: 0 };
        }

        // Format FromDate and ToDate as YYYY-MM-DD to remove any time component
        if (FromDate) FromDate = moment(FromDate).format('YYYY-MM-DD');
        if (ToDate) ToDate = moment(ToDate).format('YYYY-MM-DD');

        // Add date filters using only the date component
        if (FromDate && ToDate) 
        {
            queryOptions.where.UpdatedDate = sequelize.where(
                sequelize.fn('CONVERT', sequelize.literal('DATE'), sequelize.col('UpdatedDate')),
                { [Op.between]: [FromDate, ToDate] }
            );
        } 
        else if (FromDate) 
        {
            queryOptions.where.UpdatedDate = sequelize.where(
                sequelize.fn('CONVERT', sequelize.literal('DATE'), sequelize.col('UpdatedDate')),
                { [Op.gte]: FromDate }
            );
        } else if (ToDate) {
            queryOptions.where.UpdatedDate = sequelize.where(
                sequelize.fn('CONVERT', sequelize.literal('DATE'), sequelize.col('UpdatedDate')),
                { [Op.lte]: ToDate }
            );
        }

        if (ShuttleID && ShuttleID !== 'All') {
            queryOptions.where.ShuttleID = ShuttleID;
        }
        if (AisleNo && AisleNo !== 'All') {
            queryOptions.where.AisleNo = AisleNo;
        }
        if( PartGrp && PartGrp !== 'All') {
            queryOptions.where.ItemGroup = PartGrp;
        } 
        const results = await Inv_PalletDetails_Transaction.findAndCountAll(queryOptions);

        const header = await tableHeader('ItemTransaction');
        if (exportFormat === '') 
        {
            res.status(200).json({ status: 1, message: "Success", totalCount: results.count, header, data: results.rows });
        }
        else 
        { 
            const { exportData } = require('../models/Export');
            await exportData(res, exportFormat, `Item Inventory Report`, header, results.rows);      
        }
    } 
    catch (error) 
    { 
        res.status(202).json({ status: 0, message: error.message });
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
 
        // select tp.InCrane as CraneID, tp.EquipmentNo as ShuttleID, COALESCE(inv.AisleNo, '') as AisleNo, inv.BinID, inv.ItemCode as MaterialCode, inv.ItemName as MaterialName, tp.LocationID, inv.ItemGroup as MaterialGroup, inv.Quantity, inv.UserName, (CONVERT(VARCHAR(10), inv.UpdatedDate, 103) + ' ' + CONVERT(VARCHAR(10), inv.UpdatedDate, 108)) as AccessedDate, inv.GrossWeight, tp.BinWeight
        //                 from Inv_PalletDetails inv
        //                 left join
        //                 (select scm.InCrane, ls.BinID, ls.EquipmentNo, ls.LocationID, ls.BinWeight
        //                  from SideCraneMap scm
        //                  inner join LocationSpecification ls on scm.SideID = ls.Side
        //                  where BinID is not null) tp
        //                 on inv.BinID = tp.BinID
        //                 where ItemCode != '' and ItemCode is not null and 1=1
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
 
            // invQuery = `select tp.InCrane as CraneID,
            //        tp.EquipmentNo as ShuttleID,
            //        COALESCE(inv.AisleNo, '') as AisleNo,
            //        inv.BinID,
            //        inv.ItemCode as MaterialCode,
            //        inv.ItemName as MaterialName,
            //        tp.LocationID,
            //        inv.ItemGroup as MaterialGroup,
            //        inv.Quantity,
            //        inv.UserName,
            //        inv.UpdatedDate as AccessedDate,  -- No conversion, just select the date
            //        inv.GrossWeight,
            //        tp.BinWeight
            // from Inv_PalletDetails inv
            // left join
            //     (select scm.InCrane,
            //             ls.BinID,
            //             ls.EquipmentNo,
            //             ls.LocationID,
            //             ls.BinWeight
            //      from SideCraneMap scm
            //      inner join LocationSpecification ls on scm.SideID = ls.Side
            //      where BinID is not null) tp
            // on inv.BinID = tp.BinID
            // where ItemCode != ''
            // and ItemCode is not null
            // and 1=1`;
 
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

async function getFilters(req, res) {
    try 
    {
        const { PartGroup } = req.query;
        const InvPalletDetailsTransaction = require(`../models/transaction/InvPalletDetailTransaction`);

        const equipmentNos = await InvPalletDetailsTransaction.findAll({
            attributes: [[sequelize.fn('DISTINCT', sequelize.col('AisleNo')), 'AisleNo']],
            order: [['AisleNo', 'ASC']],
            tableHint: TableHints.NOLOCK
        });

        const ShuttleID = await InvPalletDetailsTransaction.findAll({
            attributes: [[sequelize.fn('DISTINCT', sequelize.col('ShuttleID')), 'ShuttleID']],
            order: [['ShuttleID', 'ASC']],
            tableHint: TableHints.NOLOCK
        });

        const partGroups = await InvPalletDetailsTransaction.findAll({
            attributes: [[sequelize.fn('DISTINCT', sequelize.col('ItemGroup')), 'ItemGroup']],
            order: [['ItemGroup', 'ASC']],
            tableHint: TableHints.NOLOCK
        });

        const partNos = await InvPalletDetailsTransaction.findAll({
            attributes: [[sequelize.fn('DISTINCT', sequelize.col('ItemCode')), 'ItemCode'],'ItemGroup'],
            order: [['ItemCode', 'ASC']],
            tableHint: TableHints.NOLOCK
        });

        const partNames = await InvPalletDetailsTransaction.findAll({
            attributes: [
                [sequelize.fn('DISTINCT', sequelize.col('ItemName')), 'ItemName'],
                'ItemCode',
                'ItemGroup'
            ],
            order: [['ItemName', 'ASC']],
            tableHint: TableHints.NOLOCK
        });

        // Prepare response object with filter values
        const response = {
        status: 1,
        message: 'Success',
        filters: {
            EquipmentNo: equipmentNos.filter(item => item.AisleNo != null).map(item => ({EquipmentNo:item.AisleNo})),
            ShuttleID: ShuttleID.filter(item => item.ShuttleID != null).map(item => ({ShuttleID:item.ShuttleID})),
            PartGroup: partGroups.filter(item => item.ItemGroup != null).map(item => ({PartGroup:item.ItemGroup})),
            PartNo: partNos.map(item => ({
                PartGroup: item.ItemGroup,
                PartNo: item.ItemCode,
            })),
            PartName: partNames.map(item => ({
                PartGroup: item.ItemGroup,
                PartNo: item.ItemCode,
                PartName: item.ItemName
            }))
        }
        };

        res.status(200).json(response);
    } 
    catch (error) {
        res.status(202).json({status: 0, message: error.message});
    }
}

async function craneStatus(req, res) {
  try {
    const { EquipmentNo } = req.body;
    let query = `select TOP 1 StatusReport,CreatedTime from CranePositionReport WITH (NOLOCK) where 1=1 `;


    if (EquipmentNo != '') {
      query += ` AND  EquipmentNo=${EquipmentNo}`;
    }

    const result = await sequelize.query(query, { type: sequelize.QueryTypes.SELECT });
    
    res.status(200).json({ status: 1, message: 'Success',data: result });
  } catch (error) {
    res.status(200).json({ status: 0, message: 'Success' });
  }
}


async function locationStatus(req, res) {
    try 
    {
        const { AisleNo, Side  } = req.body;

        let query = `SELECT L.EquipmentNo,L.Side,L.Level,L.Bay,
        (SELECT COUNT(BinID) FROM LocationSpecification WITH (NOLOCK) WHERE EquipmentNo=L.EquipmentNo AND Level=L.Level AND Bay=L.Bay AND Side=L.Side AND BinID IS NOT NULL) as DeepAvlCount
        FROM LocationSpecification AS L WITH (NOLOCK) WHERE 1=1`;

        if (AisleNo != '' && AisleNo != undefined) 
        {
            query += ` AND  L.AisleNo=${AisleNo}`;
        }

        if (Side != '' && Side != undefined) 
        {
            query += ` AND  L.Side=${Side}`;
        }

        // if use quer1 then comment this
        query += `  GROUP BY L.EquipmentNo,L.Side,L.Level,L.Bay ORDER BY L.Side,L.Level,L.Bay ASC`;

        const result = await sequelize.query(query, { type: sequelize.QueryTypes.SELECT });
        const data=result??[];
        const levels = Array.from(new Set(data.map(item => item.Level)));
        const bays = Array.from(new Set(data.map(item => item.Bay)));

        res.status(200).json({ status: 1, message: 'Success', levels, bays, data: result });
    } 
    catch (error) 
    {
        res.status(202).json({ status: 0, message: error.message });
    }
}

const getERPConfirmation = async(req, res) => {
    try {
        const { fromDate, toDate } = req.body;
        const today = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss');
        
        // Determine start and end dates based on input
        let startDate = fromDate
            ? moment(fromDate).startOf('day').format('YYYY-MM-DD HH:mm:ss')
            : moment(today).startOf('day').format('YYYY-MM-DD HH:mm:ss');
        
        let endDate = toDate
            ? moment(toDate).endOf('day').format('YYYY-MM-DD HH:mm:ss')
            : today;
        
        // Execute the query with filters based on CreatedDateTime
        const result = await sequelize.query(
            `SELECT 
                [Id],
                [ERPID],
                [ReqDateTime],
                [BinID],
                [ItemCode],
                [ItemName],
                [ItemGroup],
                [Category],
                [UOM],
                [Size],
                [AvlQuantity],
                [ReqQuantity],
                [BalanceQuantity],
                [Confirm],
                [Status],
                [OrderNo],
                [Floor],
                [GTPPickingStation],
                [CreatedDateTime],
                [UpdateDateTime],
                [PickedQuantity],
                [Rejection_Reason],
                [Reject],
                [GTPReached],
                [PickCategory]
            FROM [Craftsman_MLS].[dbo].[RetrievalConfirmation] WITH (NOLOCK)
            WHERE [CreatedDateTime] BETWEEN :startDate AND :endDate`,
            {
                replacements: { startDate, endDate },
                type: sequelize.QueryTypes.SELECT,
            }
        );
        
        // Transform data for frontend
        const data = result.map((record) => ({
            id: record.Id,
            erpId: record.ERPID,
            reqDateTime: record.ReqDateTime,
            binID: record.BinID,
            itemCode: record.ItemCode,
            itemName: record.ItemName,
            itemGroup: record.ItemGroup,
            category: record.Category,
            uom: record.UOM,
            size: record.Size,
            avlQuantity: record.AvlQuantity,
            reqQuantity: record.ReqQuantity,
            balanceQuantity: record.BalanceQuantity,
            confirm: record.Confirm,
            status: record.Status,
            orderNo: record.OrderNo,
            floor: record.Floor,
            gtPickingStation: record.GTPPickingStation,
            createdDateTime: record.CreatedDateTime,
            updateDateTime: record.UpdateDateTime,
            pickedQuantity: record.PickedQuantity,
            rejectionReason: record.Rejection_Reason,
            reject: record.Reject,
            gtReached: record.GTPReached,
            pickCategory: record.PickCategory,
        }));
        
        // Define the header structure for the table
        const header = await tableHeader('Retrieval Confirmation');
        
        // Respond with the data and header
        res.status(200).send({ status: 1, data, header });
    } catch (error) {
        res.status(500).send({ status: 0, message: error.message });
    }
  }

  const getStoreRetrieveSummary = async (req, res) => {
    try {
        const { fromDate, toDate } = req.body; 
        let FromDate = fromDate;
        let ToDate = toDate;

        const uniqueDatesQuery = `
            SELECT 
                CONVERT(DATE, ReqTime) AS ReqDate,
                COUNT(*) AS RecordCount
            FROM 
                PalletRequestDetails WITH (NOLOCK)
            WHERE 
                CONVERT(DATE, ReqTime) BETWEEN :FromDate AND :ToDate
            GROUP BY 
                CONVERT(DATE, ReqTime)
            UNION ALL
            SELECT 
                NULL AS ReqDate, 
                COUNT(*) AS RecordCount
            FROM 
                PalletRequestDetails WITH (NOLOCK)
            WHERE 
                CONVERT(DATE, ReqTime) BETWEEN :FromDate AND :ToDate
            ORDER BY 
                ReqDate ASC;
        `;

        const uniqueDatesResult = await sequelize.query(uniqueDatesQuery, {
            type: sequelize.QueryTypes.SELECT,
            replacements: { FromDate, ToDate }
        });
        const uniqueDates = uniqueDatesResult.filter(row => row.ReqDate !== null);

        const formattedResponse = await Promise.all(uniqueDates.map(async ({ ReqDate }) => {
            const startDate = moment(ReqDate).startOf('day').format('YYYY-MM-DD HH:mm:ss');
            const endDate = moment(ReqDate).endOf('day').format('YYYY-MM-DD HH:mm:ss');

            const result = await sequelize.query(`EXEC SP_ShowPalletRequestlist 
                @Type = :Type,
                @FromDate = :FromDate,
                @ToDate = :ToDate,
                @StatusValue = :StatusValue,
                @ProcessType = :ProcessType,
                @AisleNo = :AisleNo,
                @ShuttleID = :ShuttleID,
                @BinID = :BinID,
                @load = :load`, {
                replacements: {
                    Type: 'Show',
                    FromDate: startDate,
                    ToDate: endDate,
                    StatusValue: '',
                    ProcessType: '',
                    AisleNo: 'All',
                    ShuttleID: 'All',
                    BinID: 'All',
                    load: 'dgv'
                }
            });

            const aisleData = Array.from({ length: 4 }, (_, i) => ({
                [`Aisle${i + 1}`]: { In: 0, Out: 0, Total: 0 }
            }));

            let totalIn = 0, totalOut = 0;

            result[0].forEach(item => {
                const aisleIndex = item.AisleNo - 1;
                if (aisleIndex >= 0 && aisleIndex < aisleData.length) {
                    const aisleKey = `Aisle${item.AisleNo}`;
                    if (item.ReqType == 'Store' && item.Status == 'Completed') aisleData[aisleIndex][aisleKey].In++;
                    if (item.ReqType == 'Retrieval' && item.Status == 'Completed') aisleData[aisleIndex][aisleKey].Out++;
                    aisleData[aisleIndex][aisleKey].Total =
                        aisleData[aisleIndex][aisleKey].In +
                        aisleData[aisleIndex][aisleKey].Out;
                }
            });

            aisleData.forEach(aisle => {
                const aisleValues = Object.values(aisle)[0];
                totalIn += aisleValues.In;
                totalOut += aisleValues.Out;
            });

            aisleData.push({
                Total: { TotalIn: totalIn, TotalOut: totalOut, Total: totalIn + totalOut }
            });

            return { [moment(ReqDate).format('DD/MM/YYYY')]: aisleData };
        }));

        res.status(200).json({
            status: 1,
            message: 'Success',
            data: formattedResponse,
        });
    } catch (error) {
        console.error('Error fetching store and retrieval summary:', error);
        res.status(500).json({ status: 0, message: 'Internal Server Error' });
    }
};


const getOrderProcessingSummary = async (req, res) => {
    try { 
        const { fromDate, toDate, exportFormat } = req.query;
        const today = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss'); 
        let startDate = fromDate
            ? moment(fromDate).startOf('day').format('YYYY-MM-DD HH:mm:ss')
            : moment(today).startOf('day').format('YYYY-MM-DD HH:mm:ss');
    
        let endDate = toDate
            ? moment(toDate).endOf('day').format('YYYY-MM-DD HH:mm:ss')
            : today;

        let query = `
                SELECT 
                    R.OrderNo, 
                    CONVERT(VARCHAR, R.EffectiveDate, 23) AS UpdatedDate,
                    STRING_AGG(R.BinID, ', ') AS BinIDs,
                    STRING_AGG(R.ItemCode, ', ') AS ItemCodes,
                    COUNT(R.BinID) AS BinIDCount,
                    SUM(R.Quantity) AS TotalQuantity,
                    SUM(R.PickingQty) AS TotalPickingQty,
                    CASE 
                        WHEN SUM(CASE WHEN R.Status IN ('P', 'E') THEN 1 ELSE 0 END) > 0 THEN 
                            (CASE WHEN SUM(CASE WHEN R.Status = 'E' THEN 1 ELSE 0 END) > 0 THEN 'E' ELSE 'P' END)
                        ELSE MAX(R.Status) 
                    END AS ConsolidatedStatus,
                    COALESCE(RBC.RetrieveBinCount, 0) AS RetrieveBinCount
                FROM 
                    (
                    SELECT 
                        OrderNo, 
                        BinID, 
                        ItemCode, 
                        Quantity, 
                        PickingQty, 
                        Status,
                        COALESCE(UpdatedDate, CreatedDate) AS EffectiveDate
                    FROM 
                        [ERP_Retrieval] WITH (NOLOCK)
                    ) R
                LEFT JOIN 
                    (
                    SELECT OrderNo, COUNT(BinID) AS RetrieveBinCount, Status 
                    FROM RetrievalConfirmation WITH (NOLOCK)
                    GROUP BY OrderNo, Status
                    ) RBC ON R.OrderNo = RBC.OrderNo AND RBC.Status = 'C'
                WHERE 
                    R.EffectiveDate BETWEEN '${startDate}' AND '${endDate}'
                GROUP BY 
                    R.OrderNo, 
                    CONVERT(VARCHAR, R.EffectiveDate, 23),
                    RBC.RetrieveBinCount
                ORDER BY 
                    UpdatedDate DESC, 
                    R.OrderNo;`;

        // let sumQuery = `
        //     SELECT 
        //         SUM(Quantity) AS TotalQuantity,
        //         SUM(PickingQty) AS TotalPickingQty
        //     FROM [ERP_Retrieval]
        //     WHERE CAST(UpdatedDate AS DATE) = CAST(GETDATE() AS DATE)
        // `;

        let sumQuery =`select sum (pickingQty) as TotalPickingQty from ERP_Retrieval WITH (NOLOCK) where CAST(UpdatedDate as Date) = CAST(GETDATE() AS DATE)`
        
        const sumResult = await sequelize.query(sumQuery, { type: sequelize.QueryTypes.SELECT });        
        const result = await sequelize.query(query, { type: sequelize.QueryTypes.SELECT });
        const header = await tableHeader('OrderProcessingSummary'); 
        let reportName = 'Pallet Request Report';
        if(exportFormat == '')
        {
            res.status(200).send({ status: 1, data: result, total: sumResult, header });
        } 
        else
        {
            const {exportData} = require('../models/Export');
            await exportData(res,exportFormat,reportName,header, result);  
        }
    } catch (error) {
        res.status(202).send({ status: 0, message: error.message });
    }
};


const getPreBinningSummary = async (req, res) => {
    try {
        const { fromDate, toDate, exportFormat } = req.query;
        const today = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss');
 
        let startDate = fromDate
            ? moment(fromDate).startOf('day').format('YYYY-MM-DD HH:mm:ss')
            : moment(today).startOf('day').format('YYYY-MM-DD HH:mm:ss');
 
        let endDate = toDate
            ? moment(toDate).endOf('day').format('YYYY-MM-DD HH:mm:ss')
            : today;
 
        // Step 1: Fetch data from T_BIN_COMPLETE
        let binDataQuery = `
            SELECT TOP 500
                id, BinID, GRNNo, DocNo, ItemCode, ItemName, ItemGroup,
                Quantity, BinningStatus, CreatedDate, CreatedBy, UpdatedDate,
                UpdatedBy, isDelete, GRNType, ItemStatus, scannedItem
            FROM T_BIN_COMPLETE WITH (NOLOCK)
            WHERE (CreatedDate BETWEEN '${startDate}' AND '${endDate}')
        `;
 
        const binData = await sequelize.query(binDataQuery, { type: sequelize.QueryTypes.SELECT });
 
        // Step 2: Iterate over binData to check warehouse status
        let finalData = [];
 
        for (let bin of binData) {
            let binId = bin.BinID;
 
            let warehouseCheckQuery = `
                SELECT TOP 1
                    AisleNo, BinID, ItemCode, ItemName, ItemGroup, Quantity,
                    BinCapacity, UpdatedDate, GRNNo
                FROM Inv_PalletDetails WITH (NOLOCK)
                WHERE InQuantity = 0 AND Quantity > 0 AND BinID = '${binId}'
            `;
 
            let warehouseData = await sequelize.query(warehouseCheckQuery, { type: sequelize.QueryTypes.SELECT });
 
            let warehouseStatus = warehouseData.length > 0 ? "In Warehouse" : "Not in Warehouse";
 
            finalData.push({
                BinID: bin.BinID,
                AisleNo: warehouseData.length > 0 ? warehouseData[0].AisleNo : null,
                ItemName: bin.ItemName,
                ItemCode: bin.ItemCode,
                ItemGroup: bin.ItemGroup,
                Quantity: bin.Quantity,
                Date: bin.CreatedDate,
                BinCapacity: warehouseData.length > 0 ? warehouseData[0].BinCapacity : null,
                GRNNo: bin.GRNNo,
                BinningStatus: bin.BinningStatus,
                ItemStatus: bin.ItemStatus,
                CreatedBy: bin.CreatedBy,
                WarehouseStatus: warehouseStatus
            });
        }
 
        // Step 3: Return response
        let reportName = 'Pallet Request Report';
        const header = await tableHeader('PreBinningSummary');
 
        if (!exportFormat) {
            res.status(200).send({ status: 1, data: finalData, header });
        } else {
            const { exportData } = require('../models/Export');
            await exportData(res, exportFormat, reportName, header, finalData);
        }
    } catch (error) {
        res.status(500).send({ status: 0, message: error.message });
    }
};
 

const getLiveStationDetails = async (req, res) => {
    try {
        let data = req.body;
        const Floor = parseInt(data.Floor);
        const result = await sequelize.query(`EXEC GetLiveTrackingDetails @Floor = :Floor`,
            {
                replacements: {
                    Floor: Floor
                },
                Type: 'Show'
            }
        );
        let resData = JSON.parse(result[0][0].JsonResult)  
        res.status(200).send({ status: 1, data:resData });
    } 
    catch (error) 
    {
        res.status(202).send({ status: 0, message: error.message });
    }
};

const getStoreRetrieveDashboard = async (req, res) => {
    try {
        const { dataType, exportFormat, selectedOrder } = req.body;
        const { exportData } = require('../models/Export');
 
        // Common export handler
        const handleExportOrResponse = async (data, header, reportName, orderData = null) => {
            if (!exportFormat) {
                return res.status(200).send({ status: 1, data, header, ...(orderData && { orderData }) });
            } else {
                await exportData(res, exportFormat, reportName, header, data);
            }
        };
 
        // ===== STORE DASHBOARD =====
        if (dataType === 'Store') {
            const storeQuery = `
                SELECT
                    pr.Itemcode,
                   
                    -- Inward Bin Count (Aisle 1)
                    COUNT(DISTINCT CASE WHEN pr.AisleNo = 1 AND pr.ReqType = 'STR' THEN pr.BinID END) AS RequestedBinCount_Aisle1,
                    ISNULL((SELECT COUNT(DISTINCT BinID)
                            FROM Inv_PalletDetails ip WITH (NOLOCK)
                            WHERE ip.Itemcode = pr.Itemcode AND ip.AisleNo = 1), 0) AS InventoryBinCount_Aisle1,
       
                    -- Outward Bin Count (Aisle 1)
                    COUNT(DISTINCT CASE WHEN pr.AisleNo = 1 AND pr.ReqType = 'PIC' THEN pr.BinID END) AS OutBinCount_Aisle1,
                   
                    -- Inward Bin Count (Aisle 2)
                    COUNT(DISTINCT CASE WHEN pr.AisleNo = 2 AND pr.ReqType = 'STR' THEN pr.BinID END) AS RequestedBinCount_Aisle2,
                    ISNULL((SELECT COUNT(DISTINCT BinID)
                            FROM Inv_PalletDetails ip WITH (NOLOCK)
                            WHERE ip.Itemcode = pr.Itemcode AND ip.AisleNo = 2), 0) AS InventoryBinCount_Aisle2,
       
                    -- Outward Bin Count (Aisle 2)
                    COUNT(DISTINCT CASE WHEN pr.AisleNo = 2 AND pr.ReqType = 'PIC' THEN pr.BinID END) AS OutBinCount_Aisle2,
       
                    -- Inward Bin Count (Aisle 3)
                    COUNT(DISTINCT CASE WHEN pr.AisleNo = 3 AND pr.ReqType = 'STR' THEN pr.BinID END) AS RequestedBinCount_Aisle3,
                    ISNULL((SELECT COUNT(DISTINCT BinID)
                            FROM Inv_PalletDetails ip WITH (NOLOCK)
                            WHERE ip.Itemcode = pr.Itemcode AND ip.AisleNo = 3), 0) AS InventoryBinCount_Aisle3,
       
                    -- Outward Bin Count (Aisle 3)
                    COUNT(DISTINCT CASE WHEN pr.AisleNo = 3 AND pr.ReqType = 'PIC' THEN pr.BinID END) AS OutBinCount_Aisle3,
       
                    -- Inward Bin Count (Aisle 4)
                    COUNT(DISTINCT CASE WHEN pr.AisleNo = 4 AND pr.ReqType = 'STR' THEN pr.BinID END) AS RequestedBinCount_Aisle4,
                    ISNULL((SELECT COUNT(DISTINCT BinID)
                            FROM Inv_PalletDetails ip WITH (NOLOCK)
                            WHERE ip.Itemcode = pr.Itemcode AND ip.AisleNo = 4), 0) AS InventoryBinCount_Aisle4,
       
                    -- Outward Bin Count (Aisle 4)
                    COUNT(DISTINCT CASE WHEN pr.AisleNo = 4 AND pr.ReqType = 'PIC' THEN pr.BinID END) AS OutBinCount_Aisle4,
       
                    -- Totals
                    COUNT(DISTINCT CASE WHEN pr.ReqType = 'STR' THEN pr.BinID END) AS TotalRequestedBinCount,
                    ISNULL((SELECT COUNT(DISTINCT BinID)
                            FROM Inv_PalletDetails ip WITH (NOLOCK)
                            WHERE ip.Itemcode = pr.Itemcode), 0) AS TotalInventoryBinCount,
       
                    -- Total Out Bin Count
                    COUNT(DISTINCT CASE WHEN pr.ReqType = 'PIC' THEN pr.BinID END) AS TotalOutBinCount
                   
                FROM PalletRequestDetails pr WITH (NOLOCK)
                WHERE (pr.ReqType = 'STR' OR pr.ReqType = 'PIC')
                  AND pr.Status = 'C'
                  AND CAST(pr.ReqTime AS DATE) = CAST(GETDATE() AS DATE)
                GROUP BY pr.Itemcode
                ORDER BY pr.Itemcode;
            `;
       
            const data = await sequelize.query(storeQuery, { type: sequelize.QueryTypes.SELECT, logging: false });
            const header = await tableHeader('StoreDashboard');
            return await handleExportOrResponse(data, header, 'Store Summary Report');
        } else if (dataType === 'Retrieve') {
            const getAllOrder = `
                SELECT OrderID
                FROM (
                    SELECT OrderID, MAX(ReqTime) AS MaxReqTime
                    FROM PalletRequestDetails WITH (NOLOCK)
                    WHERE ReqType = 'PIC' AND Status = 'C' AND CAST(ReqTime AS DATE) = CAST(GETDATE() AS DATE)
                    GROUP BY OrderID
                ) AS DistinctOrders
                ORDER BY MaxReqTime DESC;
            `;
            const allOrders = await sequelize.query(getAllOrder, { type: sequelize.QueryTypes.SELECT, logging: false });
 
            let targetOrderClause = '';
            if (selectedOrder === 'lastData' && allOrders.length > 0) {
                targetOrderClause = `AND pr.OrderID = '${allOrders[0].OrderID}'`;
            } else if (selectedOrder && selectedOrder !== 'All') {
                targetOrderClause = `AND pr.OrderID = '${selectedOrder}'`;
            }
 
            const retrieveQuery = `
                SELECT 
                    pr.Itemcode,
                    pr.OrderID as OrderId,
                    COUNT(DISTINCT CASE WHEN pr.AisleNo = 1 THEN pr.BinID END) AS RequestedBinCount_Aisle1,
                    COUNT(DISTINCT CASE WHEN pr.AisleNo = 2 THEN pr.BinID END) AS RequestedBinCount_Aisle2,
                    COUNT(DISTINCT CASE WHEN pr.AisleNo = 3 THEN pr.BinID END) AS RequestedBinCount_Aisle3,
                    COUNT(DISTINCT CASE WHEN pr.AisleNo = 4 THEN pr.BinID END) AS RequestedBinCount_Aisle4,
                    COUNT(DISTINCT pr.BinID) AS TotalRequestedBinCount
                FROM PalletRequestDetails pr WITH (NOLOCK)
                WHERE pr.ReqType = 'PIC' AND pr.Status = 'C' AND CAST(pr.ReqTime AS DATE) = CAST(GETDATE() AS DATE)
                ${targetOrderClause}
                GROUP BY pr.Itemcode, pr.OrderID
                ORDER BY pr.Itemcode;
            `;
 
            const data = await sequelize.query(retrieveQuery, { type: sequelize.QueryTypes.SELECT, logging: false });
            const header = await tableHeader('RetrieveDashboard');
            return await handleExportOrResponse(data, header, 'Retrieve Summary Report', allOrders);
        }
 
        // Invalid dataType
        return res.status(202).send({ status: 0, message: 'Invalid data type provided.' });
 
    } catch (error) {
        console.error('Error in getStoreRetrieveDashboard:', error);
        return res.status(202).send({ status: 0, message: 'Internal server error.', error: error.message });
    }
};

module.exports = {
    palletRequestList,
    itemInventoryList,
    inventoryList,
    getFilters,    
    craneStatus,
    locationStatus,
    toteliftRequestList,
    getERPConfirmation,
    getStoreRetrieveSummary,
    getOrderProcessingSummary,
    getPreBinningSummary,
    getLiveStationDetails,
    getStoreRetrieveDashboard
};