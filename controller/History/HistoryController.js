const { Op, literal } = require('sequelize');
const moment = require('moment');
const { sequelize } = require('../../config/database');
const MasterBin = require('../../models/master/MasterBin');
const { TableHints } = require('sequelize');

const modelFieldsMap = {
  uom: ['Id', 'UOM', 'UpdatedDateTime', 'UserName'],
  MasterBin: ['BinID'],
  errortable: ['id', 'EquipmentType', 'ErrorCode', 'ErrorDescription', 'UpdatedDate'],
};

const tableFieldsFrntEnd = {
  MasterPart: ['ItemCode'],
  MasterBin: ['BinID'],
  errortable: ['id', 'EquipmentType', 'ErrorCode', 'ErrorDescription', 'UpdatedDate'],
};

async function tableHeader(type){
    const model = require(`../../models/Table_Header`);
    const result = await model.findAll({ attributes: ['details'],where:{type:type}, tableHint: TableHints.NOLOCK });
    if(result && result[0].details){
        return result[0].details;
    } 
    else {
        return [];
    }
}
async function alarmReset(req, res) {
  try {
    let status = 0;
    let message = "Invalid Request";
    let data;
    let EquipmentType = req.body.equipmentType;
    if (EquipmentType == "Conveyor") {
      const result = await sequelize.query('EXEC SP_ShowModbusData @Type = :type', {
        replacements: { type: 'ResetAlarm' },
        type: sequelize.QueryTypes.SELECT
      });
      if (result) {
        status = 1;
        message = "Conveyor Alarm Reseted";
      }
      else {
        message = "Error Conveyor Alarm Reset";
      }
    }
    else if (req.body.CraneID != "" && req.body.UserName != "") {
      const result = await sequelize.query('EXEC SP_UpdateEquipmentRequest @Type = :type,@EquipmentNo= :EquipmentNo,@CreatedUser= :CreatedUser', {
        replacements: { type: 'AlarmReset', EquipmentNo: req.body.CraneID, CreatedUser: req.body.UserName },
        type: sequelize.QueryTypes.SELECT
      });
      data = result;
      if (result) {
        status = 1;
        message = "Crane Alarm Reseted";
      }
      else {
        message = "Error Crane Alarm Reset";
      }
    }
    return res.status(200).json({ status: status, message: message, data });

  } catch (error) {
    res.status(202).json({status: 0, message: error.message});
  }
}
async function getAll(req, res) {
  try {
    const modelName = req.params.model;
    const model = require(`../models/master/${modelName}`);
    const fields = modelFieldsMap[modelName]; // Get fields based on model
    const entities = await model.findAll({ attributes: fields, tableHint: TableHints.NOLOCK });
    res.status(200).json({ status: 1, message: "Lists", headers: tableFieldsFrntEnd[modelName], data: entities });
  } catch (error) {
    res.status(202).json({status: 0, message: error.message});
  }
}

//Pagination Added
async function searchAlarmHistory(req, res) {
  try 
  {
    const AlarmHistory = require(`../../models/history/AlarmHistory`);

    const { type = '', errorCode = '', equipmentType = '', equipmentNo = '', FromDate, ToDate, AlarmType, exportFormat = '' } = req.query;
    let startDate = moment(FromDate).startOf('day').format('YYYY-MM-DD HH:mm:ss')
    let endDate = moment(ToDate).endOf('day').format('YYYY-MM-DD HH:mm:ss') 
    
    const result = await sequelize.query('EXEC SP_AlarmHistory @type = :type, @FromDate= :FromDate,@ToDate= :ToDate,@errorcode= :errorcode, @EquipmentType= :EquipmentType,@EquipmentNo= :EquipmentNo,@AlarmType= :AlarmType', {
        replacements: { 
            type: 'SearchReset', 
            FromDate: startDate, 
            ToDate: endDate, 
            errorcode: errorCode, 
            EquipmentType: equipmentType ?? 'All', 
            EquipmentNo: equipmentNo ?? 'All', 
            AlarmType: AlarmType ?? 'Active'
        },
        Type: 'Show'
    });

    const header = await tableHeader('AlarmHistory');

    if(result[0])
    {
        if (exportFormat == '') 
        {
            res.status(200).json({ status: 1, message: "Lists", totalCount: result[0].count, header, data: result[0],  message: 'Page Load Data Get successfully... ', });
        } 
        else 
        {        
            const { exportData } = require('../../models/Export');
            await exportData(res, exportFormat, `Alarm History Report`, header, result[0]);
        }
    }
    else
    {
        res.status(202).json({status: 0, message: 'Page Load Data Failed...' });
    }
    // let queryOptions = {
    //   attributes: [
    //     [sequelize.literal("(CONVERT(VARCHAR(8), AlarmDateTime, 103)+' '+CONVERT(VARCHAR(8), AlarmDateTime, 108))"), 'ErrorDateTime'],
    //     'ErrorCode',
    //     ['AlarmText', 'ErrorDescription'],
    //     [sequelize.literal("(CONVERT(VARCHAR(8), AlarmAckTime, 103)+' '+CONVERT(VARCHAR(8), AlarmAckTime, 108))"), 'AlarmAckTime']
    //   ],
    //   where: {},
    //   order: [],
    // };

    // if (type === 'errorcode') {
    //   queryOptions.attributes = [[sequelize.fn('DISTINCT', sequelize.col('ErrorCode')), 'ErrorCode']];
    // } else {
    //   queryOptions.order = [['AlarmDateTime', 'DESC']]
    //   if (AlarmType === 'Active') {
    //     queryOptions.where.IsReset = 0;
    //     queryOptions.where.AlarmAckTime = null;
    //   }

    //   if (EquipmentType === 'All') {
    //     if (errorCode) {
    //       queryOptions.where.ErrorCode = errorCode;
    //     }
    //   } else if (EquipmentType === 'Conveyor') {
    //     queryOptions.where.EquipmentType = 'Conveyor';
    //     if (Contype === 'Load') {
    //       queryOptions.where.ErrorCode = { [Op.between]: [0, 100] };
    //     } else if (Contype === 'Unload') {
    //       queryOptions.where.ErrorCode = { [Op.between]: [100, 150] };
    //     } else {
    //       queryOptions.where.ErrorCode = { [Op.between]: [0, 1000] };
    //     }
    //   } else if (EquipmentType === 'Crane') {
    //     queryOptions.where.EquipmentType = 'Crane';
    //     if (CraneID !== 'All' && CraneID !== '') {
    //       queryOptions.where.EquipmentNo = CraneID;
    //     }
    //     queryOptions.where.ErrorCode = { [Op.gte]: 1000 }
    //   }
    // }

    // if (FromDate && ToDate) {
    //   queryOptions.where.AlarmDateTime = {
    //     [Op.between]: [
    //       literal(`CONVERT(DATETIME, '${FromDate}')`),
    //       literal(`CONVERT(DATETIME, '${ToDate}')`)
    //     ]
    //   };
    // } else if (FromDate && !ToDate) {
    //   queryOptions.where.AlarmDateTime = { [Op.gte]: literal(`CONVERT(DATETIME, '${FromDate}')`) };
    // } else if (!FromDate && ToDate) {
    //   queryOptions.where.AlarmDateTime = { [Op.lte]: literal(`CONVERT(DATETIME, '${ToDate}')`) };
    // }

    // const results = await AlarmHistory.findAndCountAll(queryOptions);

    // const header = await tableHeader('AlarmHistory');

    // // console.timeEnd("alarmTIME")
    // if (results) {
    //   if (exportFormat == '') {
    //     res.status(200).json({ status: 1, message: "Lists", totalCount: results.count, header, data: results.rows });
    //   } else {
        
    //     const { exportData } = require('../../models/Export');
    //     await exportData(res, exportFormat, `Alarm History Report`, header, results.rows);
    //   }
    // } else {
    //   res.status(202).json({ status: 0, message: "No data found", data: [], totalCount: 0 });
    // }
  } 
  catch (error) {
    res.status(202).json({ status: 0, message: error.message, totalCount: 0 });
  }
}

async function executeStoredProcedure(req, res) {
  try {
    const result = await sequelize.query('EXEC SP_AlarmHistory @type = :type, @FromDate= :FromDate,@ToDate= :ToDate,@CraneID= :CraneID,@EquipmentType= :EquipmentType,@Contype= :Contype,@AlarmType= :AlarmType, @errorcode = :errorcode', {
      replacements: { type: 'Search', FromDate: '2022-01-01', ToDate: '2024-01-01', CraneID: "All", EquipmentType: "All", Contype: "", AlarmType: "Active", errorcode: '' },
      type: sequelize.QueryTypes.SELECT
    });
    return res.status(200).json({ status: 0, data: result });

  } catch (error) {
    res.status(202).json({status: 0, message: error.message});
  }
}

async function loadUnLoadHistory(req, res) {
    try {
        // Load Model
        const Tbl_PalletCall = require(`../../models/history/Tbl_PalletCall`);
        // Extract query parameters
        const { BinID, mode, FromDate, ToDate, CraneID, pagesize, page, type, exportFormat='',ShuttleID } = req.query;

        // Construct base where condition
        const whereCondition = {};

        // Apply mode filter
        if (BinID != '' && BinID != 'All') {
            whereCondition.BinID = {
                [Op.like]: `%${BinID}%`
            };
        }

        let startDate = moment(FromDate).startOf('day').format('YYYY-MM-DD HH:mm:ss')
        let endDate = moment(ToDate).endOf('day').format('YYYY-MM-DD HH:mm:ss')
        // Apply mode filter
        if (mode === 'Load' || mode === 'Unload' || mode === 'Relocation') {
            whereCondition.Type = mode;
        }
        // Apply date range filter
        if (FromDate && ToDate) {
            whereCondition.CreatedDate = {
                [Op.between]: [
                literal(`CONVERT(DATETIME, '${startDate}')`),
                literal(`CONVERT(DATETIME, '${endDate}')`)
                ]
            };
        } else if (FromDate && !ToDate) {
            whereCondition.CreatedDate = {
                [Op.gte]: literal(`CONVERT(DATETIME, '${startDate}')`)
            };
        } else if (!FromDate && ToDate) {
            whereCondition.CreatedDate = {
                [Op.lte]: literal(`CONVERT(DATETIME, '${endDate }')`)
            };
        }
 
        // Apply CraneID filter
        if (CraneID !== 'All' && CraneID) {
            whereCondition.AisleNo = CraneID;
        }

        // Apply ShuttleID Filter
        if(ShuttleID != 'All' && ShuttleID)
        {
          whereCondition.ShuttleID = ShuttleID;
        }

        // Calculate offset for pagination
        const offset = parseInt(pagesize) * parseInt(parseInt(page) - 1);

        let attributesVal = [[sequelize.literal("(CONVERT(VARCHAR(10), CreatedDate, 103)+' '+CONVERT(VARCHAR(8), CreatedDate, 108))"),'CreatedDate'] ,'AisleNo', 'ShuttleID', 'BinID', 'Type', 'Users'];
        let orderVal = [['CreatedDate', 'DESC']];
        let pagination = {};

        if (type == "BinID") 
        {
            attributesVal = [sequelize.fn('DISTINCT', sequelize.col('BinID')), 'BinID'];
            orderVal = [['BinID', 'ASC']];
        } 
        else 
        {
            const offset = parseInt(pagesize) * parseInt(parseInt(page) - 1);
            pagination = {
                offset: offset,
                limit: parseInt(pagesize)
            };
        } 
        
        // Query database to get paginated results and total count
        const palletCalls = await Tbl_PalletCall.findAndCountAll({
            attributes: attributesVal,
            where: whereCondition,
            order: orderVal,
            limit: 500,
            tableHint: TableHints.NOLOCK
            // ...pagination
        });
 
        const header=await tableHeader('StorageRetrival');
        // Return response with paginated results and total count
        if(exportFormat==''){
        res.status(200).json({ status: 1, message: 'Success',header, data: palletCalls.rows, totalCount: palletCalls.count });
        }
        else{
        const {exportData} = require('../../models/Export');
        await exportData(res,exportFormat,`Load Unload History Report`,header,palletCalls.rows);      
        }
    } catch (error) {
        res.status(202).json({status: 0, message: error.message});
    }
}
async function rejectedHistory(req, res) {
    try 
    {
        // Load Model
        const RejectedHistory = require(`../../models/history/RejectedHistory`);
        // Extract query parameters
        let { FromDate, ToDate, Conveyor, pageSize, page,exportFormat='' } = req.query;
        // Construct base where condition
        const whereCondition = {};

        FromDate = moment(FromDate).startOf('day').format('YYYY-MM-DD HH:mm:ss')
        ToDate = moment(ToDate).endOf('day').format('YYYY-MM-DD HH:mm:ss')
        // Apply date range filter
        if (FromDate && ToDate) 
        {
            whereCondition.UpdatedDateTime = {
                [Op.between]: [
                literal(`CONVERT(DATETIME, '${FromDate}')`),
                literal(`CONVERT(DATETIME, '${ToDate}')`)
                ]
            };
        }
        else if (FromDate && !ToDate) 
        {
            whereCondition.UpdatedDateTime = {
                [Op.gte]: literal(`CONVERT(DATETIME, '${FromDate}')`)
            };
        } 
        else if (!FromDate && ToDate) 
        {
            whereCondition.UpdatedDateTime = {
                [Op.lte]: literal(`CONVERT(DATETIME, '${ToDate}')`)
            };
        }

        // if (Conveyor != 'All' && Conveyor != '') 
        // {
        //     whereCondition.Scanner = Conveyor;
        // }

        if (Conveyor != 'All' && Conveyor != '') 
          {
              whereCondition.ConveyorNumber = Conveyor;
          }

        // Calculate offset for pagination
        const offset = parseInt(pageSize) * parseInt(parseInt(page) - 1);

        let attributesVal = [['ConveyorNumber', 'conveyorName'], 'BinID', 'RejectedReason',[sequelize.literal("(CONVERT(VARCHAR(10), UpdatedDateTime, 103)+' '+CONVERT(VARCHAR(8), UpdatedDateTime, 108))"),'UpdatedDateTime',],'Scanner'];
        // let attributesVal = [
        //   ['ConveyorNumber', 'conveyorName'],
        //   'BinID',
        //   'RejectedReason',
        //   [sequelize.literal('UpdatedDateTime'), 'FormatDate'], // Correct alias syntax for column
        //   [sequelize.literal("(CONVERT(VARCHAR(10), UpdatedDateTime, 103) + ' ' + CONVERT(VARCHAR(8), UpdatedDateTime, 108))"), 'UpdatedDateTime']
        // ];
        
        
        
        let orderVal = [['UpdatedDateTime', 'DESC']];
        let pagination = {};

        // Query database to get paginated results and total count
        const historyList = await RejectedHistory.findAndCountAll({
            attributes: attributesVal,
            where: whereCondition,
            order: orderVal,
            tableHint: TableHints.NOLOCK
            // ...pagination
        });

        let header= await tableHeader('RejectedBinHistory');
        // Return response with paginated results and total count
        if(exportFormat=='')
        {
            res.status(200).json({ status: 1, message: 'Success', totalCount: historyList.count,header, data: historyList.rows });
        }
        else
        {
            const {exportData} = require('../../models/Export'); 
            await exportData(res,exportFormat,`Alarm History Report`,header,historyList.rows);      
        }
    } 
    catch (error) {
        res.status(202).json({status: 0, message: error.message});
    }
}

async function maintenanceHistory(req, res) {
    try 
    {
        // Load Model
        const MaintenceHistory = require(`../../models/history/MaintenanceHistory`);
        // Extract query parameters
        const { FromDate, ToDate, EquipmentType, pageSize, page,exportFormat='' } = req.query;

        // Construct base where condition
        const whereCondition = {};


        // Apply date range filter
        if (FromDate && ToDate) {
        whereCondition.MaintenanceTime = {
            [Op.between]: [
            literal(`CONVERT(DATETIME, '${FromDate}')`),
            literal(`CONVERT(DATETIME, '${ToDate}')`)
            ]
        };
        } else if (FromDate && !ToDate) {
        whereCondition.MaintenanceTime = {
            [Op.gte]: literal(`CONVERT(DATETIME, '${FromDate}')`)
        };
        } else if (!FromDate && ToDate) {
        whereCondition.MaintenanceTime = {
            [Op.lte]: literal(`CONVERT(DATETIME, '${ToDate}')`)
        };
        }

        if (EquipmentType != 'All' && EquipmentType != '') {
        whereCondition.EquipmentType = EquipmentType;
        }


        // Calculate offset for pagination
        const offset = parseInt(pageSize) * parseInt(parseInt(page) - 1);

        let attributesVal = ['EquipmentType', 'EquipmentNo', 'Material',[sequelize.literal("(CONVERT(VARCHAR(8), MaintenanceTime, 103)+' '+CONVERT(VARCHAR(8), MaintenanceTime, 108))"),'MaintenanceTime'] , 'AcknowledgePerson'];
        // let attributesVal = [
        //   'EquipmentType',
        //   'EquipmentNo',
        //   'Material',
        //   'MaintenanceTime',  
        //   'AcknowledgePerson'
        // ];
        
        let orderVal = [['MaintenanceTime', 'DESC']];
        let pagination = {};

        // Query database to get paginated results and total count
        const maintenceList = await MaintenceHistory.findAndCountAll({
        attributes: attributesVal,
        where: whereCondition,
        order: orderVal,
        tableHint: TableHints.NOLOCK
        // ...pagination
        }); 

        // const ListData=maintenceList.rows;
        // const uniqueTypes = [...new Set(ListData.map(item => item.type))];

        // console.log(uniqueTypes);

        // function getUniqueNumbersByType(type) {
        //   const matchedObjects = ListData.filter(item => item.type === type);
        //   const uniqueNumbers = [...new Set(matchedObjects.map(item => item.no))];
        //   return uniqueNumbers;
        // }

        // // Usage
        // const type = "RGV";
        // const uniqueNumbers = getUniqueNumbersByType(type);
        // console.log(uniqueNumbers);

        const header=await tableHeader('MaintenanceHistory');

        // Return response with paginated results and total count
        if(exportFormat=='')
        {
        res.status(200).json({ status: 1, message: 'Success', totalCount: maintenceList.count,header, data: maintenceList.rows });
        }
        else
        {
        const {exportData} = require('../../models/Export');
        await exportData(res,exportFormat,`Maintenance History Report`,header,maintenceList.rows);      
        }
    }
    catch (error) 
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

async function searchExpiryAlert(req, res) {
    try 
    {
        const { PartNo, PartName, PartGrp, ExpiryDate, CraneID, Type, isSelected, exportFormat='' } = req.body;
        let query = `
        SELECT 
            convert(varchar(10), ID.UpdatedDate, 103) as AccessedDate,
            LS.Side,
            scm.InCrane AS CraneID,
            scm.AisleNo AS AisleNo,
            ID.BinID,
            ID.ItemCode,
            ID.ItemName,
            LS.LocationID,
            ID.ItemGroup,
            ID.Quantity,
            ID.BufferQty,
            ID.UpdatedDate,
            ID.UserName
        FROM 
            Inv_PalletDetails ID WITH (NOLOCK)
        LEFT JOIN 
            LocationSpecification LS WITH (NOLOCK) ON ID.BinID = LS.BinID 
        LEFT JOIN 
            SideCraneMap scm WITH (NOLOCK) on scm.SideID=LS.Side
        WHERE 
            ID.ItemCode != '' AND 
            ID.ItemCode IS NOT NULL`;

        if (CraneID != undefined && CraneID !== '' && CraneID != 'All') {
            query += ` AND scm.InCrane=${CraneID}`;
        }

        if (PartNo != undefined && PartNo !== '') {
            query += ` AND ID.ItemCode LIKE '%${PartNo}%'`;
        }

        if (PartName != undefined && PartName !== '') {
            query += ` AND ID.ItemName LIKE '%${PartName}%'`;
        }

        if (PartGrp != undefined && PartGrp !== '') {
            query += ` AND ID.ItemGroup LIKE '%${PartGrp}%'`;
        }


        // if (UpdatedDate === null && isSelected === 1) 
        // {
        //   query += ` AND ID.UpdatedDate IS NULL`;
        // } 
        // else if (UpdatedDate !== null && isSelected === 1) 
        // {
        //   query += ` AND ID.UpdatedDate LIKE '%${ExpiryDate}%'`;
        // } 
        // else 
        // {
        //   if (Type === '>15') {
        //     query += ` AND CONVERT(DATETIME, ID.UpdatedDate, 103) > DATEADD(day, 15, CONVERT(DATE, GETDATE()))`;
        //   } else if (Type === '15') {
        //     query += ` AND ID.UpdatedDate BETWEEN CONVERT(date, GETDATE()) AND DATEADD(day, 15, CONVERT(DATE, GETDATE()))`;
        //   } else if (Type === '10') {
        //     query += ` AND ID.UpdatedDate BETWEEN CONVERT(date, GETDATE()) AND DATEADD(day, 10, CONVERT(DATE, GETDATE()))`;
        //   } else if (Type === '5') {
        //     query += ` AND ID.UpdatedDate BETWEEN CONVERT(date, GETDATE()) AND DATEADD(day, 5, CONVERT(DATE, GETDATE()))`;
        //   } else if (Type === '<5') {
        //     query += ` AND ID.UpdatedDate BETWEEN CONVERT(date, GETDATE()) AND DATEADD(day, 4, CONVERT(DATE, GETDATE()))`;
        //   } else if (Type === 'Already Expired') {
        //     query += ` AND CONVERT(DATETIME, ID.UpdatedDate, 103) < CONVERT(DATE, GETDATE())`;
        //   }
        // }

        const result = await sequelize.query(query, { type: sequelize.QueryTypes.SELECT });

        const header=await tableHeader('ExpiryAlert');
        if(exportFormat=='')
        {
            res.status(200).json({ status: 1, message: 'Success',header, data: result });
        }
        else
        {
            const {exportData} = require('../../models/Export');
            await exportData(res,exportFormat,`Expiry Alert Report`,header,result);      
        }
    } 
    catch (error) {
        res.status(202).json({ status: 0, message: error.message, data: '' });
    }
}

async function getExpiryFilters(req, res) {
  try {
    const { PartGroup } = req.query;
    const filterInvPalletDetails = require(`../../models/transaction/InvPalletDetail`);

    // const equipmentNos = await filterInvPalletDetails.findAll({
    //   attributes: [[sequelize.fn('DISTINCT', sequelize.col('EquipmentNo')), 'EquipmentNo']],
    //   order: [['EquipmentNo', 'ASC']]
    // });
    const expiryDate = await filterInvPalletDetails.findAll({
      attributes: [[sequelize.fn('DISTINCT', sequelize.col('ExpiryDate')), 'ExpiryDate']],
      order: [['ExpiryDate', 'DESC']],
      tableHint: TableHints.NOLOCK
    });

    const partGroups = await filterInvPalletDetails.findAll({
      attributes: [[sequelize.fn('DISTINCT', sequelize.col('PartGroup')), 'PartGroup']],
      order: [['PartGroup', 'ASC']],
      tableHint: TableHints.NOLOCK
    });

    const partNos = await filterInvPalletDetails.findAll({
      attributes: [[sequelize.fn('DISTINCT', sequelize.col('PartNo')), 'PartNo'], 'PartGroup'],
      order: [['PartNo', 'ASC']],
      tableHint: TableHints.NOLOCK
    });

    const partNames = await filterInvPalletDetails.findAll({
      attributes: [
        [sequelize.fn('DISTINCT', sequelize.col('PartName')), 'PartName'],
        'PartNo',
        'PartGroup'
      ],
      order: [['PartName', 'ASC']],
      tableHint: TableHints.NOLOCK
    });

    // Prepare response object with filter values
    const response = {
      status: 1,
      message: 'Success',
      filters: {
        // EquipmentNo: equipmentNos.map(item => ({EquipmentNo:item.EquipmentNo})),
        ExpiryDate: expiryDate.map(item => ({ ExpiryDate: item.ExpiryDate })),
        PartGroup: partGroups.map(item => ({ PartGroup: item.PartGroup })),
        PartNo: partNos.map(item => ({
          PartGroup: item.PartGroup,
          PartNo: item.PartNo,
        })),
        PartName: partNames.map(item => ({
          PartGroup: item.PartGroup,
          PartNo: item.PartNo,
          PartName: item.PartName
        }))
      }
    };

    res.status(200).json(response);
  } catch (error) {
    res.status(202).json({status: 0, message: error.message});
  }
}


async function userEntryLogList(req, res){
  try{  
    const { fromDate, toDate, type, method = 'Load' } = req.body; 
    let startDate = moment(fromDate).startOf('day').format('YYYY-MM-DD HH:mm:ss')
    let endDate = moment(toDate).endOf('day').format('YYYY-MM-DD HH:mm:ss')
  
    const query = `EXEC SP_EntryLog @Method = :method, @FromDate = :fromDate, @ToDate = :toDate, @Type = :type`;
    const result = await sequelize.query(query, {
      replacements: { method:method, fromDate:startDate, toDate:endDate, type:type },
      type: sequelize.QueryTypes.SELECT
    });  

    const header=await tableHeader('UserEntryLog');
    
    res.status(200).json({status: 1, message: 'Success', header, data: result});
  }catch(error){
    res.status(202).json({status: 0, message: error.message});
  }
}

async function insertUserEntryLog(req, res){
  try{ 
    const { AccessDateTime, Type, UserName, MacAddress } = req.body;   
    const AccessDateTimeConv = moment(AccessDateTime).format('YYYY-MM-DD HH:mm:ss.SSS');
    const query = `INSERT INTO EntryLog(AccessDateTime, Type, UserName, MacAddress) VALUES(:AccessDateTimeConv, :Type, :UserName, :MacAddress)`;
    const result = await sequelize.query(query, {
      replacements: { AccessDateTimeConv, Type, UserName, MacAddress },
      type: sequelize.QueryTypes.INSERT
    }); 
    
    res.status(200).json({status: 1, message: 'Success', data: result});
  }catch(error){
    res.status(202).json({status: 0, message: error.message});
  }
}




async function userLogList(req, res) {
    const Logindatetimesettings = require(`../../models/history/UserLog`);
    const { fromDate, toDate, macaddress, exportFormat='' } = req.query; // Changed to lowercase

    try 
    {
        let whereCondition = {};

        if (fromDate && toDate) 
        {
            whereCondition.Logindate = {
                [Op.between]: [
                literal(`CONVERT(DATETIME, '${fromDate}')`),
                literal(`CONVERT(DATETIME, '${toDate}')`)
                ]
            };
        } 
        else if (fromDate && !toDate) 
        {
            whereCondition.Logindate = {
                [Op.gte]: literal(`CONVERT(DATETIME, '${fromDate}')`)
            };
        } 
        else if (!fromDate && toDate) 
        {
            whereCondition.Logindate = {
                [Op.lte]: literal(`CONVERT(DATETIME, '${toDate}')`)
            };
        }
 

        const loginData = await Logindatetimesettings.findAndCountAll({
          attributes: [
              'Username',
              [
                  sequelize.literal(
                      "(CONVERT(VARCHAR(10), Logindate, 103) + ' ' + CONVERT(VARCHAR(8), Logintime, 108))"
                  ),
                  'Logindate' 
              ],
              [
                  sequelize.literal(
                      "(CONVERT(VARCHAR(10), Logindate, 103) + ' ' + CONVERT(VARCHAR(8), Logintime, 108))"
                  ),
                  'Logintime'  
              ],
              [
                  sequelize.literal(
                      "(CONVERT(VARCHAR(10), Logindate, 103) + ' ' + CONVERT(VARCHAR(8), Logouttime, 108))"
                  ),
                  'Logouttime'  
              ]
          ],
          where: whereCondition,
          order: [['id', 'DESC']],
          tableHint: TableHints.NOLOCK
      });
      

        const header=await tableHeader('UserLoginLog');
        if(exportFormat=='')
        {
            res.status(200).json({ status: 1, message: 'Success',header, data: loginData.rows, totalCount: loginData.count });
        }
        else
        {
            const {exportData} = require('../../models/Export');
            await exportData(res,exportFormat,`User Login Report`,header,loginData.rows);      
        }
    } 
    catch (error) 
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

const resetAlarm = async (req, res) => {
    try 
    {
        const data = req.body;
        if(data.EquipmentType == 'Conveyor')
        {
            const result = await sequelize.query('EXEC Conveyor_Alarm_reset @Alarmreset = :Alarmreset, @ConvEquipmentNo = :ConvEquipmentNo, @User = :User', {
                replacements: { 
                    Alarmreset: 1,
                    ConvEquipmentNo: data.ConvEquipmentNo ?? 1,
                    User: req.user.UserName ?? ''
                },
                Type: 'Show'
            });
            
            if(result[0][0][''] == 'Success')
            {
                res.status(200).json({status: 1, message: 'Alarm Reset Initiated Successfully... ', data: result[0][0][''] });
            }
            else
            {
                res.status(202).json({status: 0, message: result[0][0] });
            }
        }
        else
        {
            const result = await sequelize.query('EXEC SP_UpdateEquipmentRequest @EquipmentType = :EquipmentType, @Type = :Type, @CreatedUser = :CreatedUser', {
                replacements: { 
                    EquipmentType: data.EquipmentType,
                    Type: data.Type,
                    CreatedUser: req.body.UserName ?? ''
                },
                Type: 'Show'
            });
    
            if(result[0][0] == 'Success')
            {
                res.status(200).json({status: 1, message: 'Alarm Reset Initiated Successfully... ', data: result[0][0] });
            }
            else
            {
                res.status(202).json({status: 0, message: result[0][0] });
            }
        }  
    } 
    catch (error) 
    {
        res.status(202).json({status: 0, message: error.message});
    }
}


module.exports = {
  alarmReset,
  getAll,
  searchAlarmHistory,
  loadUnLoadHistory,
  rejectedHistory,
  maintenanceHistory,
  searchExpiryAlert,
  getExpiryFilters,
  userLogList,
  executeStoredProcedure,
  userEntryLogList,
  insertUserEntryLog,
  resetAlarm
};

