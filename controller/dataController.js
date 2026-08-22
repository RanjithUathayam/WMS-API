const { Op } = require('sequelize');
const moment = require('moment');
const { sequelize } = require('../config/database');
const { TableHints } = require('sequelize');

// Endpoint handler function
const marqueeOccupied = async (req, res) => {
    try 
    {
        // const craneStatus = `SELECT  ed.EquipmentName,csm.CraneMode,csm.CraneReadyStatus, ed.MachineFunction FROM EquipmentDetails ed INNER JOIN CraneStatusMonitor csm ON ed.EquipmentNo = csm.EquipmentNo;`;
        // //   WHERE ed.EquipmentType = 'CRN'
        // const [senResult, metadata] = await sequelize.query(craneStatus);
        let status=0;
        let message="";
        let occupiedData={};
        let alarmCount=0;

        // // Check if senResult exists
        // if (senResult.length > 0) 
        {

            let combinedInfo = '';
            // for (let i = 0; i < senResult.length; i++) {
            //     const { EquipmentName,CraneMode, CraneReadyStatus, MachineFunction } = senResult[i];
            //     combinedInfo += `${EquipmentName}:Mode - ${CraneMode};Ready Status - ${CraneReadyStatus}; Process - ${MachineFunction}; `;
            // }

            const occQuery = `SELECT TOP 1 
                TotalPalletLoc.TotalPalletLoc, 
                OccupiedPalletLoc.OccupiedPalletLoc, 
                FreeLoc.FreeLoc,
                CAST(OccupiedPalletLoc.OccupiedPalletLoc AS FLOAT) * 100 / TotalPalletLoc.TotalPalletLoc AS occupiedPer
            FROM 
                (SELECT COUNT(*) AS TotalPalletLoc FROM LocationSpecification WITH (NOLOCK) WHERE PickDelPoint = 0) AS TotalPalletLoc,
                (SELECT COUNT(*) AS OccupiedPalletLoc FROM LocationSpecification WITH (NOLOCK) WHERE PickDelPoint = 0 AND BinID != '') AS OccupiedPalletLoc,
                (SELECT COUNT(*) AS FreeLoc FROM LocationSpecification WITH (NOLOCK) WHERE PickDelPoint = 0 AND Blocked = 0 AND Error = 0 AND BinID IS NULL) AS FreeLoc;`;

            const [occResult, metadata] = await sequelize.query(occQuery);
            let occupiedPer = 0;
            if (occResult.length > 0) 
            {
                occupiedPer = occResult[0].occupiedPer;
            }
            occupiedData.sentence=combinedInfo;
            occupiedData.occupiedPer=occupiedPer;
            status=1;
        } 
        // else {
        //     status=0;
        //     message="No Equipment Found";
        // }

        const [alrmResult, metadatas] = await sequelize.query("select COUNT(AlarmDateTime) as CNT from AlarmHistory WITH (NOLOCK) where AlarmAckTime is  null and IsReset=0");
        if (alrmResult.length > 0) {
            alarmCount = alrmResult[0].CNT;
        }
        res.status(200).json({ status: status, message:message, occupiedData, alarmCount });
    } catch (error) 
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

const dashChartData = async (req, res) => {
    try {
        let status=0;
        let message="";
        const [alrmResult, metadatas] = await sequelize.query("select COUNT(AlarmDateTime) as CNT from AlarmHistory WITH (NOLOCK) where AlarmAckTime is  null and IsReset=0");
        if (alrmResult.length > 0) {
            alarmCount = alrmResult[0].CNT;
        }
        const [chartResult] = await sequelize.query(`SELECT OccupiedPalletLoc,FreeLoc,ErrorLocWPallet,ErrorLocWOPallet,totBayCounts,FullBay,PartialBay,FreeBayCounts
        FROM
            (SELECT COUNT(*) as OccupiedPalletLoc FROM LocationSpecification WITH (NOLOCK) WHERE PickDelPoint = 0 AND BinID != '') AS occPlt,
            (select COUNT(*) as FreeLoc from LocationSpecification WITH (NOLOCK) where PickDelPoint=0 and Blocked=0 and Error=0 and  BinID is  NULL ) AS FreeLoc,
            (select COUNT(*) as ErrorLocWPallet from LocationSpecification WITH (NOLOCK) where Error=1 and PickDelPoint=0 and Blocked=0 and ( BinID!='' or BinID is not NULL )) AS ErrorLocWPallet,
            (select COUNT(*) as ErrorLocWOPallet from LocationSpecification WITH (NOLOCK) where Error=1 and PickDelPoint=0 and Blocked=0 and ( BinID ='' or BinID is  NULL )) AS ErrorLocWOPallet,
            (SELECT COUNT(*) AS totBayCounts FROM (SELECT DISTINCT Side, Level, Bay FROM LocationSpecification WITH (NOLOCK) WHERE Blocked = 0 AND PickDelPoint = 0 ) AS subquery) AS totBayCounts,
            (SELECT COUNT(*) as PartialBay FROM  (SELECT Side,Level,Bay,COUNT(Deep) AS DeepCnt FROM LocationSpecification WITH (NOLOCK) WHERE  PickDelPoint = 0  GROUP BY Bay,Side,Level) AS t1 INNER JOIN  (SELECT Side,Level,Bay,COUNT(Bay) AS BayCount FROM LocationSpecification WITH (NOLOCK) WHERE BinID IS NOT NULL AND PickDelPoint = 0  GROUP BY Bay,Side,Level) AS t2 ON t1.Side = t2.Side AND t1.Level = t2.Level AND t1.Bay = t2.Bay WHERE (t1.DeepCnt-t2.BayCount)>0) AS PartialBay,
            (SELECT COUNT(*) as FullBay FROM  (SELECT Side,Level,Bay,COUNT(Deep) AS DeepCnt FROM LocationSpecification WITH (NOLOCK) WHERE  PickDelPoint = 0  GROUP BY Bay,Side,Level) AS t1 INNER JOIN  (SELECT Side,Level,Bay,COUNT(Bay) AS BayCount FROM LocationSpecification WITH (NOLOCK) WHERE BinID IS NOT NULL AND PickDelPoint = 0  GROUP BY Bay,Side,Level) AS t2 ON t1.Side = t2.Side AND t1.Level = t2.Level AND t1.Bay = t2.Bay WHERE (t1.DeepCnt-t2.BayCount)=0) AS FullBay,
            (SELECT COUNT(BayCount) AS FreeBayCounts FROM (select  COUNT(BAY) as BayCount from LocationSpecification WITH (NOLOCK) where BinID is null and Blocked=0 and PickDelPoint=0   group by Bay,Side,level) AS FreeBayCounts WHERE BayCount=2) AS FreeBayCounts;
        `); 
        
        const OrderSummary = await sequelize.query(`
                        SELECT
                            CONVERT(DATE, CreatedDate) AS OrderDate,  -- SQL Server specific
                            COUNT(distinct(OrderNo)) AS NumberOfOrders,
                            SUM(Quantity) AS SumOfOrderQuantity,
                            SUM(PickingQty) AS SumOfPickingQuantity
                        FROM
                            ERP_Retrieval WITH (NOLOCK)
                        WHERE
                            CreatedDate >= DATEADD(DAY, -10, GETDATE())  -- Filter for last 10 days
							and ItemCode != 'EMPTY'
                            and Status = 'C'
                        GROUP BY
                            CONVERT(DATE, CreatedDate)
                        ORDER BY
                            CONVERT(DATE, CreatedDate)
                    `);
        let OrderDetails = OrderSummary[0]
        // Quantity>0 and
        if (chartResult.length > 0) {
            occupiedPer = chartResult[0].OccpiedPer;
            status=1;
        }

        const AlarmHistory = require(`../models/history/AlarmHistory`);

        let queryOptions = {
            attributes: [['AlarmText', 'ErrorDescription']],
            where: {
                AlarmAckTime: null,
                IsReset: 0
            },
            order: [] ,
            tableHint: TableHints.NOLOCK           
        };

        // Execute the query
        const alarmStatusList = await AlarmHistory.findAndCountAll(queryOptions);
        res.status(200).json({ status: status,message:message,chartResult,alarmStatusList, OrderDetails });
    } catch (error) {
        res.status(202).json({status: 0, message: error.message});
    }
}

const craneIDs = async (req, res) => {
    try {
        let status=0;
        let message="";
        const [craneResult] = await sequelize.query(`select distinct EquipmentNo,EquipmentName from EquipmentMaster WITH (NOLOCK) where Type='CRN'  order by EquipmentNo `);
        if (craneResult.length > 0) {
            status=1;
            message="";
        }
        res.status(200).json({ status: status,message:message,data:craneResult });
    } catch (error) {
        res.status(202).json({status: 0, message: error.message});  
    }
}
const itemGroup = async (req, res) => {
    try {
        let status=0;
        let message="";
        const [groupResult] = await sequelize.query(`SELECT id,PartGrp FROM Master_PartGroup WITH (NOLOCK) where IsDelete=0 order by PartGrp ASC `);
        if (groupResult.length > 0) {
            status=1;
            message="";
        }
        res.status(200).json({ status: status,message:message,data:groupResult });
    } catch (error) {
        res.status(202).json({status: 0, message: error.message}); 
    }
}

const rightsList = async(req, res) => {
    try {
        const modelName = 'RightsList';
        const model = require(`../models/master/${modelName}`);        
        const entities = await model.findAll({where:{IsDelete:0},tableHint: TableHints.NOLOCK});
 
        const userGroupModel = require(`../models/master/UserGroup`);  
        const rights = await userGroupModel.findOne({where:{Id :req.params.id},tableHint: TableHints.NOLOCK});
       
        res.status(200).json({status:1,message:"Lists", data:entities, rights: rights?rights.rights:[]});
    } catch (error) {
        res.status(202).json({status: 0, message: error.message});
    }
}

const searchAlarmHistory = async(req, res) => {
    try {
        const AlarmHistory = require(`../models/history/AlarmHistory`);
        let queryOptions = {
            attributes: [['AlarmDateTime', 'ErrorDateTime'], 'ErrorCode', ['AlarmText', 'ErrorDescription'], 'AlarmAckTime'],
            where: ['AlarmAckTime is  null and IsReset=0'],
            order: [],  
            tableHint: TableHints.NOLOCK          
        };

        // Execute the query
        const results = await AlarmHistory.findAndCountAll(queryOptions);

        if (results) {
            res.status(200).json({ status: 1, message: "Lists", totalCount: results.count, data: results.rows });
        } else {
            res.status(202).json({ status: 0, message: "No data found", data: [], totalCount: 0 });
        }
    } catch (error) {
        res.status(202).json({ status: 0, message: "No data found", totalCount: 0 });
    }
}

module.exports = {
    marqueeOccupied,
    dashChartData,
    craneIDs,
    itemGroup,
    rightsList,
    searchAlarmHistory
}