const { Op, literal } = require('sequelize');
const moment = require('moment');
const { sequelize } = require('../config/database');
const e = require('express');
const TableHeader = require('../models/Table_Header');
const KEPGroundConveyorStatus = require('../models/operation/KEPGroundConveyorStatus');
const { TableHints } = require('sequelize');

async function tableHeader(type){
    const model = require(`../models/Table_Header`);
    const result = await model.findAll({ attributes: ['details'],where:{type:type}, tableHint: TableHints.NOLOCK });
    if(result && result[0].details)
    {
        return result[0].details;
    } 
    else
    {
        return [];
    }
}

const craneStatus = async (req, res) =>{
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


const locationStatus = async (req, res) => {
    try 
    {
        const { AisleNo, Side  } = req.body;

        let query = `SELECT L.EquipmentNo,L.Side,L.Level,L.Bay,
        (SELECT COUNT(BinID) FROM LocationSpecification WITH (NOLOCK) WHERE AisleNo = L.AisleNo AND Side = L.Side AND Level = L.Level AND Bay = L.Bay AND BinID IS NOT NULL AND BinID != '') AS DeepAvlCount
        FROM LocationSpecification AS L WITH (NOLOCK) WHERE `;

        if (AisleNo != '' && AisleNo != undefined) 
        {
            query += `L.AisleNo=${AisleNo}`;
        }

        if (Side != '' && Side != undefined) 
        {
            query += ` AND  L.Side=${Side}`;
        }

        // if use quer1 then comment this
        query += `GROUP BY L.EquipmentNo, L.Side,L.Level,L.Bay,L.AisleNo ORDER BY L.Side,L.Level,L.Bay ASC`;
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


// Equipment Status
const equipmentStatus = async (req, res) => {
    try 
    {
        let status = 0;
        let message = "Invalid Request";

        // Destructure the request body
        const { type, AisleNo, EquipmentNo, mode = '', exportFormat = '' } = req.body;

        // Execute the stored procedure
        const result = await sequelize.query(
            'EXEC SP_getEquipment @Type = :type, @AisleID = :AisleID, @EquipmentNo = :EquipmentNo', 
            {
                replacements: { 
                    type: type,
                    AisleID: (parseInt(AisleNo) ?? 1),
                    EquipmentNo: (parseInt(EquipmentNo) ?? 1)
                },
                type: 'SELECT'  // Ensure the correct type is used
            }
        );

        // Check if the result is returned
        if (result && result.length > 0) 
        {
            status = 1;
            //message = "Crane Alarm Reset";
        } 
        else 
        {
            //message = "Error Crane Alarm Reset";
        }

        if (exportFormat == '') 
        {
            let reqData = {}
            if(result.length > 0)
            {
                reqData = result[0]
            }
            return res.status(200).json({ status: status, message: message, data: reqData });
        } 
        else 
        {
            const { exportData } = require('../models/Export');
            await exportData(res, exportFormat, `Pallet Request Report`, result[0]);
        }

    } 
    catch (error) 
    {
        // Enhanced error logging
        if (error.sql) {
            console.error('SQL:', error.sql);
        }
        if (error.parameters) {
            console.error('Parameters:', error.parameters);
        }

        // Return a detailed error response
        return res.status(202).json({ status: 0, message: error.message});
    }
}

const getLocationDetails = async (req, res) => {
    try 
    {
        const result = await sequelize.query('EXEC SP_InsertUpdate_Load @Type = :type, @Side = :Side, @Level = :Level, @Bay = :Bay', 
            {
                replacements: { 
                    type: 'FrontView',
                    Side: req.body.Side ?? 1,
                    Level: req.body.Level ?? 1,
                    Bay: req.body.Bay ?? 1
                },
                type: sequelize.QueryTypes.SELECT  // Ensure the correct type is used
            }
        );

        let headers = [
            { header: 'Deep', field: 'Deep' },
            { header: 'Bin ID', field: 'BinID' },
            { header: 'Item Code', field: 'ItemCode' },
            { header: 'Item Name', field: 'ItemName' },
            { header: 'Item Group', field: 'ItemGroup' },
            { header: 'Avl Qty', field: 'Quantity' },
            { header: 'Category', field: 'Category' },
            { header: 'Color', field: 'Color' },
            { header: 'Size', field: 'Size' },
            { header: 'Style', field: 'Style' },
            { header: 'BinCapacity', field: 'BinCapacity' },
            { header: 'Location', field: 'LocationID' },
            { header: 'Remarks', field: 'Remarks' },
            { header: 'UpdatedDate', field: 'UpdatedDate' },
          ];
        res.status(200).json({ status: 1, message: 'Success', data: result, headers });
    } 
    catch (error) 
    {
        res.status(202).json({ status: 0, message: error.message });
    }
}

const getLocationManualBinList = async (req, res) => {
    try 
    {
        const result = await sequelize.query('EXEC SP_ManualPalletEntry @Type = :type, @BinID = :BinID', 
            {
                replacements: { 
                    type: req.body.type ??'ListPalletID',
                    BinID: req.body.BinID ?? ''
                },
                type: sequelize.QueryTypes.SELECT  // Ensure the correct type is used
            }
        );
        res.status(200).json({ status: 1, message: 'Success', data: result });
    } 
    catch (error) 
    {
        res.status(202).json({ status: 0, message: error.message });
    }
}

const getLocationManualEntry = async (req, res) => {
    try 
    {
        let data = req.body.data
        const CreatedUser = req.user?.UserName || ''
        let BinID = ''
        let updateType = ''
        if(req.body.type == 'ManPalletLoad')
        {
            BinID = req.body.BinID ?? ''
            updateType = 'Load'
        }
        else
        {
            BinID = data.BinID ?? ''
            updateType = 'Unload'
        }
        
        const result = await sequelize.query('EXEC SP_ManualPalletEntry @Type = :type,@Location = :Location, @BinID = :BinID', 
            {
                replacements: { 
                    type: req.body.type ?? 'ManPalletLoad',
                    Location: req.body.Location ?? '',
                    BinID: BinID
                },
                type: sequelize.QueryTypes.SELECT  // Ensure the correct type is used
            }
        );

        const result2 = await sequelize.query('EXEC SP_ManualPalletEntry @Type = :type,@Location = :Location, @BinID = :BinID, @TransPallet = :TransPallet, @CreatedUser= :CreatedUser, @updateType= :updateType, @PalletValidation= :PalletValidation, @InventoryDelete= :InventoryDelete, @MachineNumber= :MachineNumber', 
            {
                replacements: { 
                    type: 'UpdateManual',
                    Location: req.body.Location ?? '',
                    BinID: BinID ?? '',
                    TransPallet: BinID ?? '',
                    CreatedUser: CreatedUser,
                    PalletValidation: "Y",
                    updateType: updateType,
                    InventoryDelete: "Y",
                    MachineNumber: 1
                },
                type: sequelize.QueryTypes.SELECT  // Ensure the correct type is used
            }
        );

        res.status(200).json({ status: 1, message: "Data Update Successfully", data: result})
    } 
    catch (error) 
    {
        res.status(202).json({ status: 0, message: error.message });
    }
}

// const updateEmergencyScreenData = async (req, res) => {
//     try 
//     {
//         const { EquipmentType, Type, KEP_Lftid, KEP_Shtid, KEP_sysid, mode, Emergency, ErrorReset, AutoStart } = req.body;
//         const CreatedUser = req.user?.UserName || ''
//         // Determine the parameters based on EquipmentType
//         const replacements = {
//             Type: Type || (EquipmentType == 'ToteLift' ? 'Lift Control' : 'Shuttle Control'),
//             EquipmentType: EquipmentType,
//             KEP_Lftid: EquipmentType == 'ToteLift' ? KEP_Lftid || '' : '',
//             KEP_Shtid: EquipmentType == 'MLS' ? KEP_Shtid || '' : '',
//             KEP_sysid: KEP_sysid || '',
//             mode: mode || '',
//             Emergency: Emergency || '',
//             ErrorReset: mode == 'Alarm reset' ? ErrorReset || '' : '',
//             AutoStart: (mode == 'Start Command' || mode == 'Stop Command') ? AutoStart || '' : '',
//             CreatedUser: CreatedUser
//         };

//         // Execute the stored procedure
//         const result = await sequelize.query('EXEC SP_UpdateEquipmentRequest_KEPWARE @Type = :Type, @EquipmentType = :EquipmentType, @KEP_Lftid = :KEP_Lftid, @KEP_Shtid = :KEP_Shtid, @KEP_sysid = :KEP_sysid, @mode = :mode, @Emergency = :Emergency, @CreatedUser = :CreatedUser, @ErrorReset = :ErrorReset', 
//             {
//                 replacements,
//                 type: sequelize.QueryTypes.SELECT
//             }
//         );

//         res.status(200).json({ status: 1, message: 'Success', data: result[0] });
//     } 
//     catch (error) 
//     {
//         res.status(202).json({ status: 0, message: error.message });
//     }
// };

const updateEmergencyScreenData = async (req, res) => {
    try {
        const { EquipmentType, Type, KEP_Lftid, KEP_Shtid, KEP_sysid, mode, Emergency, ErrorReset, AutoStart, AutoStop } = req.body;
        const CreatedUser = req.user?.UserName || '';

        // Determine the parameters based on EquipmentType
        const replacements = {
            Type: Type || (EquipmentType == 'ToteLift' ? 'Lift Control' : 'Shuttle Control'),
            EquipmentType: EquipmentType,
            KEP_Lftid: EquipmentType == 'ToteLift' ? KEP_Lftid || '' : '',
            KEP_Shtid: EquipmentType == 'MLS' ? KEP_Shtid || '' : '',
            KEP_sysid: KEP_sysid || '',
            mode: mode || '',
            Emergency: Emergency || '',
            ErrorReset: mode == 'Alarm reset' ? ErrorReset || '' : '',
            AutoStart: mode === 'Start Command' ? AutoStart : null,
            AutoStop : mode === 'Stop Command' ? AutoStop : null, // Ensuring AutoStart is either true/false or null
            CreatedUser: CreatedUser
        };

        // Execute the stored procedure
        const result = await sequelize.query('EXEC SP_UpdateEquipmentRequest_KEPWARE @Type = :Type, @EquipmentType = :EquipmentType, @KEP_Lftid = :KEP_Lftid, @KEP_Shtid = :KEP_Shtid, @KEP_sysid = :KEP_sysid, @mode = :mode, @Emergency = :Emergency, @CreatedUser = :CreatedUser, @ErrorReset = :ErrorReset, @AutoStart = :AutoStart, @AutoStop=:AutoStop', 
            {
                replacements,
                type: sequelize.QueryTypes.SELECT
            }
        );

        res.status(200).json({ status: 1, message: 'Success', data: result[0] });
    } catch (error) {
        res.status(202).json({ status: 0, message: error.message });
    }
};

const updateEmergencyStationStart = async (req, res) => {
    try 
    {
        let data = req.body;
        let UserName = req.user?.UserName || '';
        if (data.equipmentType == "ToteLift")
        {
            if (data.equipment_no) 
            {
                const commEnabled = await checkServiceCommLift(data.equipment_no, data.aisleId);
                if (commEnabled) 
                {
                    let enableCarriage = 0;
                    if (data.processType == "Carriage Enabled Command") 
                    {
                        let enableCarraige = 0;
                        let CarriageDetails = {}
                        data.carriage_manual.forEach(item => {
                            if(item.name == 'Carriage 1')
                            {
                                CarriageDetails['carriage1'] = item.checked
                            }
                            if(item.name == 'Carriage 2')
                            {
                                CarriageDetails['carriage2'] = item.checked
                            }
                            if(item.name == 'Carriage 3')
                            {
                                CarriageDetails['carriage3'] = item.checked
                            }
                            if(item.name == 'Carriage 4')
                            {
                                CarriageDetails['carriage4'] = item.checked
                            }
                        });

                        if (CarriageDetails.carriage1 == true || CarriageDetails.carriage2 == true || CarriageDetails.carriage3 == true || CarriageDetails.carriage4 == true)
                        {

                            if (CarriageDetails.carriage1 == true && CarriageDetails.carriage2 == false && CarriageDetails.carriage3 == false && CarriageDetails.carriage4 == false)
                            {
                                enableCarraige = 1;
                            }
                            else if (CarriageDetails.carriage2 == true && CarriageDetails.carriage1 == false && CarriageDetails.carriage3 == false && CarriageDetails.carriage4 == false)
                            {
                                enableCarraige = 2;
                            }
                            else if (CarriageDetails.carriage1 == true && CarriageDetails.carriage2 == true && CarriageDetails.carriage3 == false && CarriageDetails.carriage4 == false)
                            {
                                enableCarraige = 3;
                            }
                            else if (CarriageDetails.carriage3 == true && CarriageDetails.carriage1 == false && CarriageDetails.carriage2 == false && CarriageDetails.carriage4 == false)
                            {
                                enableCarraige = 4;
                            }
                            else if (CarriageDetails.carriage1 == true && CarriageDetails.carriage3 == true && CarriageDetails.carriage2 == false && CarriageDetails.carriage4 == false)
                            {
                                enableCarraige = 5;
                            }
                            else if (CarriageDetails.carriage2 == true && CarriageDetails.carriage3 == true && CarriageDetails.carriage1 == false && CarriageDetails.carriage4 == false)
                            {
                                enableCarraige = 6;
                            }
                            else if (CarriageDetails.carriage1 == true && CarriageDetails.carriage2 == true && CarriageDetails.carriage3 == true && CarriageDetails.carriage4 == false)
                            {
                                enableCarraige = 7;
                            }
                            else if (CarriageDetails.carriage4 == true && CarriageDetails.carriage2 == false && CarriageDetails.carriage3 == false && CarriageDetails.carriage1 == false)
                            {
                                enableCarraige = 8;
                            }
                            else if (CarriageDetails.carriage1 == true && CarriageDetails.carriage4 == true && CarriageDetails.carriage2 == false && CarriageDetails.carriage3 == false)
                            {
                                enableCarraige = 9;
                            }
                            else if (CarriageDetails.carriage2 == true && CarriageDetails.carriage4 == true && CarriageDetails.carriage1 == false && CarriageDetails.carriage3 == false)
                            {
                                enableCarraige = 10;
                            }
                            else if (CarriageDetails.carriage1 == true && CarriageDetails.carriage2 == true && CarriageDetails.carriage4 == true && CarriageDetails.carriage3 == false)
                            {
                                enableCarraige = 11;
                            }
                            else if (CarriageDetails.carriage3 == true && CarriageDetails.carriage4 == true && CarriageDetails.carriage1 == false && CarriageDetails.carriage2 == false)
                            {
                                enableCarraige = 12;
                            }
                            else if (CarriageDetails.carriage1 == true && CarriageDetails.carriage3 == true && CarriageDetails.carriage4 == true && CarriageDetails.carriage2 == false)
                            {
                                enableCarraige = 13;
                            }
                            else if (CarriageDetails.carriage2 == true && CarriageDetails.carriage3 == true && CarriageDetails.carriage4 == true && CarriageDetails.carriage1 == false)
                            {
                                enableCarraige = 14;
                            }
                            else if (CarriageDetails.carriage1 == true && CarriageDetails.carriage2 == true && CarriageDetails.carriage3 == true && CarriageDetails.carriage4 == true)
                            {
                                enableCarraige = 15;
                            }
                        
                            let liftCommandResult = await liftCommand(data.equipment_no, data.aisleId, data.processType, enableCarraige, UserName);
                            if (liftCommandResult.status == 1) 
                            {
                                res.status(200).json({ status: 1, message: liftCommandResult.message });
                            } 
                            else
                            {
                                res.status(202).json({ status: 0, message: liftCommandResult.message });
                            }
                        }
                        else
                        {
                           res.status(202).json({ status: 0, message: "Please check any of the carriages" });
                        }
                    }
                    else
                    {
                        let liftCommandResult = await liftCommand(parseInt(data.equipment_no), parseInt(data.aisleId), data.processType, enableCarriage, UserName);
                        if (liftCommandResult.message == 'Success') 
                        {
                            res.status(200).json({ status: 1, message: "Command Initiated Successfully" });
                        } 
                        else
                        {
                            res.status(202).json({ status: 0, message: liftCommandResult.message });
                        }
                    }
                }
                else
                {
                    res.status(202).json({ status: 0, message: "Communication Service is not running" });
                }
            } 
            else {
                res.status(202).json({ status: 0, message: "Equipment number shouldn't be empty" });
            }
        } 
        else if (data.equipmentType == "MLS")
        {
            if (data.equipmentNo != '') 
            {
                if (checkServiceCommMLS(data.equipmentNo, data.aisleID)) 
                {
                    let enableShuttle;
                    const isShuttleControl = data.processType == "Shuttle Enable/Disable";
            
                    // Determine `enableShuttle` value if process type is shuttle control
                    if (isShuttleControl) 
                    {
                        enableShuttle = data.shuttleEnableorDisable == "Enable" ? 2 : 1;
                    }
            
                    // Prepare parameters for the query
                    const params = {
                        Type: 'Shuttle Control',
                        EquipmentType: 'MLS',
                        Mode: data.processType,
                        KEP_Shtid: parseInt(data.equipment_no),
                        KEP_sysid: parseInt(data.aisleId),
                        CreatedUser: UserName,
                        ...(isShuttleControl && { KEP_EnbSht: enableShuttle }) // Include only if shuttle control
                    };
            
                    // Query string
                    const query = `EXEC SP_UpdateEquipmentRequest_KEPWARE 
                                   @Type = :Type, 
                                   @Mode = :Mode, 
                                   @EquipmentType = :EquipmentType, 
                                   @KEP_Shtid = :KEP_Shtid, 
                                   @KEP_sysid = :KEP_sysid,
                                   ${isShuttleControl ? '@KEP_EnbSht = :KEP_EnbSht,' : ''}
                                   @CreatedUser = :CreatedUser;`;
            
                    // Execute the query
                    const result = await sequelize.query(query, {
                        replacements: params,
                        type: sequelize.QueryTypes.SELECT,
                    });
                    // Check and respond based on result
                    const message = result[0][''] == 'Success' ? { status: 1, message: "Success" } : { status: 0, message: result[0][''] };
                    res.status(message.status == 1 ? 200 : 202).json(message);
                } 
                else 
                {
                    res.status(202).json({ status: 0, message: "Communication Service is not running" });
                }
            } 
            else 
            {
                res.status(202).json({ status: 0, message: "Equipment number shouldn't be empty" });
            }
        }
        else 
        {
            res.status(202).json({ status: 0, message: "Equipment Type should be Lift/MLS" });
        }
    } 
    catch (error) 
    {
        res.status(202).json({ status: 0, message: error.message });
    }
}

// location maintenance
async function locationMaintenance(req, res) {
    const { 
        SideValue = '', 
        LevelValue = '', 
        BayValue = '', 
        DeepValue = '', 
        ShowType = 'All', 
        Type 
    } = req.body;

    try {
        const result = await sequelize.query(
            'EXEC SP_LocationMaintenance @SideValue = :SideValue, @LevelValue = :LevelValue, @BayValue = :BayValue, @DeepValue = :DeepValue, @ShowType = :ShowType, @Type = :Type', 
            {
                replacements: {
                    Type: Type,
                    SideValue: SideValue,
                    LevelValue: LevelValue,
                    BayValue: BayValue,
                    DeepValue: DeepValue,
                    ShowType: ShowType
                }
            }
        ); 

        const header= await tableHeader('Location Maintenance');

        res.status(200).json({
            status: 1,
            message: "Location Maintenance Fetched Successfully",
            header,
            data: result[0]
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            status: 0,
            message: error.message
        });
    }
}

//Update Location Maintenance
async function updateLocationMaintenance(req, res) {
    try {
        const data = req.body; // Array of objects from the frontend
  
        // Use Promise.all to execute all updates in parallel
        const results = await Promise.all(
            data.map(async (item) => {
                // Construct and execute the SQL UPDATE query
                return await sequelize.query(
                    `UPDATE [LocationSpecification]
                     SET Error = :ErrorStatus
                     WHERE Side = :SideValue AND Level = :LevelValue AND Bay = :BayValue AND Deep = :DeepValue`,
                    {
                        replacements: {
                            ErrorStatus: item.ErrorStatus ? 1 : 0, // Convert boolean to 1/0
                            SideValue: item.SideValue,
                            LevelValue: item.LevelValue,
                            BayValue: item.BayValue,
                            DeepValue: item.DeepValue,
                        },
                    }
                );
            })
        );

        res.status(200).json({
            status: 1,
            message: 'Location Maintenance Updated Successfully',
            data: results,
        });
    } catch (error) {
        console.error('Error in updateLocationMaintenance:', error);
        res.status(500).json({
            status: 0,
            message: error.message,
        });
    }
}




// Check Service Communication for Lift
async function checkServiceCommLift(toteLiftID, aisleID) {
    let returnValue = true;
    try 
    {
        // Check Windows_Service
        const serviceResult = await sequelize.query(`SELECT * FROM Windows_Service WITH (NOLOCK) WHERE EquipmentType = 'Lift' AND EquipmentID = '${toteLiftID}' AND AisleID = '${aisleID}'`);
        if (serviceResult[0].length == 0 || !serviceResult[0][0].StartFlag)
        {
            returnValue = false;
        }

        if (returnValue) 
        {
            // Check WCSCommunication_lift
            const commResult = await sequelize.query(`SELECT * FROM WCSCommunication_lift WITH (NOLOCK) WHERE ToteliftID = '${toteLiftID}' AND AisleID = '${aisleID}'`);
            
            if (commResult[0].length == 0 || commResult[0][0].Communication !== 1) 
            {
                returnValue = false;
            }

            // Check EquipmentMaster
            const enableResult = await sequelize.query(`SELECT * FROM EquipmentMaster WITH (NOLOCK) WHERE Type = 'Lift' AND EquipmentNo = '${toteLiftID}'`);
            if (enableResult[0].length == 0 || !enableResult[0][0].Enable) 
            {
                returnValue = false;
            }
        }
        return returnValue;
    } 
    catch (error) 
    {
        returnValue = false;
        return returnValue;
    }
}

// Check Service Communication for MLS
async function checkServiceCommMLS(MLSID, aisleID) {
    let returnValue = true;
    try 
    {
        // Check Windows_Service
        const serviceResult = await sequelize.query(`select * from Windows_Service WITH (NOLOCK) where  EquipmentType='MLS' and EquipmentID= '${MLSID}' and AisleID= '${aisleID}' `);
        
        if (serviceResult[0].length == 0 || !serviceResult[0][0].StartFlag) {
            returnValue = false;
        }

        if (returnValue) 
        {
            // Check WCSCommunication_lift
            const commResult = await sequelize.query(`select * from WCSCommunication_MLS WITH (NOLOCK) where ShuttleID= '${MLSID}' and AisleNo= '${aisleID}'  `);
            
            if (commResult[0].length == 0 || commResult[0][0].Communication !== 1) 
            {
                returnValue = false;
            }

            // Check EquipmentMaster
            const enableResult = await sequelize.query(`select * from EquipmentMaster WITH (NOLOCK) where Type = 'MLS' and EquipmentNo = '${MLSID}' and AisleID = '${aisleID}'`);
            
            if (enableResult[0].length == 0 || !enableResult[0][0].Enable) 
            {
                returnValue = false;
            }
        }

        return returnValue;
    } 
    catch (error) 
    {
        returnValue = false;
        return returnValue;
    }
}

// Lift Command
async function liftCommand(equipmentNo, aisle, mode, enableCarriage, UserName) {
    try 
    {
        const params = {
            EquipmentType: 'ToteLift',
            KEP_Lftid: equipmentNo,
            KEP_sysid: aisle,
            Type: 'Lift Control',
            mode,
            CreatedUser: UserName,
        };
    
        if (mode == 'Carriage Enabled Command') 
        {
            params.KEP_EnbCarriage = enableCarriage;
        }

        const query = `
            DECLARE @response NVARCHAR(50);
            EXEC SP_UpdateEquipmentRequest_KEPWARE 
                @EquipmentType = :EquipmentType, 
                @KEP_Lftid = :KEP_Lftid, 
                @KEP_sysid = :KEP_sysid, 
                @Type = :Type, 
                @mode = :mode, 
                ${mode == 'Carriage Enabled Command' ? '@KEP_EnbCarriage = :KEP_EnbCarriage,' : ''}
                @CreatedUser = :CreatedUser;
            SELECT @response AS response;
        `;

        const result = await sequelize.query(query, {
            replacements: params,
            type: sequelize.QueryTypes.SELECT,
        });
        if(result[0][''] == 'Success')
        {
            return { status: 1, message: 'Success', data: result[0][''] };
        }
        else
        {
            return { status: 0, message: result[0][''] };
        }
        
    } 
    catch (error) 
    {
        return { status: 1, message: error.message,};
    }
}

const updateEmergencySemiautoCommand = async (req, res) => {
    try 
    {
        const {
            aisleId,
            carriageId,
            carriageType,
            carriage_auto,
            equipmentType,
            equipment_no,
            fingers,
            locationType,
            processType,
            side,
            deep,
            level,
            bay,
            velocity,
            station
        } = req.body;

        let enableCarraige = 0;
        let loc = '';
        let levelvalue = '';
        let finger = 0;
        let Mode = '';
        let UserName = req.user.UserName;

        if (equipmentType == 'ToteLift') 
        {
            if (equipment_no != '') 
            {
                if (await checkServiceCommLift(equipment_no, aisleId)) 
                {
                    Mode = await Totelift_CheckMode(equipment_no);
                    if (Mode == 'SemiAutomatic') 
                    {
                        if (processType == 'Carriage Move Command') 
                        {
                            if (carriageType) 
                            {
                                if (carriageId) 
                                {
                                    enableCarraige = carriageId == 'Carriage 1' ? 1 :
                                                    carriageId == 'Carriage 2' ? 2 :
                                                    carriageId == 'Carriage 3' ? 4 :
                                                    carriageId == 'Carriage 4' ? 8 : 0;

                                    if (locationType !== '') 
                                    {
                                        loc = locationType == 'Station' ? 'STN' : 'BUFC';

                                        if (carriageType == 'Outward Carriage') 
                                        {
                                            levelvalue = level == '1' ? '10' :
                                                level == '2' ? '9' :
                                                level == '3' ? '8' : '';
                                        } 
                                        else if (carriageType == 'Inward Carriage') 
                                        {
                                            levelvalue = level == '1' ? '1' :
                                                level == '2' ? '2' :
                                                level == '3' ? '3' : '';
                                        }

                                        if (level !== '') 
                                        {
                                            let result = await LiftSemiAutoCommand(equipment_no, processType, enableCarraige, loc, levelvalue, velocity, UserName);
                                            if(result.status == 1)
                                            {
                                                res.status(200).send({status:1, message:"Success"});
                                                return;
                                            }
                                            else
                                            {
                                                res.status(202).send({status:0, message:result.message});
                                                return;
                                            }
                                        } 
                                        else 
                                        {
                                            res.status(202).send({status:0, message:"Level number shouldn't be empty"});
                                            return;
                                        }
                                    } 
                                    else 
                                    {
                                        res.status(202).send({status:0, message:"LocationType number shouldn't be empty"});
                                        return;
                                    }
                                } 
                                else 
                                {
                                    res.status(202).send({status:0, message:"CarriageID shouldn't be empty"});
                                    return;
                                }
                            } 
                            else 
                            {
                                res.status(202).send({status:0, message:"Carriage Type shouldn't be empty"});
                                return;
                            }
                        } 
                        else if (['Finger Open', 'Finger Close'].includes(processType)) 
                        {
                            let semicarriage1 = ''
                            let semicarriage2 = ''
                            let semicarriage3 = ''
                            let semicarriage4 = ''

                            carriage_auto.forEach(item => {
                                if(item.name == 'Carriage 1')
                                {
                                    semicarriage1 = item.checked
                                }
                                if(item.name == 'Carriage 2')
                                {
                                    semicarriage2 = item.checked
                                }
                                if(item.name == 'Carriage 3')
                                {
                                    semicarriage3 = item.checked
                                }
                                if(item.name == 'Carriage 4')
                                {
                                    semicarriage4 = item.checked
                                }
                            });

                            let finger1 = false
                            let finger2 = false
                            fingers.forEach(item =>{
                                if(item.name == 'Finger 1')
                                {
                                    finger1 = item.checked
                                }
                                if(item.name == 'Finger 2')
                                {
                                    finger2 = item.checked
                                }
                            })

                            if ((semicarriage1 && !semicarriage2) || (semicarriage3 && !semicarriage4) || 
                                (!semicarriage1 && semicarriage2) || (!semicarriage3 && semicarriage4)) 
                            {

                                enableCarraige = semicarriage1 && !semicarriage2 && !semicarriage3 && !semicarriage4 ? 1 :
                                                 semicarriage2 && !semicarriage1 && !semicarriage3 && !semicarriage4 ? 2 :
                                                 semicarriage1 && semicarriage2 && !semicarriage3 && !semicarriage4 ? 3 :
                                                 semicarriage3 && !semicarriage1 && !semicarriage2 && !semicarriage4 ? 4 :
                                                 semicarriage1 && semicarriage3 && !semicarriage2 && !semicarriage4 ? 5 :
                                                 semicarriage2 && semicarriage3 && !semicarriage1 && !semicarriage4 ? 6 :
                                                 semicarriage1 && semicarriage2 && semicarriage3 && !semicarriage4 ? 7 :
                                                 semicarriage4 && !semicarriage2 && !semicarriage3 && !semicarriage1 ? 8 : 0;

                                finger = finger1 && !finger2 ? 1 : !finger1 && finger2 ? 2 : 3;
                              
                                let result = await LiftSemiAutoCommand(aisleId, processType, enableCarraige, '', finger, velocity, UserName);
                                if(result.status == 1)
                                {
                                    res.status(200).send({status:1, message:"Success"});
                                    return;
                                }
                                else
                                {
                                    res.status(202).send({status:0, message:result.message});
                                    return;
                                }
                            } 
                            else 
                            {
                                res.status(202).send({status:0, message:"Please check any one of the carriages"});
                                return;
                            }
                        }
                    } 
                    else 
                    {
                        res.status(202).send({status:0, message:"Totelift not in SemiAutomatic Mode"});
                        return;
                    }
                }
                else
                {
                    res.status(202).send({status:0, message:"Communication Service is not running"});
                }
            } 
            else 
            {
                res.status(202).send({status:0, message:"Equipment number shouldn't be empty"});
                return;
            }
        } 
        else if (equipmentType == 'MLS') 
        {
            if(aisleId != '')
            {
                if(equipment_no != '')
                {
                    Mode =  await MLS_CheckMode(equipment_no, aisleId);
                    let MLSErrorcheck = await MLS_errorcheck(equipment_no, aisleId);   

                    if (Mode == "SemiAutomatic")
                    {
                        if (MLSErrorcheck == "Ready" || MLSErrorcheck == "Not Ready")
                        {
                            if (processType == "Bin Store" || processType == "Bin Retreival" || processType == "Fork IN")
                            {
                                if(side != '')
                                {
                                    //if(velocity != '')
                                    {
                                        if(deep != '')
                                        {
                                            const result = await sequelize.query(
                                                `EXEC SP_UpdateEquipmentRequest_KEPWARE 
                                                    @Type = :type, 
                                                    @Mode = :Mode, 
                                                    @EquipmentType = :equipmentType, 
                                                    @KEP_Shtid = :equipmentNo, 
                                                    @KEP_sysid = :aisleId, 
                                                    @KEP_Parameter1 = :parameter1, 
                                                    @KEP_Parameter2 = :parameter2, 
                                                    @KEP_Parameter3 = :parameter3, 
                                                    @KEP_Parameter4 = :parameter4,
                                                    @CreatedUser = :createdUser`,
                                                {
                                                    replacements: {
                                                        type: 'Shuttle SemiControl',
                                                        Mode: processType,
                                                        equipmentType: 'MLS',
                                                        equipmentNo: equipment_no,
                                                        aisleId: aisleId,
                                                        parameter1: locationType,
                                                        parameter2: side,
                                                        parameter3: deep,
                                                        parameter4: velocity,
                                                        createdUser: UserName,
                                                    },
                                                    type: sequelize.QueryTypes.SELECT,
                                                }
                                            );

                                            if (result && result.length > 0) {
                                                const response = result[0][''];
                                                
                                                if (response == 'Success') 
                                                {
                                                    res.status(200).send({status:1, message:"Command Initiated Successfully"});
                                                    return
                                                } 
                                                else 
                                                {
                                                    res.status(202).send({status:0, message:response});
                                                    return
                                                }
                                            } 
                                            else 
                                            {
                                                res.status(202).send({status:0, message:'No response from the stored procedure.'});
                                                return
                                            }
                                        }
                                        else
                                        {
                                            res.status(202).send({status:0, message:"Deep shouldn't be empty"});
                                            return
                                        }
                                    }
                                    // else
                                    // {
                                    //     res.status(202).send({status:0, message:"Velocity shouldn't be empty"});
                                    //     return
                                    // }
                                }
                                else
                                {
                                    res.status(202).send({status:0, message:"Side shouldn't be empty"});
                                    return
                                }
                            }
                            else if (processType == "Bin Pick" || processType == "Bin Drop")
                            {
                                if(locationType != '')
                                {
                                    if (side != "" || locationType == "STN")
                                    {
                                        if (bay != "" || locationType == "STN")
                                        {
                                            if (level != "" || locationType == "STN")
                                            {
                                                if (deep != "" || locationType == "STN")
                                                {
                                                    let query = `EXEC SP_UpdateEquipmentRequest_KEPWARE 
                                                    @Type=:type, 
                                                    @Mode=:Mode, 
                                                    @EquipmentType=:equipmentType, 
                                                    @KEP_Shtid=:shtId, 
                                                    @KEP_sysid=:sysId, 
                                                    @KEP_Parameter1=:parameter1, 
                                                    @Side=:side, 
                                                    @Deep=:deep, 
                                                    @Level=:level, 
                                                    @Bay=:bay, 
                                                    @KEP_Parameter2=:parameter2, 
                                                    @CreatedUser=:createdUser`

                                                    const params = {
                                                        type: 'Shuttle SemiControl',
                                                        Mode: processType,
                                                        equipmentType: 'MLS',
                                                        shtId: equipment_no,
                                                        sysId: aisleId,
                                                        parameter1: locationType,
                                                        side: locationType == 'AWH' ? side : null,
                                                        deep: locationType == 'AWH' ? deep : null,
                                                        level: locationType == 'AWH' ? level : null,
                                                        bay: locationType == 'AWH' ? bay : null,
                                                        parameter2: locationType == 'STN' ? station.includes('LS') ? 1 : station.includes('US') ? 0 : null: null,
                                                        createdUser: UserName,
                                                    };
                                                    
                                                    const result = await sequelize.query(query, {
                                                        replacements: params,
                                                        type: sequelize.QueryTypes.SELECT,
                                                    }); 

                                                    if (result && result.length > 0) 
                                                    {
                                                        const response = result[0][''];
                                                        
                                                        if (response == 'Success') 
                                                        {
                                                            res.status(200).send({status:1, message:"Command Initiated Successfully"});
                                                            return
                                                        } 
                                                        else 
                                                        {
                                                            res.status(202).send({status:0, message:response});
                                                            return
                                                        }
                                                    } 
                                                    else 
                                                    {
                                                        res.status(202).send({status:0, message:'No response from the stored procedure.'});
                                                        return
                                                    }
                                                }
                                                else
                                                {
                                                    res.status(202).send({status:0, message:"Deep shouldn't be empty."});
                                                    return
                                                }
                                            }
                                            else
                                            {
                                                res.status(202).send({status:0, message:"Level shouldn't be empty"});
                                                return
                                            }
                                        }
                                        else
                                        {
                                            res.status(202).send({status:0, message:"Bay shouldn't be empty"});
                                            return
                                        }
                                    }
                                    else
                                    {
                                        res.status(202).send({status:0, message:"Side shouldn't be empty"});
                                        return
                                    }                                        
                                }
                                else
                                {
                                    res.status(202).send({status:0, message:"Location Type shouldn't be empty"});
                                    return
                                }
                            }
                            else if (processType == "Shuttle Move")
                            {
                                if(locationType != '')
                                {
                                    if((bay != '') || (station != ''))
                                    {
                                        //if(velocity != '')
                                        {
                                            const params = {
                                                type: 'Shuttle SemiControl',
                                                Mode: processType,
                                                equipmentType: 'MLS',
                                                shtId: equipment_no,
                                                sysId: aisleId,
                                                parameter1: locationType,
                                                parameter4: side,
                                                createdUser: UserName,
                                            };
                                    
                                            // Handle conditional parameters
                                            if (locationType == 'AWH') 
                                            {
                                                params[`parameter2`] = bay
                                                params[`parameter3`] = level
                                            } 
                                            else if (locationType == 'STN') 
                                            {
                                                params.parameter2 = station.includes('U') ? 1 : 2;
                                                params[`parameter3`] = level
                                            }

                                            const query = `EXEC SP_UpdateEquipmentRequest_KEPWARE 
                                            @Type=:type, 
                                            @Mode=:Mode, 
                                            @EquipmentType=:equipmentType, 
                                            @KEP_Shtid=:shtId, 
                                            @KEP_sysid=:sysId, 
                                            @KEP_Parameter1=:parameter1, 
                                            @KEP_Parameter2=:parameter2, 
                                            @KEP_Parameter3=:parameter3, 
                                            @KEP_Parameter4=:parameter4, 
                                            @CreatedUser=:createdUser`;
            
                                            const result = await sequelize.query(query, {
                                                replacements: params,
                                                type: sequelize.QueryTypes.SELECT,
                                            });
                                           
                                            if (result && result.length > 0) 
                                            {
                                                const message = result[0][''] // Assuming the SP returns a column named 'Result'
                                                if (message == 'Success') 
                                                {
                                                    res.status(200).send({status:1, message:'Command Initiated Successfully'});
                                                    return
                                                } 
                                                else 
                                                {
                                                    res.status(202).send({status:0, message:message});
                                                    return
                                                }
                                            }
                                            else 
                                            {
                                                res.status(202).send({status:0, message:'No response from the stored procedure.'});
                                                return
                                            }  
                                        }
                                        // else
                                        // {
                                        //     res.status(202).send({status:0, message:"Velocity shouldn't be empty"});
                                        //     return
                                        // }
                                    }
                                    else
                                    {
                                        res.status(202).send({status:0, message:"Bay or Station shouldn't be empty"});
                                        return
                                    }
                                }
                                else
                                {
                                    res.status(202).send({status:0, message:"Location Type shouldn't be empty"});
                                    return
                                }
                            }
                            else if(processType == "Fork Home")
                            {
                                const params = {
                                    type: 'Shuttle SemiControl',
                                    Mode: processType,
                                    equipmentType: 'MLS',
                                    shtId: equipment_no,
                                    sysId: aisleId,
                                    parameter2: velocity,
                                    createdUser: UserName,
                                };
                                    
                                const query = `EXEC SP_UpdateEquipmentRequest_KEPWARE 
                                @Type=:type, 
                                @Mode=:Mode, 
                                @EquipmentType=:equipmentType, 
                                @KEP_Shtid=:shtId, 
                                @KEP_sysid=:sysId, 
                                @KEP_Parameter2=:parameter2, 
                                @CreatedUser=:createdUser`;
                        
                                const result = await sequelize.query(query, {
                                    replacements: params,
                                    type: sequelize.QueryTypes.SELECT,
                                });

                                if (result && result.length > 0) 
                                {
                                    const message = result[0][''] // Assuming the SP returns a column named 'Result'
                                    if (message == 'Success') 
                                    {
                                        res.status(200).send({status:1, message:'Command Initiated Successfully'});
                                        return
                                    } 
                                    else 
                                    {
                                        res.status(202).send({status:0, message:message});
                                        return
                                    }
                                }
                                else 
                                {
                                    res.status(202).send({status:0, message:'No response from the stored procedure.'});
                                    return
                                }
                            }
                            else if((processType == "Finger Open") || (processType == "Finger Close"))
                            {
                                let MLSFinger1 = ''
                                let MLSFinger2 = ''
                                let MLSFinger3 = ''
                                let MLSFinger4 = ''

                                fingers.forEach(item => {
                                    if(item.name == 'Finger 1')
                                    {
                                        MLSFinger1 = item.checked
                                    }
                                    if(item.name == 'Finger 2')
                                    {
                                        MLSFinger2 = item.checked
                                    }
                                    if(item.name == 'Finger 3')
                                    {
                                        MLSFinger3 = item.checked
                                    }
                                    if(item.name == 'Finger 4')
                                    {
                                        MLSFinger4 = item.checked
                                    }
                                });

                                let Fingeraccess = 0
                                if (MLSFinger1 == true || MLSFinger2 == true || MLSFinger3 == true || MLSFinger4 == true)
                                {
                                    if (MLSFinger1 == true && MLSFinger2 == false && MLSFinger3 == false && MLSFinger4 == false)
                                    {
                                        Fingeraccess = 1;
                                    }
                                    else if (MLSFinger2 == true && MLSFinger1 == false && MLSFinger3 == false && MLSFinger4 == false)
                                    {
                                        Fingeraccess = 2;
                                    }
                                    else if (MLSFinger1 == true && MLSFinger2 == true && MLSFinger3 == false && MLSFinger4 == false)
                                    {
                                        Fingeraccess = 3;
                                    }
                                    else if (MLSFinger3 == true && MLSFinger1 == false && MLSFinger2 == false && MLSFinger4 == false)
                                    {
                                        Fingeraccess = 4;
                                    }
                                    else if (MLSFinger1 == true && MLSFinger3 == true && MLSFinger2 == false && MLSFinger4 == false)
                                    {
                                        Fingeraccess = 5;
                                    }
                                    else if (MLSFinger2 == true && MLSFinger3 == true && MLSFinger1 == false && MLSFinger4 == false)
                                    {
                                        Fingeraccess = 6;
                                    }
                                    else if (MLSFinger1 == true && MLSFinger2 == true && MLSFinger3 == true && MLSFinger4 == false)
                                    {
                                        Fingeraccess = 7;
                                    }
                                    else if (MLSFinger4 == true && MLSFinger2 == false && MLSFinger3 == false && MLSFinger1 == false)
                                    {
                                        Fingeraccess = 8;
                                    }
                                    else if (MLSFinger1 == true && MLSFinger4 == true && MLSFinger2 == false && MLSFinger3 == false)
                                    {
                                        Fingeraccess = 9;
                                    }
                                    else if (MLSFinger2 == true && MLSFinger4 == true && MLSFinger1 == false && MLSFinger3 == false)
                                    {
                                        Fingeraccess = 10;
                                    }
                                    else if (MLSFinger1 == true && MLSFinger2 == true && MLSFinger4 == true && MLSFinger3 == false)
                                    {
                                        Fingeraccess = 11;
                                    }
                                    else if (MLSFinger3 == true && MLSFinger4 == true && MLSFinger1 == false && MLSFinger2 == false)
                                    {
                                        Fingeraccess = 12;
                                    }
                                    else if (MLSFinger1 == true && MLSFinger3 == true && MLSFinger4 == true && MLSFinger2 == false)
                                    {
                                        Fingeraccess = 13;
                                    }
                                    else if (MLSFinger2 == true && MLSFinger3 == true && MLSFinger4 == true && MLSFinger1 == false)
                                    {
                                        Fingeraccess = 14;
                                    }
                                    else if (MLSFinger1 == true && MLSFinger2 == true && MLSFinger3 == true && MLSFinger4 == true)
                                    {
                                        Fingeraccess = 15;
                                    }

                                    const query = `EXEC SP_UpdateEquipmentRequest_KEPWARE 
                                    @Type=:type, 
                                    @Mode=:Mode, 
                                    @EquipmentType=:equipmentType, 
                                    @KEP_Shtid=:shtId, 
                                    @KEP_sysid=:sysId, 
                                    @KEP_Parameter2=:parameter2, 
                                    @CreatedUser=:createdUser`;

                                    const params = {
                                        type: 'Shuttle SemiControl',
                                        Mode: processType,
                                        equipmentType: 'MLS',
                                        shtId: equipment_no,
                                        sysId: aisleId,
                                        parameter2: Fingeraccess,
                                        createdUser: UserName,
                                    };
                                    
                                    const result = await sequelize.query(query, {
                                        replacements: params
                                    });

                                    if (result && result.length > 0) 
                                    {
                                        const message = result[0][0]['']; // Assuming the SP returns a column named 'Result'
                                        if (message == 'Success') 
                                        {
                                            res.status(200).send({status:1, message:'Command Initiated Successfully'});
                                            return
                                        } 
                                        else 
                                        {
                                            res.status(202).send({status:0, message: message});
                                            return
                                        }
                                    }
                                    else 
                                    {
                                        res.status(202).send({status:0, message:'No response from the stored procedure.'});
                                        return
                                    }
                                }
                                else
                                {
                                    res.status(202).send({status:0, message:"At least one finger must be selected"});
                                    return
                                } 
                            }
                        }
                        else
                        {
                            res.status(202).send({status:0, message:"MLS in Error State"});
                            return;
                        }
                    }
                    else
                    {
                        res.status(202).send({status:0, message:`MLS ${equipment_no} not in SemiAutomatic Mode`});
                        return;
                    }
                }
                else
                {
                    res.status(202).send({status:0, message:"Equipment number shouldn't be empty"});
                    return;
                }
            }
            else
            {
                res.status(202).send({status:0, message:'Aisle ID Should not be Empty'})
                return
            }
        }
        else 
        {
            res.status(202).send({status:0, message:"Equipment Type should be Lift/MLS"});
            return;
        }
    } 
    catch (error) 
    {
        res.status(202).send({status:0, message:"An error occurred: " + error.message});
    }
}

async function Totelift_CheckMode(equipmentNo) {
    try 
    {
        const result = await sequelize.query(`SELECT CurrentMode FROM KEP_TL_ToteliftStatusMonitor WITH (NOLOCK) WHERE ToteliftID = '${equipmentNo}'`)
        return result[0][0]['CurrentMode'];
    } 
    catch (error) 
    {
        return false
    }
}

async function LiftSemiAutoCommand(equipmentNo, mode, enableCarriage, parameter1, parameter2, parameter3, createdUser) {
    try {
        const result = await sequelize.query(
            `EXEC SP_UpdateEquipmentRequest_KEPWARE 
                @EquipmentType = :equipmentType, 
                @KEP_Lftid = :equipmentNo, 
                @KEP_sysid = :equipmentNo, 
                @Type = :type, 
                @mode = :mode, 
                @KEP_Parameter1 = :parameter1, 
                @KEP_Parameter2 = :parameter2, 
                @KEP_Parameter3 = :parameter3, 
                @KEP_EnbCarriage = :enableCarriage, 
                @CreatedUser = :createdUser`,
            {
                replacements: {
                    equipmentType: 'ToteLift',
                    equipmentNo,
                    type: 'Lift SemiControl',
                    mode,
                    parameter1,
                    parameter2,
                    parameter3,
                    enableCarriage,
                    createdUser,
                },
                type: sequelize.QueryTypes.SELECT,
            }
        );

        if(result[0][''] == 'Success')
        {
            return { status: 1, message: 'Success', data: result[0][''] };
        }
        else
        {
            return { status: 0, message: result[0][''] };
        }
    } 
    catch (error) 
    {
        return { status: 0, message: `Error in LiftSemiAutoCommand: ${error.message}` };
    }
}

async function MLS_CheckMode(ShuttleID, aisleID) {
    try 
    {
        const result = await sequelize.query(`SELECT top 1 CurrentMode FROM KEP_MLS_StatusMonitor WITH (NOLOCK) WHERE MLSID = '${ShuttleID}' and AisleNo= '${aisleID}'`)
        return result[0][0]['CurrentMode'];
    } 
    catch (error) 
    {
        return false
    }
}

async function MLS_errorcheck(ShuttleID, aisleID) {
    try 
    {
        const result = await sequelize.query(`SELECT top 1 Ready FROM KEP_MLS_StatusMonitor WITH (NOLOCK) WHERE MLSID = '${ShuttleID}' and AisleNo= '${aisleID}'`)
        return result[0][0]['Ready'];
    } 
    catch (error) 
    {
        return false
    }
}

const getWCSAlarmData = async (req, res) => {
    try {
        const { BinID, EquipmentType, EquipmentNo, AisleID } = req.body;
 
        // Determine the parameters based on EquipmentType
        const replacements = {
            // Type: "Load",
            // BinID: BinID ?? 'All',
            // EquipmentType: EquipmentType ?? 'All',
            // EquipmentNo: EquipmentNo ?? 1,
            Type: "Load",
            BinID: BinID ? BinID : '',
            EquipmentType: EquipmentType ? EquipmentType : 'All',
            EquipmentNo: parseInt(EquipmentNo) ? parseInt(EquipmentNo) : 1,
            AisleID: parseInt(AisleID) ? parseInt(AisleID) : 1
        };
        console.log('*********',replacements);
        // Execute the stored procedure
        const result = await sequelize.query('EXEC Kep_WCSAlarm @Type = :Type, @EquipmentType = :EquipmentType, @AisleID = :AisleID, @EquipmentNo = :EquipmentNo, @BinID = :BinID',
            {
                replacements,
                type: sequelize.QueryTypes.SELECT
            }
        );
        console.log('*********1',result);
        res.status(200).send({ status: 1, data: result });
    }
    catch (error) {
        res.status(202).send({ status: 0, message: error.message });
    }
}
 
const semiAutoCommand = async (req, res) => {
    try {
        const { EquipmentNo, AisleNo, EquipmentType, BinID, AliasBinID, Status, WCSStatus, CommandType, MessageID, ProcessType, CommandID } = req.body;
 
        let replacements = {}
        // Determine the parameters based on EquipmentType
        replacements = {
            EquipmentNo: EquipmentNo,
            AisleID: AisleNo,
            EquipmentType: EquipmentType,
            BinID: BinID,
            AliasBinID: AliasBinID,
            Status: Status,
            WCSStatus: WCSStatus,
            CommanType: CommandType,
            MessageID: MessageID,
            ProcessType: ProcessType,
            CommandID: CommandID,
            Type: 'case2',
        };
 
        // Execute the stored procedure
        const result = await sequelize.query('EXEC Kep_WCSAlarm @EquipmentNo = :EquipmentNo, @AisleID = :AisleID, @EquipmentType = :EquipmentType, @BinID = :BinID, @AliasBinID = :AliasBinID, @Status = :Status, @WCSStatus = :WCSStatus, @CommanType = :CommanType, @MessageID = :MessageID, @CommandID = :CommandID, @Type = :Type',
            {
                replacements,
                type: sequelize.QueryTypes.SELECT
            }
        );
        res.status(200).send({ status: 1, data: result[0][''] });
    }
    catch (error) {
        res.status(202).send({ status: 0, message: error.message });
    }
}
  
const dataCancelProcess = async (req, res) => {
    try {
        const { EquipmentNo, AisleNo, EquipmentType, BinID, AliasBinID, Status, WCSStatus, CommandType, MessageID, Bin_Moved, ProcessType, CommandID } = req.body;
 
        let replacements = {}
        // Determine the parameters based on EquipmentType
        if ((Status == "EQE" || Status == "STOP") && EquipmentType == "MLS" && CommandType == "SemiAuto") {
            replacements = {
                EquipmentNo: EquipmentNo,
                AisleID: AisleNo,
                EquipmentType: EquipmentType,
                BinID: BinID,
                AliasBinID: AliasBinID,
                Status: Status,
                WCSStatus: WCSStatus,
                CommanType: CommandType,
                MessageID: MessageID,
                ProcessType: ProcessType,
                CommandID: CommandID,
                Type: 'case5',
            };
        }
        let typetosend;
        if(Bin_Moved == 2 || Bin_Moved == 3 || Bin_Moved == 4){
            typetosend = 'BinmovedSatus3'
        }
        else if(Bin_Moved == 1 || Bin_Moved == 0){
            typetosend = 'BinmovedSatus1'
        }
 
        if ((Status == "EQE" || Status == "STOP") && EquipmentType == "MLS" && CommandType == "Auto") {
            if (ProcessType == "STR") {
                replacements = {
                    EquipmentNo: EquipmentNo,
                    AisleID: AisleNo,
                    EquipmentType: EquipmentType,
                    BinID: BinID,
                    AliasBinID: AliasBinID,
                    Status: Status,
                    WCSStatus: WCSStatus,
                    CommanType: CommandType,
                    MessageID: MessageID,
                    ProcessType: ProcessType,
                    CommandID: CommandID,
                    Type: typetosend,
                };
            }
            else if (ProcessType == 'PIC' || ProcessType == 'STK') {
                replacements = {
                    EquipmentNo: EquipmentNo,
                    AisleID: AisleNo,
                    EquipmentType: EquipmentType,
                    BinID: BinID,
                    AliasBinID: AliasBinID,
                    Status: Status,
                    WCSStatus: WCSStatus,
                    CommanType: CommandType,
                    MessageID: MessageID,
                    ProcessType: ProcessType,
                    CommandID: CommandID,
                    Type: typetosend,
                };
            }
        }
        // Execute the stored procedure
        const result = await sequelize.query('EXEC Kep_WCSAlarm @EquipmentNo = :EquipmentNo, @AisleID = :AisleID, @EquipmentType = :EquipmentType, @BinID = :BinID, @AliasBinID = :AliasBinID, @Status = :Status, @WCSStatus = :WCSStatus, @CommanType = :CommanType, @MessageID = :MessageID, @CommandID = :CommandID, @Type = :Type',
            {
                replacements,
                type: sequelize.QueryTypes.SELECT
            }
        );
        res.status(200).send({ status: 1, data: result[0][''] });
    }
    catch (error) {
        res.status(202).send({ status: 0, message: error.message });
    }
}
const dataCancelProcessForBin_Moved5 = async (req, res) => {
    try 
    {
        const { EquipmentNo, AisleNo, EquipmentType, BinID, AliasBinID, Status, WCSStatus, CommandType, MessageID, CommandID, ProcessType } = req.body;
 
        let replacements = {}
        // Determine the parameters based on EquipmentType
 
        if ((Status == "EQE" || Status == "STOP") && EquipmentType == "MLS" && CommandType == "Auto") {
            if (ProcessType == "STR" || ProcessType == 'PIC') {
                replacements = {
                    EquipmentNo: EquipmentNo,
                    AisleID: AisleNo,
                    EquipmentType: EquipmentType,
                    BinID: BinID,
                    AliasBinID: AliasBinID,
                    Status: Status,
                    WCSStatus: WCSStatus,
                    CommanType: CommandType,
                    MessageID: MessageID,
                    CommandID: CommandID,
                    Type: 'BinmovedSatus5',
                };
            }
        }
        // Execute the stored procedure
        const result = await sequelize.query('EXEC Kep_WCSAlarm @EquipmentNo = :EquipmentNo, @AisleID = :AisleID, @EquipmentType = :EquipmentType, @BinID = :BinID, @AliasBinID = :AliasBinID, @Status = :Status, @WCSStatus = :WCSStatus, @CommanType = :CommanType, @MessageID = :MessageID, @CommandID = :CommandID, @Type = :Type',
            {
                replacements,
                type: sequelize.QueryTypes.SELECT
            }
        );

        res.status(200).send({ status: 1, data: result[0][''] });
    }
    catch (error) {
        res.status(202).send({ status: 0, message: error.message });
    }
}
 
const BinPresent = async (req, res) => {
    try {
        const { EquipmentNo, AisleNo } = req.body;
        const binPresentData = await sequelize.query(`select BinPresent1,BinPresent2,Bin_Moved from KEP_MLS_EquipmentStatus WITH (NOLOCK) where ShuttleID='${EquipmentNo}' and AisleID='${AisleNo}'`)
        if(binPresentData[0].length == 0){
            res.status(200).send({ status: 0, message: "Bin Moved Status not provided" });
            return
        }
        res.status(200).send({ status: 1, data: binPresentData[0] });
    }
    catch (error) {
        res.status(202).send({ status: 0, message: error.message });
    }
}
 
const dataCancelFreeLocation = async (req, res) => {
    try {
        const { EquipmentNo, AisleNo, BinID } = req.body;
        const parts = BinID.split('-');
        const BinType = parts[1];
        const Category = await sequelize.query(`select TOP(1) Category from Inv_PalletDetails WITH (NOLOCK) where BinID = '${BinID}'`)
 
        const params = {
            Type: 'FetchFreeLocations',
            Category: Category[0][0]['Category'],
            BinType: BinType,
            ShuttleID: EquipmentNo,
            Aisle: AisleNo
        };

        const query = `EXEC SP_Freelocation
                                       @Type = :Type,
                                       @Category = :Category,
                                       @ShuttleID = :ShuttleID,
                                       @Aisle = :Aisle,
                                       @BinType = :BinType`;
 
        // Execute the query
        result = await sequelize.query(query, {
            replacements: params,
            type: sequelize.QueryTypes.SELECT,
        });
 
 
        // let levelCondition = "";
        // if (BinType === "B") {
        //     levelCondition = "AND Level >= 5";
        // } else if (BinType === "C") {
        //     levelCondition = "AND Level >= 6";
        // } else if (BinType === "D") {
        //     levelCondition = "AND Level >= 7";
        // }
 
        // // Fetch free locations based on conditions
        // const freeLocation = await sequelize.query(`
        //     SELECT [EquipmentNo], [Side], [Level], [Bay], [Deep], [AisleNo], [AliasBinID]
        //     FROM LocationSpecification
        //     WHERE AisleNo = '${AisleNo}'
        //     AND EquipmentNo = '${EquipmentNo}'
        //     AND Category = '${Category[0][0]['Category']}'
        //     AND PickDelPoint = 0
        //     AND Blocked = 0
        //     AND Error = 0
        //     AND BinID IS NULL
        //     ${levelCondition}
        // `);
 
        const Cancel_BinRequest = await sequelize.query(`select TOP(1) Status from KEP_Cancel_BinRequest WITH (NOLOCK) where BinID='${BinID}' AND Status IN ('G') order by UpdatedDateTime desc`)
 
        const palletRequestStatus = await sequelize.query(`select TOP(1) Status from PalletRequestDetails WITH (NOLOCK) where BinID='${BinID}' AND Status IN ('E') ORDER BY ReqTime DESC`)

        const locationData = await sequelize.query(`select TOP(1) Side, Bay, Level, Deep from PalletRequestDetails WITH (NOLOCK) where BinID='${BinID}' AND Status IN ('P','W') ORDER BY ReqTime DESC`)
 
        res.status(200).send({ status: 1, data: result, locationData: locationData[0], cancelValue: Cancel_BinRequest[0][0].Status ?? '', palletRequestStatus: palletRequestStatus[0][0].Status ?? '' });
    }
    catch (error) {
        res.status(202).send({ status: 0, message: error.message });
    }
}
 
const wcsAlarmReset = async (req, res) => {
    try {
 
        let startDate = moment().startOf('day').format('YYYY-MM-DD HH:mm:ss')
        let endDate = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss')
 
        const updateQuery = `
            UPDATE AlarmHistory_WCS
            SET Confirm = 1
            WHERE Confirm = 0 AND CreatedDT BETWEEN '${startDate}' AND '${endDate}'
        `;
        await sequelize.query(updateQuery);
 
 
        res.status(200).send({ status: 1, message: "WCS Alarm Resetted successfully" });
    } catch (error) {
        res.status(201).send({ status: 0, message: error.message });
    }
};
 
const wcsAlarmWrite = async (req, res) => {
    try {
        let data = req.body;
        const { Type, Mode, EquipmentType, KEP_Shtid, KEP_sysid, KEP_Parameter1, KEP_Parameter2, Side, Deep, Level, Bay, CreatedUser, CancelBinID, CancelProcessType } = req.body
        // Prepare parameters for the query
        const params = {
            Type: Type,
            Mode: Mode,
            EquipmentType: EquipmentType,
            KEP_Shtid: KEP_Shtid,
            KEP_sysid: KEP_sysid,
            KEP_Parameter1: KEP_Parameter1,
            KEP_Parameter2: KEP_Parameter2,
            Side: Side,
            Deep: Deep,
            Level: Level,
            Bay: Bay,
            CreatedUser: CreatedUser,
            CancelBinID: CancelBinID,
            CancelProcessType: CancelProcessType
        };

        let result;
 
        // Query string
        if (KEP_Parameter1 == 'AWH') {
            const query = `EXEC SP_UpdateEquipmentRequest_KEPWARE
                                       @Type = :Type,
                                       @Mode = :Mode,
                                       @EquipmentType = :EquipmentType,
                                       @KEP_Shtid = :KEP_Shtid,
                                       @KEP_sysid = :KEP_sysid,
                                       @KEP_Parameter1 = :KEP_Parameter1,
                                       @Side = :Side,
                                       @Deep = :Deep,
                                       @Level = :Level,
                                       @Bay = :Bay,
                                       @CreatedUser = :CreatedUser,
                                       @CancelBinID = :CancelBinID,
                                       @CancelProcessType = :CancelProcessType`;
 
            // Execute the query
            result = await sequelize.query(query, {
                replacements: params,
                type: sequelize.QueryTypes.SELECT,
            });
        } else if (KEP_Parameter1 == 'STN') {
            const query = `EXEC SP_UpdateEquipmentRequest_KEPWARE
                                       @Type = :Type,
                                       @Mode = :Mode,
                                       @EquipmentType = :EquipmentType,
                                       @KEP_Shtid = :KEP_Shtid,
                                       @KEP_sysid = :KEP_sysid,
                                       @KEP_Parameter1 = :KEP_Parameter1,
                                       @KEP_Parameter2 = :KEP_Parameter2,
                                       @CreatedUser = :CreatedUser,
                                       @CancelBinID = :CancelBinID,
                                       @CancelProcessType = :CancelProcessType`;
 
            // Execute the query
            result = await sequelize.query(query, {
                replacements: params,
                type: sequelize.QueryTypes.SELECT,
            });
        }
        // Check and respond based on result
        const message = result[0][''] == 'Success' ? { status: 1, message: "Success" } : { status: 0, message: result[0][''] };
        res.status(message.status == 1 ? 200 : 202).json(message);
 
    }
    catch (error) {
        res.status(202).json({ status: 0, message: error.message });
    }
}

const getAutoPalletData = async (req, res) => {
    try
    {
        // Destructure the request body
        const { fromDate, toDate,  Type} = req.body;
        let autoPalletData;
        let startDate = moment(fromDate).startOf('day').format('YYYY-MM-DD HH:mm:ss')
        let endDate = moment(toDate).endOf('day').format('YYYY-MM-DD HH:mm:ss')
        // Execute the stored procedure
        const result = await sequelize.query(
            'EXEC SP_AutoPalletRead @Method = :Method, @FromDate = :FromDate, @ToDate = :ToDate, @Type = :Type', 
            {
                replacements: { 
                    Method: 'Load',
                    FromDate: startDate,
                    ToDate: endDate,
                    Type: Type
                },
                type: 'SELECT'  // Ensure the correct type is used
            }
        );
        autoPalletData = result;
        const header= await tableHeader('AutoPalletRead');
        res.status(200).send({status:1,header, data: autoPalletData});
    }
    catch (error)
    {
        res.status(202).send({status:0, message: error.message});
    }
}

    const getLoadStationBuffer = async (req, res) => {
        try {
        const { fromDate, toDate } = req.body;    
        // Determine the date range
        let startDate, endDate;
        if (fromDate && toDate) {
            startDate = moment(fromDate).startOf('day').format('YYYY-MM-DD HH:mm:ss');
            endDate = moment(toDate).endOf('day').format('YYYY-MM-DD HH:mm:ss');
        } 
        else if (fromDate) 
        {
            startDate = moment(fromDate).startOf('day').format('YYYY-MM-DD HH:mm:ss');
            endDate = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss'); // Today
        } 
        else if (toDate) 
        {
            startDate = moment().startOf('day').format('YYYY-MM-DD HH:mm:ss'); // Today
            endDate = moment(toDate).endOf('day').format('YYYY-MM-DD HH:mm:ss');
        } 
        else 
        {
            startDate = moment().startOf('day').format('YYYY-MM-DD HH:mm:ss'); // Today
            endDate = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss'); // Today
        }
    
        // Query the database with the date filter
        const result = await sequelize.query(
            `SELECT TOP (1000) [Id],
                    [BinID],
                    [AliasBinID],
                    [ToteLiftID],
                    [AisleID],
                    [MLSID],
                    [ItemCode],
                    [ItemName],
                    [ItemGroup],
                    [Category],
                    [Reachedbit],
                    [Status],
                    [floor],
                    [Station],
                    [CreatedTime],
                    [UpdateDateTime],
                    [Remarks]
            FROM [Craftsman_MLS].[dbo].[KEP_TL_LoadStationBuffer] WITH (NOLOCK)
            WHERE [CreatedTime] BETWEEN :startDate AND :endDate`,
            {
            replacements: { startDate, endDate },
            type: sequelize.QueryTypes.SELECT,
            }
        );
    
        // Map the result to the desired structure
        const data = result.map(record => ({
            id: record.Id,
            binID: record.BinID,
            aliasBinID: record.AliasBinID,
            toteLiftID: record.ToteLiftID,
            aisleID: record.AisleID,
            mlsID: record.MLSID,
            itemCode: record.ItemCode,
            itemName: record.ItemName,
            itemGroup: record.ItemGroup,
            category: record.Category,
            reachedBit: record.Reachedbit,
            status: record.Status,
            floor: record.floor,
            station: record.Station,
            createdTime: record.CreatedTime,
            updateDateTime: record.UpdateDateTime,
            remarks: record.Remarks,
        }));
    
        // Fetch the headers
        let header = await tableHeader('LoadStationBuffer');
    
        // Send the response
        res.status(200).send({ status: 1, data: data, header: header });
        } catch (error) {
        res.status(202).send({ status: 0, message: error.message });
        }
    };
 
    const getUnLoadStationBuffer = async (req, res) => {
        try {
        const { fromDate, toDate } = req.body;
    
        // Determine the date range
        let startDate, endDate;
        if (fromDate && toDate) {
            startDate = moment(fromDate).startOf('day').format('YYYY-MM-DD HH:mm:ss');
            endDate = moment(toDate).endOf('day').format('YYYY-MM-DD HH:mm:ss');
        } else if (fromDate) {
            startDate = moment(fromDate).startOf('day').format('YYYY-MM-DD HH:mm:ss');
            endDate = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss'); // Today
        } else if (toDate) {
            startDate = moment().startOf('day').format('YYYY-MM-DD HH:mm:ss'); // Today
            endDate = moment(toDate).endOf('day').format('YYYY-MM-DD HH:mm:ss');
        } else {
            startDate = moment().startOf('day').format('YYYY-MM-DD HH:mm:ss'); // Today
            endDate = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss'); // Today
        }
    
        // Query the database with the date filter
        const result = await sequelize.query(
            `SELECT TOP (1000) [Id],
                    [BinID],
                    [AliasBinID],
                    [ToteLiftID],
                    [AisleID],
                    [MLSID],
                    [ItemCode],
                    [ItemName],
                    [ItemGroup],
                    [Category],
                    [Reachedbit],
                    [Status],
                    [floor],
                    [Station],
                    [CreatedTime],
                    [UpdateDateTime],
                    [Remarks]
            FROM [Craftsman_MLS].[dbo].[KEP_TL_UnLoadStationBuffer] WITH (NOLOCK)
            WHERE [CreatedTime] BETWEEN :startDate AND :endDate`,
            {
            replacements: { startDate, endDate },
            type: sequelize.QueryTypes.SELECT,
            }
        );
    
        // Map the result to the desired structure
        const data = result.map(record => ({
            id: record.Id,
            binID: record.BinID,
            aliasBinID: record.AliasBinID,
            toteLiftID: record.ToteLiftID,
            aisleID: record.AisleID,
            mlsID: record.MLSID,
            itemCode: record.ItemCode,
            itemName: record.ItemName,
            itemGroup: record.ItemGroup,
            category: record.Category,
            reachedBit: record.Reachedbit,
            status: record.Status,
            floor: record.floor,
            station: record.Station,
            createdTime: record.CreatedTime,
            updateDateTime: record.UpdateDateTime,
            remarks: record.Remarks,
        }));
    
        // Fetch the headers
        let header = await tableHeader('UnLoadStationBuffer');
    
        // Send the response
        res.status(200).send({ status: 1, data: data, header: header });
        } catch (error) {
        res.status(202).send({ status: 0, message: error.message });
        }
    };
 
    const getLiftReachedBin = async (req, res) => {
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
    
        // Execute the query with filters
        const result = await sequelize.query(
            `SELECT TOP (1000) [Id],
                    [BinID],
                    [ToteLiftID],
                    [AisleID],
                    [MLSID],
                    [ItemCode],
                    [ItemName],
                    [ItemGroup],
                    [Category],
                    [Reachedbit],
                    [Status],
                    [floor],
                    [Station],
                    [AliasBinID],
                    [CreatedTime],
                    [UpdateDateTime],
                    [Remarks]
            FROM [Craftsman_MLS].[dbo].[KEP_TL_LiftReachedBin] WITH (NOLOCK)
            WHERE [CreatedTime] BETWEEN :startDate AND :endDate`,
            {
            replacements: { startDate, endDate },
            type: sequelize.QueryTypes.SELECT,
            }
        );
    
        // Transform data for frontend
        const data = result.map((record) => ({
            id: record.Id,
            binID: record.BinID,
            toteLiftID: record.ToteLiftID,
            aisleID: record.AisleID,
            mlsID: record.MLSID,
            itemCode: record.ItemCode,
            itemName: record.ItemName,
            itemGroup: record.ItemGroup,
            category: record.Category,
            reachedBit: record.Reachedbit,
            status: record.Status,
            floor: record.floor,
            station: record.Station,
            aliasBinID: record.AliasBinID,
            createdTime: record.CreatedTime,
            updateDateTime: record.UpdateDateTime,
            remarks: record.Remarks,
        }));
    
        // Define the header structure
        const header = await tableHeader('LiftReachedBin');
    
        // Respond with the data and header
        res.status(200).send({ status: 1, data, header });
        } catch (error) {
        res.status(500).send({ status: 0, message: error.message });
        }
    };
 
    const getLoadConveyorBuffer = async (req, res) => {
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
    
        // Execute the query with filters
        const result = await sequelize.query(
            `SELECT TOP (1000) [Id],
                    [BinID],
                    [ToteLiftID],
                    [AisleID],
                    [MLSID],
                    [ItemCode],
                    [ItemName],
                    [ItemGroup],
                    [Category],
                    [Reachedbit],
                    [Status],
                    [floor],
                    [Station],
                    [AliasBinID],
                    [CreatedTime],
                    [UpdateDateTime],
                    [Remarks]
            FROM [Craftsman_MLS].[dbo].[KEP_TL_LoadConveyorBuffer] WITH (NOLOCK)
            WHERE [CreatedTime] BETWEEN :startDate AND :endDate`,
            {
            replacements: { startDate, endDate },
            type: sequelize.QueryTypes.SELECT,
            }
        );
    
        // Transform data for frontend
        const data = result.map((record) => ({
            id: record.Id,
            binID: record.BinID,
            toteLiftID: record.ToteLiftID,
            aisleID: record.AisleID,
            mlsID: record.MLSID,
            itemCode: record.ItemCode,
            itemName: record.ItemName,
            itemGroup: record.ItemGroup,
            category: record.Category,
            reachedBit: record.Reachedbit,
            status: record.Status,
            floor: record.floor,
            station: record.Station,
            aliasBinID: record.AliasBinID,
            createdTime: record.CreatedTime,
            updateDateTime: record.UpdateDateTime,
            remarks: record.Remarks,
        }));
    
        // Define the header structure
        const header = await tableHeader('LoadConveyorBuffer');
    
        // Respond with the data and header
        res.status(200).send({ status: 1, data, header });
        } catch (error) {
        res.status(500).send({ status: 0, message: error.message });
        }
    };
 
    const getWCSMLSSend = async (req, res) => {
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
    
        // Execute the query with filters
        const result = await sequelize.query(
            `SELECT TOP (1000) [Id],
                    [AisleNo],
                    [ShuttleID],
                    [TransportCommandNo],
                    [MessageID],
                    [RequestType],
                    [ManualCommand],
                    [BinID],
                    [TransportType],
                    [SourceType],
                    [SourceSide],
                    [SourceBay],
                    [SourceLevel],
                    [SourceDeep],
                    [Reserved1],
                    [DestinationType],
                    [DestinationSide],
                    [DestinationBay],
                    [DestinationLevel],
                    [DestinationDeep],
                    [Reserved2],
                    [WCSCommandStatus],
                    [PLCCommandStatus],
                    [UpdatedDateTime],
                    [AliasBinID]
            FROM [Craftsman_MLS].[dbo].[KEP_WCS_MLSSend] WITH (NOLOCK)
            WHERE [UpdatedDateTime] BETWEEN :startDate AND :endDate`,
            {
            replacements: { startDate, endDate },
            type: sequelize.QueryTypes.SELECT,
            }
        );
    
        // Transform data for frontend
        const data = result.map((record) => ({
            id: record.Id,
            aisleNo: record.AisleNo,
            shuttleID: record.ShuttleID,
            transportCommandNo: record.TransportCommandNo,
            messageID: record.MessageID,
            requestType: record.RequestType,
            manualCommand: record.ManualCommand,
            binID: record.BinID,
            transportType: record.TransportType,
            sourceType: record.SourceType,
            sourceSide: record.SourceSide,
            sourceBay: record.SourceBay,
            sourceLevel: record.SourceLevel,
            sourceDeep: record.SourceDeep,
            reserved1: record.Reserved1,
            destinationType: record.DestinationType,
            destinationSide: record.DestinationSide,
            destinationBay: record.DestinationBay,
            destinationLevel: record.DestinationLevel,
            destinationDeep: record.DestinationDeep,
            reserved2: record.Reserved2,
            wcsCommandStatus: record.WCSCommandStatus,
            plcCommandStatus: record.PLCCommandStatus,
            updatedDateTime: record.UpdatedDateTime,
            aliasBinID: record.AliasBinID,
        }));
        
    
        // Define the header structure
        const header = await tableHeader('MLS Send');
    
        // Respond with the data and header
        res.status(200).send({ status: 1, data, header });
        } catch (error) {
        res.status(500).send({ status: 0, message: error.message });
        }
    };
 
    const getWCSTLSend = async (req, res) => {
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
    
        // Execute the query with filters
        const result = await sequelize.query(
            `SELECT TOP (1000) [Id],
                    [AisleNo],
                    [ToteliftID],
                    [TransportCommandNo],
                    [MessageID],
                    [RequestType],
                    [ManualCommand],
                    [BinID],
                    [AliasBinID],
                    [TransportType],
                    [FromPointType],
                    [FromSide],
                    [FromBay],
                    [FromLevel],
                    [FromDeep],
                    [Reserved1],
                    [ToPointType],
                    [ToSide],
                    [ToBay],
                    [ToLevel],
                    [ToDeep],
                    [Reserved2],
                    [CarriageNo],
                    [LocType],
                    [Level],
                    [Velocity],
                    [WCSCommandStatus],
                    [PLCCommandStatus],
                    [UpdatedDateTime]
            FROM [Craftsman_MLS].[dbo].[KEP_WCS_TLSend] WITH (NOLOCK)
            WHERE [UpdatedDateTime] BETWEEN :startDate AND :endDate`,
            {
            replacements: { startDate, endDate },
            type: sequelize.QueryTypes.SELECT,
            }
        );
    
        // Transform data for frontend
        const data = result.map((record) => ({
            id: record.Id,
            aisleNo: record.AisleNo,
            toteliftID: record.ToteliftID,
            transportCommandNo: record.TransportCommandNo,
            messageID: record.MessageID,
            requestType: record.RequestType,
            manualCommand: record.ManualCommand,
            binID: record.BinID,
            aliasBinID: record.AliasBinID,
            transportType: record.TransportType,
            fromPointType: record.FromPointType,
            fromSide: record.FromSide,
            fromBay: record.FromBay,
            fromLevel: record.FromLevel,
            fromDeep: record.FromDeep,
            reserved1: record.Reserved1,
            toPointType: record.ToPointType,
            toSide: record.ToSide,
            toBay: record.ToBay,
            toLevel: record.ToLevel,
            toDeep: record.ToDeep,
            reserved2: record.Reserved2,
            carriageNo: record.CarriageNo,
            locType: record.LocType,
            level: record.Level,
            velocity: record.Velocity,
            wcsCommandStatus: record.WCSCommandStatus,
            plcCommandStatus: record.PLCCommandStatus,
            updatedDateTime: record.UpdatedDateTime,
        }));
    
        // Define the header structure for the table
        const header = await tableHeader('ToteLift Send');
    
        // Respond with the data and header
        res.status(200).send({ status: 1, data, header });
        } catch (error) {
        res.status(500).send({ status: 0, message: error.message });
        }
    };

  const getGroundConveyor = async (req, res) => {
    try { 
        const { EquipmentNo, ConveyorName } = req.body;
        const whereClause = {};

        // If EquipmentNo and ConveyorName are both 'All', don't filter
        if (EquipmentNo !== 'All' && EquipmentNo != '') {
            whereClause.EquipmentNo = parseInt(EquipmentNo);
        }

        if (ConveyorName !== 'All' && ConveyorName !== '') {
            whereClause.ConveyorName = ConveyorName;
        }

        const data = await KEPGroundConveyorStatus.findAll({
            where: whereClause,
            tableHint: TableHints.NOLOCK
        });

        const header = await tableHeader('GroundConveyor');
        res.status(200).send({ status: 1, data, header });

    } catch (error) {
        res.status(202).send({ status: 0, message: error.message });
    }
};

const getMLSAutocmdData = async (req, res) => {
    try {
        const { fromDate, toDate, aisle } = req.body;
        const today = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss'); 
        let startDate = fromDate
            ? moment(fromDate).startOf('day').format('YYYY-MM-DD HH:mm:ss')
            : moment(today).startOf('day').format('YYYY-MM-DD HH:mm:ss');
    
        let endDate = toDate
            ? moment(toDate).endOf('day').format('YYYY-MM-DD HH:mm:ss')
            : today;

        let tableName = `KEP_MLS_AUTOCMD_STR_A${aisle}`; 
        // where ((UpdatedDateTime BETWEEN '${startDate}' AND '${endDate}') or (UpdatedDateTime IS NULL))
        const result = await sequelize.query(`select * from ${tableName} WITH (NOLOCK)`);
        const header = await tableHeader('MLS Auto Cmd');
        res.status(200).send({ status: 1, data: result[0], header });
    } catch (error) {
        res.status(202).send({ status: 0, message: error.message });
    }
};

const getMLSError = async (req, res) => {
    try {
        const { fromDate, toDate, aisle } = req.body;
        const today = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss'); 
        let startDate = fromDate
            ? moment(fromDate).startOf('day').format('YYYY-MM-DD HH:mm:ss')
            : moment(today).startOf('day').format('YYYY-MM-DD HH:mm:ss');
    
        let endDate = toDate
            ? moment(toDate).endOf('day').format('YYYY-MM-DD HH:mm:ss')
            : today;

        let tableName = `KEP_MLS_Error_A${aisle}`; 

        const result = await sequelize.query(`select * from ${tableName} WITH (NOLOCK) where ((UpdatedDateTime BETWEEN '${startDate}' AND '${endDate}') or (UpdatedDateTime IS NULL))`);
        const header = await tableHeader('MLS Error');
        res.status(200).send({ status: 1, data: result[0], header });
    } catch (error) {
        res.status(202).send({ status: 0, message: error.message });
    }
};

const getTLAutocmdData = async (req, res) => {
    try {
        const { fromDate, toDate, aisle } = req.body;
        const today = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss'); 
        let startDate = fromDate
            ? moment(fromDate).startOf('day').format('YYYY-MM-DD HH:mm:ss')
            : moment(today).startOf('day').format('YYYY-MM-DD HH:mm:ss');
    
        let endDate = toDate
            ? moment(toDate).endOf('day').format('YYYY-MM-DD HH:mm:ss')
            : today;

        let tableName = `KEP_TL_AUTOCMD_STR_A${aisle}`; 
        // where ((UpdatedDateTime BETWEEN '${startDate}' AND '${endDate}') or (UpdatedDateTime IS NULL))
        const result = await sequelize.query(`select * from ${tableName} WITH (NOLOCK)`);
        const header = await tableHeader('TL Auto Cmd');
        res.status(200).send({ status: 1, data: result[0], header });
    } catch (error) {
        res.status(202).send({ status: 0, message: error.message });
    }
};

const getTLError = async (req, res) => {
    try {
        const { fromDate, toDate, aisle } = req.body;
        const today = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss'); 
        let startDate = fromDate
            ? moment(fromDate).startOf('day').format('YYYY-MM-DD HH:mm:ss')
            : moment(today).startOf('day').format('YYYY-MM-DD HH:mm:ss');
    
        let endDate = toDate
            ? moment(toDate).endOf('day').format('YYYY-MM-DD HH:mm:ss')
            : today;

        let tableName = `KEP_TL_Error_A${aisle}`; 

        const result = await sequelize.query(`select * from ${tableName} WITH (NOLOCK) where ((UpdatedDateTime BETWEEN '${startDate}' AND '${endDate}') or (UpdatedDateTime IS NULL))`);
        const header = await tableHeader('TL Error');
        res.status(200).send({ status: 1, data: result[0], header });
    } catch (error) {
        res.status(202).send({ status: 0, message: error.message });
    }
};

const getMLSSemiAutoCmd = async (req, res) => {
    try {
        const { fromDate, toDate } = req.body;
        const today = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss'); 
        let startDate = fromDate
            ? moment(fromDate).startOf('day').format('YYYY-MM-DD HH:mm:ss')
            : moment(today).startOf('day').format('YYYY-MM-DD HH:mm:ss');
    
        let endDate = toDate
            ? moment(toDate).endOf('day').format('YYYY-MM-DD HH:mm:ss')
            : today;

        let tableName = `KEP_MLS_SEMIAUTO_CMD`; 
        // where ((UpdatedDateTime BETWEEN '${startDate}' AND '${endDate}') or (UpdatedDateTime IS NULL))
        const result = await sequelize.query(`select * from ${tableName} WITH (NOLOCK)`);
        const header = await tableHeader('MLS SemiAutoCmd');
        res.status(200).send({ status: 1, data: result[0], header });
    } catch (error) {
        res.status(202).send({ status: 0, message: error.message });
    }
};

const getTLSemiAutoCmd = async (req, res) => {
    try {
        const { fromDate, toDate } = req.body;
        const today = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss'); 
        let startDate = fromDate
            ? moment(fromDate).startOf('day').format('YYYY-MM-DD HH:mm:ss')
            : moment(today).startOf('day').format('YYYY-MM-DD HH:mm:ss');
    
        let endDate = toDate
            ? moment(toDate).endOf('day').format('YYYY-MM-DD HH:mm:ss')
            : today;

        let tableName = `KEP_TL_SemiAutoCmd`; 
        // where ((UpdatedDate BETWEEN '${startDate}' AND '${endDate}') or (UpdatedDate IS NULL))
        const result = await sequelize.query(`select * from ${tableName} WITH (NOLOCK)`);
        const header = await tableHeader('TL SemiAutoCmd');
        res.status(200).send({ status: 1, data: result[0], header });
    } catch (error) {
        res.status(202).send({ status: 0, message: error.message });
    }
};
 
const getWCSSendModbus = async (req, res) => {
    try {
        const { fromDate, toDate } = req.body;
        const today = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss'); 
        let startDate = fromDate
            ? moment(fromDate).startOf('day').format('YYYY-MM-DD HH:mm:ss')
            : moment(today).startOf('day').format('YYYY-MM-DD HH:mm:ss');
    
        let endDate = toDate
            ? moment(toDate).endOf('day').format('YYYY-MM-DD HH:mm:ss')
            : today;

        let tableName = `WCSSend_Modbus`; 

        const result = await sequelize.query(`select * from ${tableName} WITH (NOLOCK) where ((CreatedDTime BETWEEN '${startDate}' AND '${endDate}') or (CreatedDTime IS NULL))`);
        const header = await tableHeader('WCS SendModbus');
        res.status(200).send({ status: 1, data: result[0], header });
    } catch (error) {
        res.status(202).send({ status: 0, message: error.message });
    }
};


const getEquipmentRequest = async (req, res) => {
    try {
        const { fromDate, toDate } = req.body;
        const today = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss'); 
        let startDate = fromDate
            ? moment(fromDate).startOf('day').format('YYYY-MM-DD HH:mm:ss')
            : moment(today).startOf('day').format('YYYY-MM-DD HH:mm:ss');
    
        let endDate = toDate
            ? moment(toDate).endOf('day').format('YYYY-MM-DD HH:mm:ss')
            : today;

        let tableName = `EquipmentRequestDetails`; 

        const result = await sequelize.query(`select * from ${tableName} WITH (NOLOCK) where ((CreatedTime BETWEEN '${startDate}' AND '${endDate}') or (CreatedTime IS NULL))`);
        const header = await tableHeader('Equipment Request Details');
        res.status(200).send({ status: 1, data: result[0], header });
    } catch (error) {
        res.status(202).send({ status: 0, message: error.message });
    }
};

const getCraneMovement = async (req, res) => {
    try {
        const { fromDate, toDate, Type } = req.body; 
        const today = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss'); 
        let startDate = fromDate
            ? moment(fromDate).startOf('day').format('YYYY-MM-DD HH:mm:ss')
            : moment(today).startOf('day').format('YYYY-MM-DD HH:mm:ss');
    
        let endDate = toDate
            ? moment(toDate).endOf('day').format('YYYY-MM-DD HH:mm:ss')
            : today;

        let tableName = `Crane_Movement`; 

        const result = await sequelize.query(`select * from ${tableName} WITH (NOLOCK) where ((updateddate BETWEEN '${startDate}' AND '${endDate}') or (updateddate IS NULL)) order by Error desc`);
        const header = await tableHeader('MLS Movement'); 
        let exportFormat = Type;
        if(exportFormat == '')
        {
            return res.status(200).send({ status: 1, data: result[0], header });
        }
        else
        { 
            const { exportData } = require('../models/Export');
            await exportData(res, exportFormat, `User Report`, header ,result[0]);
        }
    } catch (error) {
        res.status(202).send({ status: 0, message: error.message });
    }
};

module.exports = {  
    craneStatus,
    locationStatus,
    equipmentStatus,
    getLocationDetails,
    getLocationManualBinList,
    getLocationManualEntry,
    updateEmergencyScreenData,
    updateEmergencyStationStart,
    locationMaintenance,
    updateLocationMaintenance,
    updateEmergencySemiautoCommand,
    getWCSAlarmData,
    dataCancelProcess,
    BinPresent,
    dataCancelFreeLocation,
    getAutoPalletData,
    getLoadStationBuffer,
    getUnLoadStationBuffer,
    getLiftReachedBin,
    getLoadConveyorBuffer,
    getWCSMLSSend,
    getWCSTLSend,
    wcsAlarmReset,
    getGroundConveyor,
    getMLSAutocmdData,
    getMLSError,
    getTLAutocmdData,
    getTLError,
    getMLSSemiAutoCmd,
    getTLSemiAutoCmd,
    getWCSSendModbus,
    getEquipmentRequest,
    getCraneMovement
};