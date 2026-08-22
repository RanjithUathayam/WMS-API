const { Op, where } = require('sequelize');
let jwt = require('jsonwebtoken');
const moment = require('moment');
const { sequelize } = require('../config/database');
const { TableHints } = require('sequelize');

async function tableHeader(type){
    const model = require(`../models/Table_Header`);
    const result = await model.findAll({ attributes: ['details'],where:{type:type},tableHint: TableHints.NOLOCK });
    if(result && result[0].details){
      return result[0].details;
    } 
    else {
      return [];
    }
}

//addressDataLoad Data
const addressDataLoad = async(req,res) =>{
    try 
    {
        const result = await sequelize.query('EXEC SP_ShowModbusData @Type = :Type, @AddressIndex= :AddressIndex,@AddressType= :AddressType', {
            replacements: { 
                Type: req.body.EquipmentNo ?? 1,
                AddressIndex: req.body.AddressIndex ?? '',
                AddressType: req.body.AddressType ?? 4000
            },
            type: sequelize.QueryTypes.SELECT
        });

        const header = await tableHeader('ConveyorAddress');
        res.status(200).json({ status: 1, message: 'Date Get Successfully', data: result, header });
    } 
    catch (error) 
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

const updateRegisterAddress = async(req,res) =>{
    try 
    {
        const result = await sequelize.query('EXEC SP_ShowModbusData @Type = :Type, @AddressIndex= :AddressIndex,@AddressType= :AddressType,@AddressValue= :AddressValue,@Eqpno= :Eqpno', {
            replacements: { 
                Type: 'ResetRegister',
                Eqpno: req.body.EquipmentNo ?? 1,
                AddressIndex: req.body.index ?? '',
                AddressType: req.body.register ?? 4000,
                AddressValue: req.body.value ?? ''
            },
            type: sequelize.QueryTypes.SELECT
        });

        res.status(200).json({ status: 1, message: 'Data Write Successfully', data: result });
    } 
    catch (error) 
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

 
const addressDataLoadopc = async(req,res) =>{
    try
    {
        const result = await sequelize.query(`select * from WCS_KEP_Equp_ReadData_Eq${req.body.EquipmentNo} WITH (NOLOCK)`, {
            type: sequelize.QueryTypes.SELECT
        });
  
        const header = await tableHeader('ConveyorAddressOpc');
        res.status(200).json({ status: 1, message: 'Date Get Successfully', data: result, header });
    }
    catch (error)
    {
        res.status(202).json({status: 0, message: error.message});
    }
}
 
const getEquipmentData = async(req,res) =>{
    try
    {
        const result = await sequelize.query(`select * from EquipmentMaster WITH (NOLOCK) where Type =  '${req.body.equipment}'`, {
            type: sequelize.QueryTypes.SELECT
        });
        const header = await tableHeader('EquipmentConfig');
        res.status(200).json({ status: 1, message: 'Date Get Successfully', data: result, header });
    }
    catch (error)
    {
        res.status(202).json({status: 0, message: error.message});
    }
}
 
const updateEquipmentData = async (req, res) => {
    try {
        let data = req.body;  
        for (const item of data) {
            await sequelize.query(
                `UPDATE EquipmentMaster SET Enable = :enable, Disable = :disable, [In] = :inValue, [Out] = :outValue
                 WHERE AisleNo = :aisleNo AND EquipmentNo = :equipmentNo AND Type = :type`,
                {
                    replacements: {
                        enable: item.Enable,
                        disable: item.Disable,
                        inValue: item.In,
                        outValue: item.Out,
                        aisleNo: item.AisleNo,
                        equipmentNo: item.EquipmentNo,
                        type: item.Type
                    },
                    type: sequelize.QueryTypes.UPDATE
                }
            );
        }
        res.status(200).json({ status: 1, message: 'Data Updated Successfully' });
    } catch (error) {
        res.status(500).json({ status: 0, message: error.message });
    }
};
 
const getEquipmentIPConfigData = async(req,res) =>{
    try
    {
        const result = await sequelize.query(`select * from PLCConfigurationMultipleIP WITH (NOLOCK)`, {
            type: sequelize.QueryTypes.SELECT
        });
        const header = await tableHeader('EquipmentIPConfig');
        res.status(200).json({ status: 1, message: 'Data Get Successfully', data: result, header });
    }
    catch (error)
    {
        res.status(202).json({status: 0, message: error.message});
    }
}
 
const updateEquipmentIPConfigData = async(req,res) =>{
    try
    {
        let data = req.body;  
        const updateResult = await sequelize.query(
            `UPDATE PLCConfigurationMultipleIP SET PLCIP = :PLCIP, PortNumber = :PortNumber, CommunicationDelay = :CommunicationDelay
             WHERE Type = :Type AND EquipmentName = :EquipmentName AND AisleNo = :aisleNo AND EquipmentNo = :equipmentNo`,
            {
                replacements: {
                    PLCIP: data.PLCIP,
                    PortNumber: data.PortNumber,
                    CommunicationDelay: data.CommunicationDelay,
                    Type: data.Type,
                    EquipmentName: data.EquipmentName,
                    aisleNo: data.AisleNo,
                    equipmentNo: data.EquipmentNo
                },
                type: sequelize.QueryTypes.UPDATE
            }
        );
        res.status(200).json({ status: 1, message: 'Data Updated Successfully' });
    }
    catch (error)
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

const getStationConfig = async(req,res) =>{
    try
    {
        const result = await sequelize.query(`select * from Master_Station_Conveyor WITH (NOLOCK)`, {
            type: sequelize.QueryTypes.SELECT
        });
        const header = await tableHeader('StationConfig');
        res.status(200).json({ status: 1, message: 'Data Get Successfully', data: result, header });
    }
    catch (error)
    {
        res.status(202).json({status: 0, message: error.message});
    }
}
 
const updateStationConfig = async (req, res) => {
  try {
    const data = req.body; 
    const updateResult = await sequelize.query(
      `UPDATE Master_Station_Conveyor
       SET StationAssigned = :StationAssigned, MacAddress = :MacAddress
       WHERE ST_Code = :ST_Code AND Floor = :Floor AND GTPStation = :GTPStation`,
      {
        replacements: {
          StationAssigned: data.StationAssigned,
          MacAddress: data.MacAddress,
          ST_Code: data.ST_Code,
          Floor: data.Floor,
          GTPStation: data.GTPStation
        },
        type: sequelize.QueryTypes.UPDATE
      }
    );
 
    if (updateResult[1] > 0) {
      res.status(200).json({ status: 1, message: 'Data Updated Successfully' });
    } else {
      res.status(202).json({ status: 0, message: 'No matching records found to update' });
    }
 
  } catch (error) {
    res.status(202).json({ status: 0, message: error.message });
  }
}

const getPickStationData = async(req,res) =>{
    try
    {
        const result = await sequelize.query(`select * from Master_Station_Conveyor WITH (NOLOCK) where MacAddress = '${req.body.MacAddress}'`, {
            type: sequelize.QueryTypes.SELECT
        });
        
        res.status(200).json({ status: 1, message: 'Data Get Successfully', data: result });
    }
    catch (error)
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

const addAlarmData = async (req, res) => {
    try {
      const { EquipmentType, AlarmData } = req.body;
 
      console.log(AlarmData, 'AlarmData');
 
      if (EquipmentType === 'MLS') {
        for (const alarm of AlarmData) {
          const { ShuttleID, AisleNo, AlarmNo, AlarmDescription } = alarm;
          const tableName = `KEP_MLS_Error_A${AisleNo}`;
 
          const existingRows = await sequelize.query(
            `SELECT * FROM ${tableName} WHERE ShuttleID = ? AND AlarmNo = ?`,
            {
              replacements: [ShuttleID, AlarmNo],
              type: sequelize.QueryTypes.SELECT,
            }
          );
 
          if (existingRows.length > 0) {
            await sequelize.query(
              `UPDATE ${tableName} SET AlarmDescription = ? WHERE ShuttleID = ? AND AlarmNo = ?`,
              {
                replacements: [AlarmDescription, ShuttleID, AlarmNo],
                type: sequelize.QueryTypes.UPDATE,
              }
            );
          } else {
            await sequelize.query(
              `INSERT INTO ${tableName} (ShuttleID, AisleID, AlarmNo, AlarmDescription, Status) VALUES (?, ?, ?, ?, ?)`,
              {
                replacements: [ShuttleID, AisleNo, AlarmNo, AlarmDescription, 0],
                type: sequelize.QueryTypes.INSERT,
              }
            );
          }
        }
      }
 
      // 🔽 ToteLift logic
      else if (EquipmentType === 'ToteLift') {
        for (const alarm of AlarmData) {
          const { LiftID, AisleNo, AlarmNo, AlarmState, Comments } = alarm;
          const tableName = `KEP_TL_Error_A${AisleNo}`;
 
          const existingRows = await sequelize.query(
            `SELECT * FROM ${tableName} WHERE ToteLiftID = ? AND AlarmNo = ?`,
            {
              replacements: [LiftID, AlarmNo],
              type: sequelize.QueryTypes.SELECT,
            }
          );
 
          if (existingRows.length > 0) {
            await sequelize.query(
              `UPDATE ${tableName} SET AlarmState = ?, Comments = ? WHERE ToteLiftID = ? AND AlarmNo = ?`,
              {
                replacements: [AlarmState, Comments, LiftID, AlarmNo],
                type: sequelize.QueryTypes.UPDATE,
              }
            );
          } else {
            await sequelize.query(
              `INSERT INTO ${tableName} (ToteLiftID, AisleID, AlarmNo, AlarmState, Comments, Status) VALUES (?, ?, ?, ?, ?, ?)`,
              {
                replacements: [LiftID, AisleNo, AlarmNo, AlarmState, Comments, 0],
                type: sequelize.QueryTypes.INSERT,
              }
            );
          }
        }
      }
 
      res.status(200).json({ status: 1, message: 'Data Updated Successfully' });
    } catch (error) {
      res.status(202).json({ status: 0, message: error.message });
    }
  } 

module.exports = {
    addressDataLoad,
    updateRegisterAddress,
    addressDataLoadopc,
    getEquipmentData,
    updateEquipmentData,
    getEquipmentIPConfigData,
    updateEquipmentIPConfigData,
    getStationConfig,
    updateStationConfig,
    getPickStationData,
    addAlarmData
}