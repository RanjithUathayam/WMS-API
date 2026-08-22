const storageData = require('../models/operation/storageDetails')
const PartMaster = require('../models/master/MasterPart');
const { Op, literal, QueryTypes, where, and } = require('sequelize');
const { sequelize } = require('../config/database');
const RetrievePallets = require('../models/operation/RetrievePallets')
const LocationSpecification = require('../models/operation/LocationSpecification')
const BinComplete = require('../models/HHT/binComplete')
const PreBinning = require('../models/ERP_API/PreBinning')
const palletRequest = require('../models/operation/storage')
const MasterBin = require('../models/master/MasterBin');
const MasterReason = require('../models/master/MasterReason');
const ERPRetrieval = require('../models/ERP_API/BinRetrieval')
const MasterPart = require('../models/master/MasterPart')
const ERPSchedule = require('../models/ERP_API/BinSchedule')
const MasterStation = require('../models/master/MasterStation');
const InvPalletDetails = require('../models/transaction/InvPalletDetail');
const ERPNightShuffle = require('../models/ERP_API/NightShuffle');
const RetrievalConfirmation = require('../models/operation/RetrievalConfirmation');
const CustomerAPILog = require('../models/Customer_api_logs')
const axios = require('axios');
const ERPAPIURL = 'http://10.0.210.8:91/'
const moment = require('moment');
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

//Storage Details
const storageUploadData = async (req, res) => {
    try
    {
        const dataArray = req.body;
        const result = [];

        for (const data of dataArray) 
        {
            let isValid = true;
            const errors = [];
            // Check mandatory fields
            if (!data.PalletId || !data.PartName || !data.InQuantity || !data.PackSize || !data.PalletRejectionFlag) 
            {
                isValid = false;
                errors.push('One or more mandatory fields are missing.');
            }

            // Add more validation checks as needed
            if (isValid) 
            {
                try 
                {
                    const palletList = await storageData.findAll({
                        where: {PalletId:data.PalletId},
                        tableHint: TableHints.NOLOCK
                    })
                    
                    if(palletList)
                    {
                        await storageData.destroy({
                            where: {PalletId:data.PalletId}
                        });
                    }

                    // Insert into MSSQL table
                    data.UpdatedDate = sequelize.literal('GETDATE()');
                    const insertedRow = await storageData.create(data);
                    result.push({ status: 1, data: insertedRow});
                } 
                catch (error) 
                {
                    result.push({ status: 0, message: error.message });
                }
            } 
            else 
            {
                result.push({ status: 0, message:errors, data: data});
            }
        }
        res.status(200).json({ message: 'Users inserted successfully', data: result });
    }
    catch (error)
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

const getStorageDetailsData = async (req, res) => {
    try
    {
        const {Type} = req.body;
        const palletList = await storageData.findAll({where:{InQuantity:{ [Op.gt]: 0 }}, tableHint: TableHints.NOLOCK})
        const header = await tableHeader('StorageDetails'); 
        let exportFormat = Type;
        if(exportFormat == '')
        {
            if (!palletList) 
            {
                return res.status(202).json({status: 0, message: 'Page Data not found' });
            }
            else
            {
                return res.status(200).json({status: 1, message: 'get StorageDetails Data successfully', header, data: palletList });
            }
        }
        else
        { 
            const { exportData } = require('../models/Export');
            await exportData(res, exportFormat, `User Report`, header ,palletList);
        }
    }
    catch (error)
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

//PalletRequestCreation
const palletRequestPageData = async (req, res) => {
    try 
    {
        const result = await PartMaster.findAll({tableHint: TableHints.NOLOCK})
        if (!result) 
        {
            return res.status(200).json({status: 1, message: 'Page Data not found' });
        }

        res.status(200).json({status: 1, message: 'Master Data Get successfully', data: result });
    } 
    catch (error) 
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

// Create a new part
const addPalletNewItem = async (req, res) => {
    try 
    {
        const data = req.body;
        data.UpdatedDate = sequelize.literal('GETDATE()');
        data.PalletRejectionFlag = false
        const insertedRow = await storageData.create(data);

        if (insertedRow) 
        {
            res.status(200).json({status: 1, message: 'PartMaster created successfully', data: insertedRow });
        } 
        else 
        {
            res.status(202).json({status: 0, message: 'Failed to create PartMaster' });
        }
    } 
    catch (error) 
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

const palletRequestList = async (req, res) => {
    try 
    {
        const data = req.body;

        // const options = {
        //     validate: true, // Validate the data before inserting
        //     fields: [CraneID,PartNo,PartName,GroupCode,GroupName,Type,ReqQty,user], // Specify the fields to insert (optional)
        //     returning: true // Get the inserted records back (optional)
        // };
        // Bulk insert the JSON data
        const retrievalcreation = await RetrievePallets.bulkCreate(data.Retrievepallets)
        .then(() => 
        {
            console.log('Bulk insert successful');
        })
        .catch((error) => {
            console.error('Error inserting data:', error);
        });
        
        // const convertedArrayData = data.Retrievepallets.map(item => [item.PartNo,item.PartName,item.TotalPallet,item.QtyPallet,item.TotalQty,item.ReqQty,item.GroupCode,item.GroupName,item.Type,item.Priority,item.PickType]);

        // if (data.requestType == "Itemwise")
        // {
        //     queryString = `EXEC SP_RetrievePallet @mode = :mode, @CraneID= :CraneID, @type= :type, @user= :user, @Priority= :Priority, @UDT_RetrievePallets=:UDT_RetrievePallets, @Station=:Station`
        //     type = 'nonempty'
        //     mode = 'Unload'
        // }
        // else if (data.requestType == "Batchwise")
        // {
        //     queryString = `EXEC SP_RetrievePallet @mode = :mode, @CraneID= :CraneID, @type= :type, @user= :user, @Priority= :Priority, @UDT_RetrievePallets=:UDT_RetrievePallets, @Station=:Station`
        //     type = 'nonempty'
        //     mode = 'Unload'
        // }
        // else if (data.requestType == "Palletwise")
        // {
        //     queryString = `EXEC SP_RetrievePallet @mode = :mode, @CraneID= :CraneID, @type= :type, @user= :user, @Priority= :Priority, @UDT_RP=:UDT_RetrievePallets, @Station=:Station`
        //     type = 'Palletwise'
        //     mode = 'Unload'
        // }
        // else if (data.requestType == "Kittingwise")
        // {
        //     queryString = `EXEC SP_RetrievePallet @mode = :mode, @CraneID= :CraneID, @type= :type, @user= :user, @Priority= :Priority, @UDT_RetrievePallets=:UDT_RetrievePallets, @Station=:Station`
        //     type = 'nonempty'
        //     mode = 'Unload'
        // }
        // else if (data.requestType == "BOMwise")
        // {
        //     queryString = `EXEC SP_RetrievePallet @mode = :mode, @CraneID= :CraneID, @type= :type, @user= :user, @Priority= :Priority, @UDT_RetrievePallets=:UDT_RetrievePallets, @Station=:Station`
        //     type = 'nonempty'
        //     mode = 'Unload'
        // }
       
        // else if (data.requestType == "Orderwise")
        // {
        //     queryString = `EXEC SP_RetrievePallet @mode = :mode, @CraneID= :CraneID, @type= :type, @user= :user, @PickType='OR', @UDT_RetrievePallets=:UDT_RetrievePallets, @Station=:Station, @CommonServer=${data.ERPServerName}, @CommonDB=${data.ERPDBName}`
        //     type = 'nonempty'
        //     mode = 'Unload'
        // }
        

        // const result = await sequelize.query(queryString, {
        //     replacements: { 
        //         mode: mode,
        //         CraneID: data.craneID,
        //         type: type,
        //         user: data.user,
        //         Priority: data.Priority,
        //         UDT_RetrievePallets: convertedArrayData,
        //         Station: data.station
        //     }
        // })

        
        // if(result)
        // {
        //     res.status(200).json({status: 1, message: 'Unloading Process Initiated... ', data: result });
        // }
        // else
        // {
        //     res.status(202).json({status: 0, message: 'Unloading Process Failed...' });
        // }
  
    } 
    catch (error) 
    {
        res.status(202).json({status: 0, message: error.message});
    }
}
  
const retrievalPageData = async (req, res) => {
    try 
    {
        const data = req.body;
        const result = await sequelize.query('EXEC SP_RetrievePallet @mode = :mode, @CraneID= :CraneID, @PartNumber= :PartNumber, @Part_Name=:Part_Name', {
            replacements: { 
                mode: 'loadEntry',
                CraneID: data.CraneID,
                PartNumber: '',
                Part_Name: ''
            },
            Type: 'Show'
        });

        if(result)
        {
            res.status(200).json({status: 1, message: 'Page Load Data Get successfully... ', data: result });
        }
        else
        {
            res.status(202).json({status: 0, message: 'Page Load Data Failed...' });
        }
  
    } 
    catch (error) 
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

const relocationFromSideData = async (req, res) => {
    try {
        const data = req.body;
        let options = {
            Error: { [Op.eq]: 0 },
            Blocked: { [Op.eq]: 0 },
            PickDelPoint: { [Op.eq]: 0 }
        };

        if (data.AisleNo) {
            options.AisleNo = data.AisleNo;
        }

        if (data.ShuttleID) {
            options.EquipmentNo = data.ShuttleID;
        }

        if (data.Side) {
            options.Side = data.Side;   
        }
        
        if (data.Level) {
            options.Level = data.Level;
        }

        if (data.Bay) {
            options.Bay = data.Bay;
        }

        if (data.BinID) {
            options.BinID = {
                [Op.not]: null,
                [Op.ne]: '',
                [Op.like]: `%${data.BinID}%`,
            };
        }    
        else
        {
            options.BinID = {
                [Op.not]: null,
                [Op.ne]: ''
            };
        }
        
        // Fetch the pallet list with the optimized options
        const palletList = await LocationSpecification.findAll({
            attributes: ['EquipmentNo', 'AisleNo', 'Side', 'Bay', 'Level', 'Deep', 'SideName', 'BinID', 'LocationID','LocationCategory'],
            where: options,
            order: [
                ['Side', 'ASC'],
                ['Level', 'ASC'],
                ['Bay', 'ASC'],
                ['Deep', 'ASC']
            ],
            tableHint: TableHints.NOLOCK,
            logging: console.log // Log the generated SQL query
        });

        // Fetch distinct Shuttle IDs with the same where conditions
        const distinctShuttleID = await LocationSpecification.findAll({
            attributes: [[sequelize.fn('DISTINCT', sequelize.col('EquipmentNo')), 'EquipmentNo']],
            where: options,
            order: [['EquipmentNo', 'ASC']],
            tableHint: TableHints.NOLOCK
        });

        if (palletList && palletList.length > 0) 
        {
            res.status(200).json({ status: 1, message: 'Pallet relocation Data retrieved successfully.', data: palletList, ShuttleID: distinctShuttleID });
        }
        else
        {
            res.status(202).json({ status: 0, message: 'No pallet data found.' });
        }
    } catch (error) {
        res.status(202).json({ status: 0, message: error.message });
    }
};

const relocationToSideData = async (req, res) => {
    try 
    {
        const data = req.body;
        let options = {
            AisleNo: data.AisleNo,
            EquipmentNo: data.ShuttleID,
            Error: { [Op.eq]: 0 },
            Blocked: { [Op.eq]: 0 },
            PickDelPoint: { [Op.eq]: 0 },
            SpecialLoc: { [Op.eq]: 0 },
            LocationCategory: data.LocationCategory
        };

        if (data.Side) {
            options.Side = data.Side;   
        }
        
        if (data.Level) {
            options.Level = data.Level;
        }

        if (data.Bay) {
            options.Bay = data.Bay;
        }

        if (data.BinID) {
            options.BinID = {
                [Op.is]: null,
                [Op.eq]: '',
                [Op.like]: `%${data.BinID}%`,
            };
        }    
        else
        {
            options.BinID = {
                [Op.or]: [
                    { [Op.is]: null },  // BinID is null
                    { [Op.eq]: '' }     // BinID is an empty string
                ]
            };
        }

        const palletList = await LocationSpecification.findAll({
            attributes: ['EquipmentNo','AisleNo','Side', 'Bay', 'Level', 'Deep', 'SideName', 'BinID', 'LocationID','LocationCategory'],
            where: options,
            order: [
                ['LocationID', 'ASC']
            ],
            tableHint: TableHints.NOLOCK,
            logging: console.log // Log the generated SQL query
        })
       
        if(palletList)
        {
            res.status(200).json({status: 1, message: 'Pallet relocation ToSide Data Get successfully... ', data: palletList });
        }
        else
        {
            res.status(202).json({status: 0, message: 'Page Load Data Failed...' });
        }  
    } 
    catch (error) 
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

const palletRelocate = async (req, res) => {
    const transaction = await sequelize.transaction();
    
    try {
        const reqList = req.body;
        const fromData = reqList.FromSide;
        const toData = reqList.ToSide.sort((a, b) => b.Deep - a.Deep);

        const relocateData = fromData.map((item, index) => ({
            ...item,
            ToLocation: toData[index]?.LocationID,
            User: req.user.UserName
        }));
        let retrivalPending = await palletRequest.findAll({where:{Status :{ [Op.in]: ["G", "P"]}, ReqType: 'PIC', ShuttleID: relocateData[0].EquipmentNo, AisleNo: relocateData[0].AisleNo}, tableHint: TableHints.NOLOCK});
        if(retrivalPending.length == 0)
        {
            for (const data of relocateData) 
            {
                const [palletDetails] = await LocationSpecification.findAll({ where: { BinID: data.BinID }, tableHint: TableHints.NOLOCK });
                const [palletMaster] = await MasterBin.findAll({ where: { BinID: data.BinID }, tableHint: TableHints.NOLOCK });
    
                const {
                    EquipmentNo:ShuttleID,
                    AisleNo: AisleID,
                    ToLocation: ToPoint,
                    BinID,
                    User: CreatedUser,
                    LocationID: FromLocation
                } = data || {};

                const MaterialCode = palletDetails?.ItemCode || '';
                const PartName = palletDetails?.ItemName || '';
                const Quantity = 0; // If needed, modify accordingly
                const Description = palletMaster?.Description || '';
                
                // Insert into PalletRequestDetails
                await sequelize.query(`
                    INSERT INTO PalletRequestDetails 
                    (ShuttleID, AisleNo, BinID, [Description], [ReqUser], [ReqType], [ReqTime], 
                    ItemCode, ItemName, [Status], [CompletedTime], [Reason], Quantity) 
                    VALUES (?, ?, ?, ?, ?, 'RLC', GETDATE(), ?, ?, 'M', NULL, NULL, ?)
                `, {
                    replacements: [
                        ShuttleID, AisleID, BinID, Description,
                        CreatedUser, MaterialCode, PartName, Quantity
                    ],
                    transaction
                });
    
                // Insert into BayRelocation
                await sequelize.query(`
                    INSERT INTO BayRelocation 
                    (AisleID, [EquipmentNo], [BinID], [From_loc], [To_Loc], [Status]) 
                    VALUES (?, ?, ?, ?, ?, 'M')
                `, {
                    replacements: [AisleID, ShuttleID, BinID, FromLocation, ToPoint],
                    transaction
                });
            }
    
            await transaction.commit();
            res.status(200).json({ status: 1, message: 'Bin relocation request created successfully.' });
        }
        else
        {
            await transaction.rollback();
            res.status(202).json({ status: 0, message: 'Failed to create Bin relocation Request. Currently Retrieval Process Pending' });
        }
    } catch (error) {
        await transaction.rollback();
        res.status(500).json({ status: 0, message: error.message });
    }
};

const PreBinningApprove = async (req, res) => {
    try {
        const { GRNNo, ItemCode, BinID } = req.query;

        // Build dynamic where condition
        const whereCondition = {
            BinningStatus: 'Pending',
            ...(GRNNo?.trim() && { GRNNo: { [Op.like]: `%${GRNNo.trim()}%` } }),
            ...(ItemCode?.trim() && { ItemCode: { [Op.like]: `%${ItemCode.trim()}%` } }),
            ...(BinID?.trim() && { BinID: { [Op.like]: `%${BinID.trim()}%` } })
        };

        // Fetch pending binning details
        const binningDetails = await BinComplete.findAll({
            where: whereCondition,
            tableHint: TableHints.NOLOCK
        });

        if (!binningDetails.length) {
            return res.status(200).json({
                status: 1,
                message: 'No records found.',
                data: [],
                remarks: []
            });
        }

        // Extract unique GRNNo-ItemCode combinations
        const uniqueKeys = new Set();
        const grnItemPairs = [];

        binningDetails.forEach(({ GRNNo, ItemCode }) => {
            const key = `${GRNNo}_${ItemCode}`;
            if (!uniqueKeys.has(key)) {
                uniqueKeys.add(key);
                grnItemPairs.push({ GRNNo, ItemCode });
            }
        });

        // Fetch all matching PreBinning records in bulk
        const preBinningRecords = await PreBinning.findAll({
            where: {
                [Op.or]: grnItemPairs,
            },
            limit: 50,
            tableHint: TableHints.NOLOCK
        });

        // Map PreBinning records for quick access
        const preBinningMap = {};
        preBinningRecords.forEach(item => {
            preBinningMap[`${item.GRNNo}_${item.ItemCode}`] = item;
        });

        // Aggregate binning details
        const dataMap = new Map();

        binningDetails.forEach(item => {
            const {
                GRNNo, GRNType, ItemCode, ItemName,
                ItemGroup, ItemStatus, BinID, Quantity
            } = item.dataValues;

            const key = `${GRNNo}_${ItemCode}`;
            const grn = preBinningMap[key];

            if (!grn) return;

            if (!dataMap.has(key)) {
                dataMap.set(key, {
                    GRNNo,
                    GRNType,
                    ItemCode,
                    ItemName,
                    ItemGroup,
                    ItemStatus,
                    BinID: [BinID],
                    reqQty: parseFloat(grn.Quantity),
                    binnedQty: parseFloat(Quantity),
                    remark: grn.GRNRemarks
                });
            } else {
                const existing = dataMap.get(key);
                existing.BinID.push(BinID);
                existing.binnedQty += parseFloat(Quantity);
            }
        });

        // Fetch all master reasons
        const remarks = await MasterReason.findAll({
            attributes: ['ReasonID', 'ReasonDescription'],
            tableHint: TableHints.NOLOCK
        });

        return res.status(200).json({
            status: 1,
            message: 'Get Approve Bin Details successfully.',
            data: Array.from(dataMap.values()),
            remarks
        });

    } catch (error) {
        return res.status(500).json({ status: 0, message: error.message });
    }
};
      
const PreBinApproveStatus = async (req, res) => {
    const t = await sequelize.transaction(); // Start a new transaction
    try 
    {
        let approveData = req.body.data;
        if (approveData.length === 0) {
            return res.status(202).json({ status: 0, message: 'No data to update.' });
        }

        const updatePromises = approveData.map(async (data) => {
            const BinningDetails = await BinComplete.findAll({
                where: {
                    GRNNo: data.GRNNo,
                    ItemCode: data.ItemCode,
                    ItemStatus: 'Completed',
                    BinningStatus: 'Pending'
                },
                tableHint: TableHints.NOLOCK
            });

            if (!BinningDetails.length) return { updated: false };

            const detailPromises = BinningDetails.map(async (BinData) => {
                const UpdateRow = await BinComplete.update(
                    { BinningStatus: data.status },
                    {
                        where: {
                            BinID: BinData.dataValues.BinID,
                            ItemCode: BinData.dataValues.ItemCode
                        },
                        returning: true,
                        transaction: t
                    }
                );

                const updateItem = await PreBinning.update({GRNStatus:data.status, UpdatedDate:sequelize.literal('GETDATE()'), UpdatedBy: req.user.UserName}, {
                    where: { GRNNo: data.GRNNo, ItemCode: data.ItemCode}, 
                    returning: true,
                    transaction: t
                })

                if (data.status === 'Approve' || data.status === 'ShortClose' || data.status === 'PartialApprove') {
                    let Inv_BinApprove = await sequelize.query(`SELECT COUNT(Binid) AS CNT FROM Inv_BinApprove WITH (NOLOCK) WHERE Binid ='${BinData.dataValues.BinID}'`);
                    let binStatus = await sequelize.query(`select COUNT(1) AS CNT from T_BIN_COMPLETE WITH (NOLOCK) where BinID='${BinData.dataValues.BinID}' and BinningStatus = 'Pending'`);
                    let flagValue = 0
                    if(binStatus[0][0].CNT == 0)
                    {
                        flagValue = 1
                    }

                    if (Inv_BinApprove[0][0].CNT == 0) 
                    {
                        await sequelize.query(`INSERT INTO Inv_BinApprove (Binid,Flag,Createdtime) 
                            VALUES (
                                '${BinData.dataValues.BinID}',
                                ${flagValue}, 
                                GETDATE()
                            )
                        `)
                    }
                    else
                    {
                        await sequelize.query(`Update Inv_BinApprove set Flag = ${flagValue}, Updatedtime = GETDATE() where Binid='${BinData.dataValues.BinID}'`)
                    }

                    let InvDetails = await sequelize.query(`SELECT COUNT(BinID) AS CNT FROM Inv_PalletDetails WITH (NOLOCK) WHERE BinID ='${BinData.dataValues.BinID}' AND ItemCode = '${BinData.dataValues.ItemCode}'`);
                    if (InvDetails[0][0].CNT == 0) 
                    {
                        const itemDetails = await MasterPart.findOne({ where: { ItemCode: BinData.dataValues.ItemCode }, tableHint: TableHints.NOLOCK });
                        let invList = {
                            BinID: BinData.dataValues.BinID,
                            ItemCode: BinData.dataValues.ItemCode,
                            ItemName: BinData.dataValues.ItemName,
                            ItemGroup: BinData.dataValues.ItemGroup,
                            Category: itemDetails.dataValues.Category,
                            Description: itemDetails.dataValues.Description,
                            Color: itemDetails.dataValues.Color,
                            Size: isNaN(itemDetails.dataValues.Size) ? null : parseFloat(itemDetails.dataValues.Size),
                            Style: itemDetails.dataValues.Style,
                            BinCapacity: parseFloat(itemDetails.dataValues.BinCapacity),
                            Field1: itemDetails.dataValues.Field1,
                            Field2: itemDetails.dataValues.Field2,
                            Field3: itemDetails.dataValues.Field3,
                            InQuantity: parseInt(BinData.dataValues.Quantity),
                            Quantity: 0,
                            OutQuantity: 0,
                            PickType: '',
                            UserName: req.user.UserName,
                            UpdatedDate: sequelize.literal('GETDATE()'),
                            AisleNo: 0,
                            GRNNo: data.GRNNo
                        };

                        const insertedRow = await storageData.create(invList, { transaction: t });
                        if (UpdateRow && insertedRow) {
                            return { updated: true };
                        }
                    }
                } 
                else 
                {
                    if (UpdateRow) {
                        return { updated: true };
                    }
                }
                return { updated: false };
            });

            return Promise.all(detailPromises);
        });

        const results = await Promise.all(updatePromises);
        const hasFailures = results.flat().some(({ updated }) => !updated);
        if (hasFailures) {
            await t.rollback();
            return res.status(202).json({ status: 0, message: 'Failed to update Pre Binning Status' });
        }

        // Fetch Bearer Token and make API call
        let bearerToken = '';
        const tokenData = await fetchBearerToken();
        if (tokenData.status != 1) 
        {
            await t.rollback();
            return res.status(202).json({ status: 0, message: tokenData.message });
        }

        bearerToken = tokenData.TokenNo;

        const headers = { 'Authorization': `Bearer ${bearerToken}`, 'Content-Type': 'application/json' };
        const confirmData = approveData.map(async (item) => {
            const GRNDetails = await PreBinning.findOne({
                where: {
                    GRNNo: item.GRNNo,
                    ItemCode: item.ItemCode
                },
                tableHint: TableHints.NOLOCK
            });

            if (GRNDetails) {
                await PreBinning.update(
                    { GRNRemarks: item.remark },
                    { where: { GRNNo: item.GRNNo, ItemCode: item.ItemCode }, transaction: t }
                );

                return {
                    type: GRNDetails.Type,
                    grnno: GRNDetails.GRNNo,
                    itemcode: GRNDetails.ItemCode,
                    grnQuantity: GRNDetails.Quantity,
                    scannedItemQuantity: GRNDetails.Binning_Qty,
                    status: item.status,
                    remarks: item.remark,
                    tokenNo: bearerToken,
                    processType: 'PreBinningConfirm'
                };
            }
            return null;
        });

        const finalConfirmData = (await Promise.all(confirmData)).filter(Boolean);

        //Make API request asynchronously after committing the transaction
        const apiUrl = ERPAPIURL + 'PreBinningConfirm/PreBinningConfirm';
        const payload = { type: 'CraftsmanRequest', data: finalConfirmData };

        const startTime = new Date();
        let userID = req.user ? req.user['UserName'] || '0' : req.body.id || '0';
        const requestInfo = {
            URL: apiUrl,
            RequestedDateTime: sequelize.literal(`'${moment(startTime).format('YYYY-MM-DD HH:mm:ss.SSS')}'`),
            RequestBody: payload,
            UserName: userID,
        };

        const response = await axios.post(apiUrl, payload, { headers });

        const duration = new Date() - startTime; 
        await CustomerAPILog.create({
            ...requestInfo,
            StatusCode: res.statusCode,
            ResponseDateTime: sequelize.literal(`'${moment(startTime).format('YYYY-MM-DD HH:mm:ss.SSS')}'`),
            ResponseBody: JSON.stringify(response?.data ?? {}),
            Duration: duration
        });

        if (response.status == 200) 
        {
            await t.commit();
            res.status(200).json({ status: 1, message: 'Pre Binning Status updated successfully.' });
        } 
        else 
        {
            await t.rollback();
            res.status(202).json({ status: 0, message: 'Uathayam API throw' + response.title });
        }
    } 
    catch (error) 
    {
        await t.rollback();
        res.status(202).json({ status: 0, message: error.message });
    }
};

const getERPRetrievalData = async (req, res) => {
    try
    {
        const retrievalList = await ERPRetrieval.findAll({where:{isDelete:0}, tableHint: TableHints.NOLOCK})
        let stationData = await MasterStation.findAll({tableHint: TableHints.NOLOCK})
        if (!retrievalList) 
        {
            res.status(202).json({status: 0, message: 'Page Data not found' });
        }
        else
        {
            res.status(200).json({status: 1, message: 'get ERP_Retrieval Data successfully', data: retrievalList, stationData: stationData });
        }
    }
    catch (error)
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

const addPalletRequest = async (req, res) => {
    try
    {
        let dataList = req.body.data
        let errorArray = []
        for(let i = 0; i < dataList.length; i++)
        {
            let data = dataList[i]
            const retrievalPallet = await palletRequest.findAll({
                where: {
                    BinID: data.BinID || data.id,
                    Status: 'G'
                },
                tableHint: TableHints.NOLOCK
            })

            if(retrievalPallet.length > 0)
            {
                errorArray.push(`BinID: ${data.BinID || data.id} Already in Queue List`)
            }
            else
            {
                let reqList = {}
                reqList.EquipmentNo = 1
                reqList.BinID = data.id //data.BinID || data.id
                reqList.ReqUser = req.user.UserName
                reqList.ReqType = req.body.ReqType
                reqList.ItemCode = data.ItemCode
                reqList.ItemName = data.ItemName
                reqList.ItemGroup = data.ItemGroup
                reqList.ReqTime = sequelize.literal('GETDATE()')
                reqList.Status = 'G'
                reqList.Quantity = data.Quantity
                reqList.Side = '01'
                reqList.Bay = '002'
                reqList.Level = '02'
                reqList.Deep = '01'
                reqList.Station = req.body.Station
                reqList.CompletedTime = sequelize.literal('GETDATE()')
                //reqList.ScheduleTime = req.body.ScheduleTime
                //reqList.ShuffleTime = req.body.ShuffleTime
                let instert = await palletRequest.create(reqList)
                let updateData = await ERPRetrieval.update({isDelete: 1}, {
                    where:{
                        OrderNo: data.OrderNo,
                        ItemCode:data.ItemCode
                    }
                })

                if(!instert)
                {
                    errorArray.push(`BinID: ${data.BinID || data.id} not added in Queue List`)
                }
            }
        }
       
        if (errorArray.length > 0) 
        {
            res.status(202).json({ status: 0, message: 'Failed to get Request Bin', data:errorArray });
        }
        else
        {
            res.status(200).json({ status: 1, message: 'get ERP_Retrieval Data successfully', data: dataList });
        }
    }
    catch (error)
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

//EMPTY BIN IN
const EmptyBinStore = async (req, res) => {
    const { data: binData } = req.body;

    if (!binData || !Array.isArray(binData) || binData.length === 0) {
        return res.status(202).json({ status: 0, message: 'Invalid or empty bin data' });
    }

    const { UserName } = req.user;

    try {
        // Fetch all required bin details in bulk
        const binningDetailsMap = new Map();
        const inventoryDetailsMap = new Map();

        const binningDetails = await MasterBin.findAll({
            where: { BinID: binData },
            tableHint: TableHints.NOLOCK
        });

        const inventoryDetails = await storageData.findAll({
            where: { BinID: binData },
            tableHint: TableHints.NOLOCK
        });
        
        if(binningDetails.length == 0)
        {
            return res.status(202).json({ status: 0, message: 'Scanned BinID Not in Bin Master' });
        }
        
        binningDetails.forEach(detail => binningDetailsMap.set(detail.BinID, detail));
        inventoryDetails.forEach(detail => inventoryDetailsMap.set(detail.BinID, detail));

        const insertPromises = [];

        for (const binId of binData) 
        {
            const binningDetail = binningDetailsMap.get(binId);
            const invDetail = inventoryDetailsMap.get(binId);

            if (binningDetail && !invDetail) 
            {
                const invList = {
                    BinID: binId,
                    ItemCode: 'EMPTY',
                    ItemName: 'EMPTY',
                    ItemGroup: 'EMPTY',
                    InQuantity: 1,
                    Quantity: 0,
                    OutQuantity: 0,
                    UserName,
                    UpdatedDate: sequelize.literal('GETDATE()'),
                    PickType: 'EMPTY',
                    Category: 'C'
                };

                insertPromises.push(storageData.create(invList));
            } 
            else if (invDetail) 
            {
                return res.status(202).json({
                    status: 0,
                    message: `Already a request created in Inventory List for BinID: ${binId}`
                });
            }
        }

        // Wait for all insertions to complete
        const results = await Promise.all(insertPromises);

        if (results.some(result => !result)) 
        {
            throw new Error('Failed to insert one or more records into Inventory List');
        }

        return res.status(200).json({ status: 1, message: 'Empty Bin Store successfully.' });

    } catch (error) {
        return res.status(202).json({
            status: 0,
            message: error.message || 'An unexpected error occurred'
        });
    }
};

const EmptyBinPageData = async(req, res) =>{
    try
    {
        //let data = req.body
        let stationData = await MasterStation.findAll({tableHint: TableHints.NOLOCK})
        if(stationData)
        {
            res.status(200).json({ status: 1, station:stationData, message: 'Station Master Data get successfully.'});
        }
        else
        {
            res.status(202).json({ status: 0, message: 'Failed to get Station Master Data' });
        }
    }
    catch (error) 
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

const getEmptyBinCount = async(req, res) =>{
    try
    {
        let data = req.body
        let options = {
            ItemCode: 'EMPTY',
        }

        if(data.AisleNo)
        {
            if(data.AisleNo != 'ALL')
            {
                options.AisleNo = parseInt(data.AisleNo)
            }
        }

        let emptyBinData = await InvPalletDetails.findAll({
            where: options,
            tableHint: TableHints.NOLOCK
        })

        if(emptyBinData)
        {
            res.status(200).json({ status: 1, data:emptyBinData, message: 'Empty Bin Data get successfully.'});
        }
        else
        {
            res.status(202).json({ status: 0, message: 'Failed to get Empty Bin Data' });
        }
    }
    catch (error) 
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

const emptyBinRequest = async(req, res) =>{
    try
    {
        let data = req.body
        let item = {
            OrderNo: sequelize.literal(`FORMAT(GETDATE(), 'dd/MM/yy/hhmmss')`),
            DocEntry: 'EMPTY',
            Type: 'Manual',
            ItemCode: 'EMPTY',
            ItemName: 'EMPTY',
            ItemGroup: 'EMPTY',
            Quantity: data.quantity,
            Station: data.station,
            Floor: data.Floor,
            ReqType: 'Manual',
            SequenceNo: 1,
            CreatedBy: req.user.UserName,
        }

        const palletRequestList = await ERPRetrieval.create(item);

        if(palletRequestList)
        {
            res.status(200).json({ status: 1, data:palletRequestList, message: 'Empty Bin Retrieve Request Created successfully.'});
        }
        else
        {
            res.status(202).json({ status: 0, message: 'Failed to create Empty Bin Retrieve Request' });
        }
    }
    catch (error) 
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

const pickingRequestID= async(req, res) =>{
    try 
    {
        let BinID = req.body.data
        
        let retrievalBin = await RetrievalConfirmation.findAll({where: {binID: BinID, status: 'P'},tableHint: TableHints.NOLOCK})
        let retrievalOrder = []
        if(retrievalBin.length > 0)
        {
            retrievalOrder = await ERPRetrieval.findAll({where: {OrderNo: retrievalBin[0].dataValues.orderNo},tableHint: TableHints.NOLOCK})
            // Filter based on the given ID
            let filteredOrders = [] //flatOrders.filter(item => item.oderID === id);
            let filteredBins = [] //flatBins.filter(item => item.binID === id);
            if(retrievalOrder.length > 0)
            {
                filteredOrders = retrievalOrder
                filteredBins = retrievalBin
            }
            else
            {
                filteredBins = retrievalBin
            }
            
            const partList = await MasterPart.findAll({
                attributes: ['ItemCode','Color'],
                tableHint: TableHints.NOLOCK
            }).then(data => {
                let partCodes = [];
                data.forEach(item => {
                    partCodes.push({ItemCode: item.ItemCode, Color: item.Color}); 
                });
                res.partCodes = partCodes; 
            })

            const coloredOrders = filteredOrders.map(orderList => {
                let order = orderList.dataValues
                const matchingPartCode = res.partCodes.find(partCode => partCode.ItemCode === order.itemCode);
                if (matchingPartCode) 
                {
                    return { ...order, color: matchingPartCode.Color };
                } 
                else 
                {
                    return { ...order, color: "#FFFFFF" };
                }
            });

            const coloredBins = filteredBins.map(binList => {
                let bin = binList.dataValues
                const matchingPartCode = res.partCodes.find(partCode => partCode.ItemCode === bin.itemCode);
                if (matchingPartCode) 
                {
                    return { ...bin, color: matchingPartCode.Color };
                } 
                else 
                {
                    return { ...bin, color: "#FFFFFF" };
                }
            })

            const remarks = await MasterReason.findAll({
                attributes: ['ReasonID','ReasonDescription'],
                tableHint: TableHints.NOLOCK
            })
    
            res.status(200).json({ status: 1, message: 'get ERP_Retrieval Data successfully', orderList: coloredOrders, binList: coloredBins, remarks : remarks });
        }
        else
        {
            res.status(202).json({ status: 0, message:'Scanned BinID Not Found in Retrival Process' });
        }
    } catch (error) {
        res.status(202).json({ status: 0, message: error.message });
    }
}

const pickingApproval = async (req, res) => {
    const t = await sequelize.transaction();
    try 
    {
        const dataList = req.body;  
        
        if(dataList[0].Remark != '')
        {
            let ERPDetails = await sequelize.query(`update ERP_Retrieval set Status='${dataList[0].status}', isOrderConfirm='Y', ConfirmRemark='${dataList[0].Remark}', OrderCompletedTime = GETDATE() where OrderNo = '${dataList[0].orderNo}'`);
        }
        else
        {
            let ERPDetails = await sequelize.query(`update ERP_Retrieval set Status='${dataList[0].status}', isOrderConfirm='Y',OrderCompletedTime = GETDATE() where OrderNo = '${dataList[0].orderNo}'`);
        }

        let updatedData = await ERPRetrieval.findAll( {where: { OrderNo: dataList[0].orderNo, Status:{[Op.in]: ["C","PC","PCC"]}, PickingQty: { [Op.gt]: 0 }  }, tableHint: TableHints.NOLOCK})        
        let updatedData2 = await ERPRetrieval.findAll( {where: { OrderNo: dataList[0].orderNo}, tableHint: TableHints.NOLOCK})        
        
        let StationUpdate = await sequelize.query(`update Master_Station_Conveyor set StationAssigned = 0, OrderNo = NULL where ST_Code = '${updatedData2[0].dataValues.Station}' and OrderNo = '${dataList[0].orderNo}'`);  
        
        if(updatedData.length > 0)
        {
            // Fetch Bearer Token (assuming you have a function for this)
            let bearerToken = '' 
            const tokenData = await fetchBearerToken();
            if(tokenData.status === 1)
            {
                bearerToken = tokenData.TokenNo
            }
            else
            {
                await t.rollback(); // Rollback the transaction
                res.status(202).json({ status: 0, message: tokenData.message });
            }

            // Prepare headers with Authorization header
            const headers = {
                'Authorization': `Bearer ${bearerToken}`,
                'Content-Type': 'application/json'
            };

            // Example API URL to trigger
            const apiUrl = ERPAPIURL+'RetrievalConfirmation/RetrievalConfirmation';
            let RetrievalData = []
            let Station = 0
            for(let i = 0; i < updatedData.length; i++)
            {
                let data = updatedData[i].dataValues
                let trolley = ''
                if(data.TrolleyNo)
                {
                    trolley = data.TrolleyNo.toString()
                }

                Station = data.Station
                let item = {}
                item.tokenNo = bearerToken,
                item.processType = 'PickConfirmation',
                item.orderNo = data.OrderNo,
                item.type = data.Type,
                item.trolley = trolley,
                item.itemCode = data.ItemCode,
                item.itemName = data.ItemName,
                item.itemGroup = data.ItemName,
                item.reqQuantity = parseInt(data.Quantity) ,
                item.pickedQty = parseInt(data.PickingQty),
                item.remark = data.ConfirmRemark
                RetrievalData.push(item)
            }
            
            // Example payload (if needed)
            const payload = {
                type: "CraftsmanRequest",
                stationID : Station,
                data: RetrievalData
            };

            const startTime = new Date();
            let userID = req.user ? req.user['UserName'] || '0' : req.body.id || '0';
            const requestInfo = {
                URL: apiUrl,
                RequestedDateTime: sequelize.literal(`'${moment(startTime).format('YYYY-MM-DD HH:mm:ss.SSS')}'`),
                RequestBody: payload,
                UserName: userID,
            };

            // Make POST request to the API URL
            const response = await axios.post(apiUrl, payload, { headers });

            const duration = new Date() - startTime; 
            await CustomerAPILog.create({
                ...requestInfo,
                StatusCode: res.statusCode,
                ResponseDateTime: sequelize.literal(`'${moment(startTime).format('YYYY-MM-DD HH:mm:ss.SSS')}'`),
                ResponseBody: JSON.stringify(response?.data ?? {}),
                Duration: duration
            });

            if(response.status == 200)
            { 
                await t.commit(); // Commit the transaction
                res.status(200).json({ status: 1, message: 'Picking Approval successfully'});
            }
            else
            {
                await t.rollback(); // Rollback the transaction
                res.status(202).json({ status: 0, message: 'Uathayam API throw' + response.title });  
            }
        }
        else
        {
            await t.rollback();
            res.status(202).json({status: 0, message: 'Failed to Update Order Complete Process'});
        }
    } 
    catch (error) {
        res.status(202).json({ status: 0, message: error.message });
    }
}

const tvDisplay = async (req, res) => {
    try {
        let aisleData = req.query.aisle ?? ''; 
        let Aisle = (aisleData == "All") ? aisleData : aisleData.slice(-1);//Fetching Aisle from URL

        let status=0;
        let message=""; 
        let query;

        // Query for all aisles
        if (Aisle === 'All') {
            query = `
                SELECT EquipmentNo AS Aisle, 
                    totalLocations, 
                    emptyLocations, 
                    occupiedLocations,
                    emptyBins,
                    occupiedBins
                FROM (
                    SELECT EquipmentNo, 
                        COUNT(*) as totalLocations,
                        (SELECT COUNT(*) FROM LocationSpecification WITH (NOLOCK) WHERE PickDelPoint=0 AND Blocked=0 AND Error=0 AND PalletID IS NULL AND EquipmentNo=LS.EquipmentNo) as emptyLocations,
                        (SELECT COUNT(*) FROM LocationSpecification WITH (NOLOCK) WHERE PickDelPoint = 0 AND PalletID != '' AND EquipmentNo=LS.EquipmentNo) as occupiedLocations,
                        (SELECT COUNT(*) FROM LocationSpecification WITH (NOLOCK) WHERE PickDelPoint = 0 AND PalletID IS NOT NULL AND PartNo IS NULL AND EquipmentNo=LS.EquipmentNo) as emptyBins,
                        (SELECT COUNT(*) FROM LocationSpecification WITH (NOLOCK) WHERE PickDelPoint = 0 AND PalletID IS NOT NULL AND PartNo IS NOT NULL AND EquipmentNo=LS.EquipmentNo) as occupiedBins
                    FROM LocationSpecification LS WITH (NOLOCK)
                    WHERE PickDelPoint = 0
                    GROUP BY EquipmentNo
                ) AS LocationStats
            `;
        } else {
            query = `
                SELECT '${Aisle}' AS Aisle, 
                    totalLocations, 
                    emptyLocations, 
                    occupiedLocations,
                    emptyBins,
                    occupiedBins
                FROM (
                    SELECT 
                        COUNT(*) as totalLocations,
                        (SELECT COUNT(*) FROM LocationSpecification WITH (NOLOCK) WHERE PickDelPoint=0 AND Blocked=0 AND Error=0 AND PalletID IS NULL AND EquipmentNo='${Aisle}') as emptyLocations,
                        (SELECT COUNT(*) FROM LocationSpecification WITH (NOLOCK) WHERE PickDelPoint = 0 AND PalletID != '' AND EquipmentNo='${Aisle}') as occupiedLocations,
                        (SELECT COUNT(*) FROM LocationSpecification WITH (NOLOCK) WHERE PickDelPoint = 0 AND PalletID IS NOT NULL AND PartNo IS NULL AND EquipmentNo='${Aisle}') as emptyBins,
                        (SELECT COUNT(*) FROM LocationSpecification WITH (NOLOCK) WHERE PickDelPoint = 0 AND PalletID IS NOT NULL AND PartNo IS NOT NULL AND EquipmentNo='${Aisle}') as occupiedBins
                    FROM LocationSpecification WITH (NOLOCK)
                    WHERE PickDelPoint = 0 AND EquipmentNo='${Aisle}'
                ) AS LocationStats
            `;
        }

        const [tableData] = await sequelize.query(query);
        if (tableData.length > 0) {
            occupiedPer = tableData[0].OccpiedPer;
            status=1;
        }

        //TV Display Alarm Status
        const AlarmHistory = require(`../models/history/AlarmHistory`);
        const [alrmResult, metadatas] = await sequelize.query("select COUNT(AlarmDateTime) as CNT from AlarmHistory WITH (NOLOCK) where AlarmAckTime is  null and IsReset=0");
        if (alrmResult.length > 0) {
            alarmCount = alrmResult[0].CNT;
        }
        let queryOptions = {
            attributes: [['AlarmText', 'ErrorDescription']],
            where: {
                AlarmAckTime: null,
                IsReset: 0
            },
            order: [],
            tableHint: TableHints.NOLOCK        
        };

        //Filtering based on Aisle
        if (Aisle !== 'All') {
            queryOptions.where.EquipmentNo = Aisle;
        }
        // Execute the query
        const alarmStatusList = await AlarmHistory.findAndCountAll(queryOptions); 


        
        res.status(200).json({ status: status,message:message,tableData,alarmStatusList });
    } catch (error) {
        res.status(202).json({status: 0, message: error.message});
    }
}

const ScheduleQueueRequest = async (req, res) => {
    try
    {
        const scheduleDetails = await ERPSchedule.findAll({
            where: {Status: { [Op.in]: ["G", "P", "Hold"] } },
            tableHint: TableHints.NOLOCK
        })

        let scheduleQueue = []
        for(let i = 0; i < scheduleDetails.length; i++)
        {
            let dataList = scheduleDetails[i].dataValues
            let idx = scheduleQueue.findIndex(item => item.OrderNo === dataList.OrderNo)
            if(idx < 0)
            {
                let list = {}
                list.OrderNo = dataList.OrderNo
                list.Type = dataList.Type
                list.Quantity = parseFloat(dataList.Quantity) 
                list.Station = dataList.Station
                list.NoOfItem = parseFloat(1)
                list.ItemStatus = [dataList.Status]
                list.ReqType = 'SCHR'
                list.ScheduledTime = dataList.ScheduleDateTime
                if(list.ItemStatus.filter(item => item === 'Hold').length > 0)
                {
                    list.Status = 'Hold'
                }
                else if(list.ItemStatus.filter(item => item === 'P').length > 0)
                {
                    list.Status = 'P'
                }
                else
                {
                    list.Status = 'G'
                }
                scheduleQueue.push(list)
            }
            else
            {
                scheduleQueue[idx].Quantity += parseFloat(dataList.Quantity)
                scheduleQueue[idx].NoOfItem += 1
                scheduleQueue[idx].ItemStatus.push(dataList.Status)
                if(scheduleQueue[idx].ItemStatus.filter(item => item === 'Hold').length > 0)
                {
                    scheduleQueue[idx].Status = 'Hold'
                }
                else if(scheduleQueue[idx].ItemStatus.filter(item => item === 'P').length > 0)
                {
                    scheduleQueue[idx].Status = 'P'
                }
                else
                {
                    scheduleQueue[idx].Status = 'G'
                }
            }
        }

        const nightShuffleDetails = await ERPNightShuffle.findAll({
            where: {Status: { [Op.in]: ["G", "P", "Hold"] } },
            tableHint: TableHints.NOLOCK
        })

        for(let j = 0; j < nightShuffleDetails.length; j++)
        {
            let dataList = nightShuffleDetails[j].dataValues
            let idx = scheduleQueue.findIndex(item => item.OrderNo === dataList.OrderNo)
            if(idx < 0)
            {
                let list = {}
                list.OrderNo = dataList.OrderNo
                list.Type = dataList.Type
                list.Quantity = parseFloat(dataList.Quantity) 
                list.Station = dataList.Station
                list.NoOfItem = parseFloat(1)
                list.ItemStatus = [dataList.Status]
                list.ReqType = 'NSHF'
                list.ShuffleTime = dataList.ShuffleDateTime
                if(list.ItemStatus.filter(item => item === 'Hold').length > 0)
                {
                    list.Status = 'Hold'
                }
                else if(list.ItemStatus.filter(item => item === 'P').length > 0)
                {
                    list.Status = 'P'
                }
                else
                {
                    list.Status = 'G'
                }
                scheduleQueue.push(list)
            }
            else
            {
                scheduleQueue[idx].Quantity += parseFloat(dataList.Quantity)
                scheduleQueue[idx].NoOfItem += 1
                scheduleQueue[idx].ItemStatus.push(dataList.Status)
                if(scheduleQueue[idx].ItemStatus.filter(item => item === 'Hold').length > 0)
                {
                    scheduleQueue[idx].Status = 'Hold'
                }
                else if(scheduleQueue[idx].ItemStatus.filter(item => item === 'P').length > 0)
                {
                    scheduleQueue[idx].Status = 'P'
                }
                else
                {
                    scheduleQueue[idx].Status = 'G'
                }
            }
        }

        res.status(200).json({ status: 1, message: 'Get ScheduleQueueRequest Data successfully', data: scheduleQueue });
    }
    catch(error)
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

const updateScheduleQueueList = async (req, res) => {
    try
    {
        let data = req.body.data
        let failureData = []
        const updateRetriveQueuePromises = await data.map(async (dataList) => {
            if(dataList.removeStatus == 'Remove')
            {
                if(dataList.ReqType == 'SCHR')
                {
                    const retrievalList = await ERPSchedule.findAll({where:{OrderNo: dataList.OrderNo, Status: { [Op.in]:["G", "Hold"] } }, tableHint: TableHints.NOLOCK})
                    if (retrievalList) 
                    {
                        let deleteStatusData = await ERPSchedule.destroy({
                            where: {
                                OrderNo: dataList.OrderNo, 
                                Status: { [Op.in]:["G", "Hold"] }
                            },
                            returning: true
                        })

                        if(deleteStatusData)
                        {
                            return { item: dataList, created: true };
                        }
                        else
                        {
                            failureData.push(dataList)
                            return { item: dataList, created: false };
                        }
                    }
                    else
                    {
                        failureData.push(dataList)
                        return { item: dataList, created: false };
                    }
                }
                else if(dataList.ReqType == 'NSHF')
                {
                    const retrievalList = await ERPNightShuffle.findAll({where:{OrderNo: dataList.OrderNo, Status: { [Op.in]:["G", "Hold"] } }, tableHint: TableHints.NOLOCK})
                    if (retrievalList) 
                    {
                        let deleteStatusData = await ERPNightShuffle.destroy({
                            where: {
                                OrderNo: dataList.OrderNo, 
                                Status: { [Op.in]:["G", "Hold"] }
                            },
                            returning: true
                        })

                        if(deleteStatusData)
                        {
                            return { item: dataList, created: true };
                        }
                        else
                        {
                            failureData.push(dataList)
                            return { item: dataList, created: false };
                        }
                    }
                    else
                    {
                        failureData.push(dataList)
                        return { item: dataList, created: false };
                    }
                }
            }
            else if(dataList.removeStatus == 'Hold')
            {
                if(dataList.ReqType == 'SCHR')
                {
                    const retrievalList = await ERPSchedule.findAll({where:{OrderNo: dataList.OrderNo, Status: { [Op.in]:["G", "Hold"] } }, tableHint: TableHints.NOLOCK})
                    if (retrievalList) 
                    {
                        let updateStatusData = await ERPSchedule.update(
                            { Status: dataList.removeStatus},
                            {
                                where: { OrderNo: dataList.OrderNo, Status: { [Op.in]:["G", "Hold"] } },
                                returning: true
                            }
                        )

                        if(updateStatusData)
                        {
                            return { item: dataList, created: true };
                        }
                        else
                        {
                            failureData.push(dataList)
                            return { item: dataList, created: false };
                        }
                    }
                    else
                    {
                        failureData.push(dataList)
                        return { item: dataList, created: false };
                    }
                }
                else if(dataList.ReqType == 'NSHF')
                {
                    const retrievalList = await ERPNightShuffle.findAll({where:{OrderNo: dataList.OrderNo, Status: { [Op.in]:["G", "Hold"] } }, tableHint: TableHints.NOLOCK})
                    if (retrievalList) 
                    {
                        let updateStatusData = await ERPNightShuffle.update(
                            { Status: dataList.removeStatus},
                            {
                                where: { OrderNo: dataList.OrderNo, Status: { [Op.in]:["G", "Hold"] } },
                                returning: true
                            }
                        )

                        if(updateStatusData)
                        {
                            return { item: dataList, created: true };
                        }
                        else
                        {
                            failureData.push(dataList)
                            return { item: dataList, created: false };
                        }
                    }
                    else
                    {
                        failureData.push(dataList)
                        return { item: dataList, created: false };
                    }
                }
            }
            else if(dataList.removeStatus == 'Normal')
            {
                if(dataList.ReqType == 'SCHR')
                {
                    const retrievalList = await ERPSchedule.findAll({where:{OrderNo: dataList.OrderNo, Status: { [Op.in]: ["G", "Hold"] } }, tableHint: TableHints.NOLOCK})
                    if (retrievalList) 
                    {
                        let updateData = await ERPSchedule.update(
                            {Status:'G'},
                            {
                                where: { OrderNo: dataList.OrderNo, Status: { [Op.in]: ["G", "Hold"] } },
                                returning: true
                            }
                        )

                        if(updateData)
                        {
                            return { item: dataList, created: true };
                        }
                        else
                        {
                            failureData.push(dataList)
                            return { item: dataList, created: false };
                        }
                    }
                    else
                    {
                        failureData.push(dataList)
                        return { item: dataList, created: false };
                    }
                }
                else if(dataList.ReqType == 'NSHF')
                {
                    const retrievalList = await ERPNightShuffle.findAll({where:{OrderNo: dataList.OrderNo, Status: { [Op.in]: ["G", "Hold"] } }, tableHint: TableHints.NOLOCK})
                    if (retrievalList) 
                    {
                        let updateData = await ERPNightShuffle.update(
                            {Status:'G'},
                            {
                                where: { OrderNo: dataList.OrderNo, Status: { [Op.in]: ["G", "Hold"] } },
                                returning: true
                            }
                        )

                        if(updateData)
                        {
                            return { item: dataList, created: true };
                        }
                        else
                        {
                            failureData.push(dataList)
                            return { item: dataList, created: false };
                        }
                    }
                    else
                    {
                        failureData.push(dataList)
                        return { item: dataList, created: false };
                    }
                }
            } 
        })
        // Execute all promises concurrently
        const results = await Promise.all(updateRetriveQueuePromises);
        // Check the results for any failures
        const hasFailures = results.some(({ created }) => !created);
    
        // Respond based on whether there were any failures
        if ((!hasFailures) && (failureData.length == 0))
        {
            res.status(200).json({ TokenNo: req.headers['authenticatetoken'], status: 1, message: 'Schedule Queue Updated successfully' });
        } 
        else 
        {
            res.status(202).json({ status: 0, message: 'Failed to update Schedule Queue', data: failures });
        }
    }
    catch(error)
    {
        res.status(202).json({status: 0, message: error.message})
    }
}

const fetchBearerToken = async () => {
    try
    {
        // Logic to fetch bearer token
        const response = await axios.get(ERPAPIURL+'token?clientId=UathayamERP1&clientSecret=korlG/uMmkGC4OHbFXkXKw==',);
        return {TokenNo: response.data, status: 1 };
    }
    catch(error)
    {
        return {status: 0, message: error.message };
    }
};

const updateRetriveQueueList = async (req, res) => {
    try
    {
        let data = req.body.data
        let failureData = []
        const updateRetriveQueuePromises = data.map(async (dataList) => {
            if(dataList.RemoveStatus == 'Remove')
            {
                const retrievalList = await ERPRetrieval.findAll({where:{OrderNo: dataList.OrderNo, Status: { [Op.in]:["G", "Hold"] } }, tableHint: TableHints.NOLOCK})
                if (retrievalList) 
                {
                    let deleteStatusData = await ERPRetrieval.destroy({
                            where: { 
                                OrderNo: dataList.OrderNo, 
                                Status: { [Op.in]:["G", "Hold"] } 
                            },
                            returning: true
                        })

                    if(deleteStatusData)
                    {
                        return { item: dataList, created: true };
                    }
                    else
                    {
                        failureData.push(dataList)
                        return { item: dataList, created: false };
                    }
                }
                else
                {
                    failureData.push(dataList)
                    return { item: dataList, created: false };
                }
            }
            else if(dataList.RemoveStatus == 'Hold')
            {
                const retrievalList = await ERPRetrieval.findAll({where:{OrderNo: dataList.OrderNo, Status: { [Op.in]:["G", "Hold"] } },tableHint: TableHints.NOLOCK})
                if (retrievalList) 
                {
                    let updateStatusData = await ERPRetrieval.update(
                        { Status: dataList.RemoveStatus, SequenceNo: dataList.IndexPosition},
                        {
                            where: { OrderNo: dataList.OrderNo, Status: { [Op.in]:["G", "Hold"] } },
                            returning: true
                        }
                    )

                    if(updateStatusData)
                    {
                        return { item: dataList, created: true };
                    }
                    else
                    {
                        failureData.push(dataList)
                        return { item: dataList, created: false };
                    }
                }
                else
                {
                    failureData.push(dataList)
                    return { item: dataList, created: false };
                }
            }
            else if(dataList.RemoveStatus == 'Normal')
            {
                const retrievalList = await ERPRetrieval.findAll({where:{OrderNo: dataList.OrderNo, Status: { [Op.in]: ["G", "Hold"] } }, tableHint: TableHints.NOLOCK})
                if (retrievalList) 
                {
                    let updateData = await ERPRetrieval.update(
                        {Status:'G', SequenceNo: dataList.IndexPosition},
                        {
                            where: { OrderNo: dataList.OrderNo, Status: { [Op.in]: ["G", "Hold"] } },
                            returning: true
                        }
                    )

                    if(updateData)
                    {
                        return { item: dataList, created: true };
                    }
                    else
                    {
                        failureData.push(dataList)
                        return { item: dataList, created: false };
                    }
                }
                else
                {
                    failureData.push(dataList)
                    return { item: dataList, created: false };
                }
            } 
        })

        // Execute all promises concurrently
        const results = await Promise.all(updateRetriveQueuePromises);

        // Check the results for any failures
        const hasFailures = results.some(({ created }) => !created);
    
        // Respond based on whether there were any failures
        if ((!hasFailures) && (failureData.length == 0))
        {
            res.status(200).json({ TokenNo: req.headers['authenticatetoken'], status: 1, message: 'Retrieval Queue Updated successfully' });
        } 
        else 
        {
            res.status(202).json({ status: 0, message: 'Failed to update Retrieval Queue', data: failures });
        }
    }
    catch(error)
    {
        res.status(202).json({status: 0, message: error.message})
    }
}
const stockAdjustmentList = async (req, res) => {
    try {
        const { type } = req.query;
        let query = `
                SELECT DISTINCT
                    inv.BinID,
                    inv.ItemCode,
                    inv.ItemName,
                    inv.ItemGroup,
                    inv.Category,
                    inv.Description,
                    inv.Color,
                    inv.Size,
                    inv.Style,
                    inv.BinCapacity,
                    inv.Field1,
                    inv.Field2,
                    inv.Field3,
                    inv.Quantity,
                    loc.Side,
                    loc.Bay,
                    loc.Level,
                    loc.Deep,
                    loc.EquipmentNo AS ShuttleID,
                    loc.AisleNo,
                    loc.AliasBinID,
                    RIGHT('00' + CAST(loc.Side AS VARCHAR(2)), 2) + RIGHT('000' + CAST(loc.Bay AS VARCHAR(3)), 3) + RIGHT('00' + CAST(loc.Level AS VARCHAR(2)), 2) + CAST(loc.Deep AS VARCHAR(MAX)) AS Location
                FROM
                    Inv_PalletDetails inv WITH (NOLOCK)
                LEFT JOIN
                    LocationSpecification loc WITH (NOLOCK) ON inv.BinID = loc.BinID
                LEFT JOIN
                    SideCraneMap scm WITH (NOLOCK) ON scm.SideID = loc.Side
                WHERE 1=1 `;

        //if (type != undefined && type == 'Available') 
        {
            query += ` AND loc.BinID IS NOT NULL AND loc.ItemCode != 'EMPTY'`;
        } 
        // else if (type != undefined && type == 'Unavailable')
        // {
        //     query += ` AND loc.BinID IS NULL`;
        // }
        query += `ORDER BY AisleNo,ShuttleID`
        const result = await sequelize.query(query, { type: sequelize.QueryTypes.SELECT });

        const header = await tableHeader('StockAdjustment');
        const stationData = await MasterStation.findAll({tableHint: TableHints.NOLOCK})
        res.status(200).json({ status: 1, message: 'Success',header, data: result, stationData: stationData });
    } 
    catch (error) 
    {
        res.status(200).json({ status: 0, message: error.message });
    }
}

const stockAdjustmentUpdate = async (req, res) => {
    const t = await sequelize.transaction();
    const StockAdjustmentHistory = require('../models/history/StockAdjustmentHistory');
    const InvPalletDetails = require('../models/transaction/InvPalletDetail');
    try
    {
        let data = req.body;
        const stockAdjustPromises = await data.map(async (item) => {
            const { BinID, ItemCode, ItemName, ItemGroup, Category, Description, Color, Size, Style, BinCapacity, Field1, Field2, Field3, SystemStock, updatedStock, AisleNo, ShuttleID, Quantity } = item;   
            // Update operation
            const [numUpdatedRows, updatedRows] = await InvPalletDetails.update(
                { Quantity: updatedStock, OutQuantity: 0 },
                {
                    where: {
                        BinID: BinID, // Assuming PalletId is the primary key
                        ItemCode: ItemCode
                    },
                    transaction: t,
                }
            );

            // Check if any rows were updated
            if (numUpdatedRows > 0) {
                // Insert operation
                const insertedRow = await StockAdjustmentHistory.create(
                    {
                        BinID,
                        ItemName,
                        ItemCode,
                        ItemGroup,
                        Category,
                        Description,
                        Color,
                        Size,
                        Style,
                        BinCapacity,
                        Field1,
                        Field2,
                        Field3,
                        SystemStock:Quantity,
                        PhysicalStock:updatedStock,
                        CreatedBy: req.user.UserName,
                        UserName: req.user.UserName,
                    },
                    { transaction: t }
                );

                if (numUpdatedRows && insertedRow) 
                {
                    return { updated: true };
                } 
                else 
                {
                    return { updated: false };
                }
            } 
            else 
            {
                return { updated: false };
            }
        })

        const results = await Promise.all(stockAdjustPromises);
        const hasFailures = results.flat().some(({ updated }) => !updated); 

        // Respond based on whether there were any failures
        if (!hasFailures)
        {
            await t.commit(); // Commit the transaction
            const result = await sequelize.query('EXEC SP_RawConfirmation @Type = :Type, @BinID = :BinID, @ItemCode = :ItemCode, @ItemName = :ItemName', {
                replacements: { 
                    Type: "Confirm",
                    BinID: data[0].BinID,
                    ItemCode: data[0].ItemCode,
                    ItemName: data[0].ItemName
                },
                Type: 'Show'
            });
            res.status(200).json({ TokenNo: req.headers['authenticatetoken'], status: 1, message: 'Stock adjustments updated successfully.' })
        } 
        else 
        {
            await t.rollback(); // Rollback the transaction
            res.status(202).json({ status: 0, message: 'Failed to update Stock adjustments'});
        }
    }
    catch(error)
    {
        await t.rollback(); // Rollback the transaction
        res.status(202).json({status: 0, message: error.message})
    }
}

const stockAdjustmentBinRequest = async (req, res) => {
    const t = await sequelize.transaction();
    try
    {
        let dataList = req.body.data
        let retrivalPending = await palletRequest.findAll({where:{Status :{ [Op.in]: ["G", "P"]}, ReqType: 'PIC'}, tableHint: TableHints.NOLOCK})
        if(retrivalPending.length == 0)
        {
            let errorArray = []
            const stockAdjustRequestPromises = dataList.map(async (data) => {
                //check already in queue
                const retrievalPallet = await palletRequest.findAll({
                    where: {
                        BinID: data.BinID,
                        Status: 'G'
                    },
                    tableHint: TableHints.NOLOCK
                })

                if(retrievalPallet.length > 0)
                {
                    errorArray.push(data.BinID)
                    return { created: false }
                }
                else
                {
                    let StationDetails = await sequelize.query(`select ST_Code from Master_Station WITH (NOLOCK) where AisleID = ${data.AisleNo} and ShuttleID = ${data.ShuttleID} and Type = 0`)
                    let reqList = {}
                    reqList.ShuttleID = data.ShuttleID
                    reqList.BinID = data.BinID
                    reqList.ReqUser = req.user.UserName
                    reqList.ReqType = 'STK'
                    reqList.ItemCode = data.ItemCode
                    reqList.ItemName = data.ItemName
                    reqList.ItemGroup = data.ItemGroup
                    reqList.Description = data.Description
                    reqList.Category = data.Category
                    reqList.ReqTime = sequelize.literal('GETDATE()')
                    reqList.Status = 'G'
                    reqList.Quantity = parseInt(data.Quantity)
                    reqList.Side = data.Side
                    reqList.Bay = data.Bay
                    reqList.Level = data.Level
                    reqList.Deep = data.Deep
                    reqList.Station = StationDetails[0][0].ST_Code
                    reqList.GTPStation = parseInt(data.Station)
                    reqList.Floor = parseInt(data.Floor) 
                    reqList.AisleNo = data.AisleNo
                    reqList.PickCategory = 'STK'
                    reqList.AliasBinID = data.AliasBinID

                    let instert = await palletRequest.create(reqList)
                
                    if (instert) 
                    {
                        return { created: true };
                    } 
                    else 
                    {
                        errorArray.push(data.BinID)
                        return { created: false };
                    }
                }
            })

            const results = await Promise.all(stockAdjustRequestPromises);
            const hasFailures = results.flat().some(({ created }) => !created); 

            // Respond based on whether there were any failures
            if ((!hasFailures) && (errorArray.length == 0))
            {
                await t.commit(); // Commit the transaction
                res.status(200).json({ TokenNo: req.headers['authenticatetoken'], status: 1, message: 'Stock adjustments Bin Request created successfully.' })
            } 
            else 
            {
                if(errorArray.length > 0)
                {
                    let message = ''
                    if(dataList.length == errorArray.length)
                    {
                        message = `BinID: ${errorArray.toString()} Already in Queue List`
                    }
                    else
                    {
                        message = `BinID: ${errorArray.toString()} Already in Queue List and Other Bin Request added to Queue List`
                    }
                    await t.rollback(); // Rollback the transaction
                    res.status(202).json({ status: 0, message:  message});
                }
                else
                {
                    await t.rollback(); // Rollback the transaction
                    res.status(202).json({ status: 0, message: 'Failed to create Stock adjustments Bin Request' });
                }
            }
        }
        else
        {
            res.status(202).json({ status: 0, message: 'Failed to create Stock adjustments Bin Request. Currently Retrieval Process Pending' });
        }
    }
    catch (error)
    {
        await t.rollback(); // Rollback the transaction
        res.status(202).json({status: 0, message: error.message});
    }
}

const consolidationBinPageData = async (req, res) => {
    try 
    {
        const data = req.body;
        const result = await sequelize.query('EXEC SP_ConsolidateRetrieval @AisleID = :AisleID', {
            replacements: { 
                AisleID: data.AisleID ?? 1
            },
            Type: 'Show'
        });

        if(result)
        {
            const header = await tableHeader('ConsolidateBin')
            const stationData = await MasterStation.findAll({tableHint: TableHints.NOLOCK})
            res.status(200).json({status: 1, message: 'Consolidate Bin Data Get successfully... ', data: result[0], header, stationData: stationData });
        }
        else
        {
            res.status(202).json({status: 0, message: 'Consolidate Bin Data Failed...' });
        }
  
    } 
    catch (error) 
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

const consolidationBinRetrieval = async (req, res) => {
    try 
    {
        const dataList = req.body.data;
        let failureData = [];
        const createPromises = dataList.map(async (data) => {
            //check already in queue
            const retrievalPallet = await palletRequest.findAll({
                where: {
                    BinID: data.BinID,
                    Status: 'G'
                },
                tableHint: TableHints.NOLOCK
            })

            if(retrievalPallet.length > 0)
            {
                failureData.push(data.BinID)
                return { item: data, created: false }
            }
            else
            {
                data.ReqUser = req.user.UserName
                data.ReqType = 'REF'
                data.ReqTime = sequelize.literal('GETDATE()')
                data.Status = 'G'
                data.PickCategory = 'Refilling'
                data.CompletedTime = sequelize.literal('GETDATE()')
                let instert = await palletRequest.create(data)

                if(instert)
                {
                    return { item: data, created: true }
                }
                else
                {
                    failureData.push(data.BinID)
                    return { item: data, created: false }    
                }
            }
        })
        
        // Execute all promises concurrently
        const results = await Promise.all(createPromises);

        // Check the results for any failures
        const hasFailures = results.some(({ created }) => !created);
    
        // Respond based on whether there were any failures
        if ((!hasFailures) && (failureData.length == 0))
        {
            res.status(200).json({ TokenNo: req.headers['authenticatetoken'], status: 1, message: 'Consolidate Bin Retirval Request created successfully' });
        } 
        else 
        {
            if(failureData.length > 0)
            {
                let message = ''
                if(dataList.length == failureData.length)
                {
                    message = `BinID: ${failureData.toString()} Already in Queue List`
                }
                else
                {
                    message = `BinID: ${failureData.toString()} Already in Queue List and Other Bin Request added to Queue List`
                }
                res.status(202).json({ status: 0, message:  message});
            }
            else
            {
                res.status(202).json({ status: 0, message: 'Failed to create Consolidate Bin Retirval Request', data: failureData });
            } 
        }
    } 
    catch (error) 
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

const retrievalQueueMoveToPicking = async (req, res) => {
    try
    {
        const data = req.body
        let binCount = 0
        let retrivalData = await ERPRetrieval.findAll({where:{OrderNo: data.OrderNo, Status: 'G'}, tableHint: TableHints.NOLOCK})
        let binData = await  sequelize.query(`select MAX(BinID) as BinID from RetrievalConfirmation WITH (NOLOCK)`) 
    
        if(binData.length > 0)
        {
            if(parseFloat(binData[0][0].BinID) > 0)
            {
                binCount = parseFloat(binData[0][0].BinID)
            }
        }

        if(retrivalData.length > 0)
        {
            for(let i = 0; i < retrivalData.length; i++)
            {
                let dataList = {}
                dataList.ERPID = retrivalData[i].id
                dataList.ReqDateTime = sequelize.literal('GETDATE()')
                dataList.BinID = binCount + (i + 1)
                dataList.ItemCode = retrivalData[i].ItemCode
                dataList.ItemName = retrivalData[i].ItemName
                dataList.ItemGroup = retrivalData[i].ItemGroup ?? ''
                dataList.Category = ''
                dataList.UOM = ''
                dataList.Size = ''
                dataList.AvlQuantity = retrivalData[i].Quantity
                dataList.ReqQuantity = retrivalData[i].Quantity
                dataList.BalanceQuantity = 0
                dataList.Confirm = 0    
                dataList.Status = 'G'
                dataList.GTPPickingStation = 1
                dataList.CreatedDateTime = sequelize.literal('GETDATE()')
                dataList.UpdateDateTime = sequelize.literal('GETDATE()')
                dataList.PickedQuantity = 0
                dataList.Rejection_Reason = ''
                dataList.Reject = ''
                dataList.orderNo = retrivalData[i].OrderNo
                dataList.GTPReached = 1
                let retrievalconfirm = await RetrievalConfirmation.create(dataList)
                let update = await ERPRetrieval.update({Status:'P'}, {where: {OrderNo: retrivalData[i].OrderNo}})
            }
            res.status(200).json({ TokenNo: req.headers['authenticatetoken'], status: 1, message: 'Retrieval Queue Move to Picking Successfully' });
        }
        else
        {
            res.status(202).json({ TokenNo: req.headers['authenticatetoken'], status: 0, message: 'Given OrderNo Not Found' });
        }
    }
    catch(error)
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

const MoveToPreBinning = async (req, res) => {
    try
    {
        const data = req.body
        // Start a transaction
        await sequelize.transaction(async (transaction) => {
            // Check if bin details exist
            const binDetails = await BinComplete.findOne({ 
                where: {GRNNo: data.GRNNo, ItemCode: data.ItemCode},
                tableHint: TableHints.NOLOCK,
                transaction
            });

            if (!binDetails) {
                return res.status(202).json({
                    TokenNo: req.headers['authenticatetoken'],
                    status: 0,
                    message: 'Request BinID Not Found'
                });
            }

            // Delete bin details from BinComplete
            await BinComplete.destroy({
                where: {GRNNo: data.GRNNo, ItemCode: data.ItemCode},
                transaction
            });

            // Update PreBinning table
            await PreBinning.update(
                { GRNStatus: 'Pending', Binning_Qty: 0, GRNRemarks: '' },
                { where: {GRNNo: data.GRNNo, ItemCode: data.ItemCode}, transaction }
            );

            res.status(200).json({
                TokenNo: req.headers['authenticatetoken'],
                status: 1,
                message: 'Move To PreBinning Successfully'
            });
        });
    }
    catch(error)
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

const orderwiseBinSummary = async (req, res) => {
    try
    {
        const orderSummary = await RetrievalConfirmation.findAll({where: {Status: 'C'},limit:500, tableHint: TableHints.NOLOCK})

        if(orderSummary)
        {
            let header = await tableHeader('OrderwiseBinSummary')
            res.status(200).json({status: 1, message: 'Orderwise Bin Summary get successfully', data: orderSummary, header});
        }
        else
        {
            res.status(202).json({status: 0, message: 'Orderwise Bin Summary Not Found'});
        }
    }
    catch(error)
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

const binMoveConfirm = async (req, res) => {
    let ProcessStatus = 0
    let OrderComplete = false
    try {
        const data = req.body;
        const { UserName } = req.user;
        let QuantityFlag = false;
        const updatePromises = data.map(async (item) => {
            const pickDetails = await ERPRetrieval.findOne({
                where: { OrderNo: item.OrderNo, ItemCode: item.ItemCode },
                tableHint: TableHints.NOLOCK
            });
            
            const pickQty = pickDetails.dataValues?.PickingQty ?? 0;
            const OutQty = parseFloat(pickQty) + parseFloat(item.PickedQuantity);

            if (parseInt(pickDetails.dataValues.Quantity) >= parseInt(OutQty)) 
            {
                // Single call to get Inventory details if PickedQuantity > 0
                let invQty = 0;
                if (item.PickedQuantity > 0) 
                {
                    const invDetails = await sequelize.query(`
                        SELECT SUM(Quantity) AS CNT
                        FROM Inv_PalletDetails WITH (NOLOCK)
                        WHERE BinID = :BinID AND ItemCode = :ItemCode AND OutQuantity > 0`, {
                        replacements: { BinID: item.BinID, ItemCode: item.ItemCode }
                    });

                    invQty = invDetails[0][0].CNT ?? 0;

                    if (invQty > 0) 
                    {
                        // Updating Inventory
                        await sequelize.query(`
                        UPDATE Inv_PalletDetails 
                        SET 
                            Quantity = CASE 
                                WHEN (Quantity - :PickedQuantity) < 0 THEN 0 
                                ELSE (Quantity - :PickedQuantity) 
                            END,
                            OutQuantity = 0, 
                            WCSQuantity = 0,
                            OrderID = NULL
                        WHERE BinID = :BinID AND ItemCode = :ItemCode AND OutQuantity > 0`, 
                        {
                            replacements: { 
                                BinID: item.BinID, 
                                ItemCode: item.ItemCode, 
                                PickedQuantity: item.PickedQuantity 
                            }
                        });                        
                    }
                } 
                else 
                {
                    // If PickedQuantity is zero, just reset the OutQuantity
                    await sequelize.query(`
                        UPDATE Inv_PalletDetails 
                        SET OutQuantity = 0, 
                        WCSQuantity = 0,
                        OrderID = NULL
                        WHERE BinID = :BinID AND ItemCode = :ItemCode AND OutQuantity > 0`, {
                        replacements: { BinID: item.BinID, ItemCode: item.ItemCode }
                    });
                }
                ProcessStatus = 1
                if (item.OrderNo) 
                {
                    let Status = pickDetails.dataValues.Status;
                    if (parseInt(pickDetails.dataValues.Quantity) === parseInt(OutQty)) {
                        Status = 'C';
                    }

                    await ERPRetrieval.update(
                        { PickingQty: OutQty, Status, TrolleyNo: item.TrolleyNo, ConfirmRemark: item.confirmRemark, UpdatedDate: sequelize.literal('GETDATE()') },
                        {
                            where: { OrderNo: item.OrderNo, ItemCode: item.ItemCode },
                            returning: true
                        }
                    );
                }
                ProcessStatus = 2
                if((item.deleteFlag == true) && (item.PickedQuantity == invQty))
                {
                    const deleteQuery = await sequelize.query(`delete from Inv_PalletDetails where BinID = '${item.BinID}' and ItemCode='${item.ItemCode}' and Quantity=0`)
                }
                else if((item.deleteFlag == false) && (item.PickedQuantity == invQty))
                {
                    const deleteQuery = await sequelize.query(`delete from Inv_PalletDetails where BinID = '${item.BinID}' and ItemCode='${item.ItemCode}' and Quantity=0`)
                    let InvDetails = await storageData.findAll({where:{BinID: item.BinID}, tableHint: TableHints.NOLOCK})
                    if(InvDetails.length == 0)
                    {
                        const invList = {
                            BinID: item.BinID,
                            ItemCode: 'EMPTY',
                            ItemName: 'EMPTY',
                            ItemGroup: 'EMPTY',
                            InQuantity: 1,
                            Quantity: 0,
                            OutQuantity: 0,
                            UserName,
                            UpdatedDate: sequelize.literal('GETDATE()'),
                            PickType: 'EMPTY',
                            Category: 'C'
                        };
        
                        const InvCreated = await storageData.create(invList)
                    }
                }

                ProcessStatus = 3
                // Execute stored procedure for confirmation
                const result = await sequelize.query(`update RetrievalConfirmation set Confirm=1,Status='C',UpdateDateTime=GETDATE(), BinWaitTime = DATEDIFF(SECOND, BinReachedTime, GETDATE()), BinProcessingTime = DATEDIFF(SECOND, MLSCmdinitiatedTime, BinReachedTime) where  BinID ='${item.BinID}' and ItemCode='${item.ItemCode}' and ItemName='${item.ItemName}' and Confirm=0 and  Status='P'`)
                ProcessStatus = 4
                const resultDelete = await sequelize.query(`delete from PalletRequestDetails_ERP WHERE BINID='${item.BinID}' AND STATUS='C'`)
                ProcessStatus = 5

                if(item.confirmRemark == 'Quantity Mismatch')
                {
                    let MismatchData = await sequelize.query(`SELECT Count(Binid) as Count FROM INV_MismatchBinout WITH (NOLOCK) WHERE Binid = '${item.BinID}' AND flag = 1`)
                    if(MismatchData[0][0].Count == 0)
                    {
                        await sequelize.query(`INSERT INTO INV_MismatchBinout (Binid,OrerNo,flag,CreatedDatetime) 
                            VALUES (
                                '${item.BinID}',
                                '${item.OrderNo}',
                                1, 
                                GETDATE()
                            )
                        `)
                    }
                }

                if (result) 
                {
                    return { updated: true };
                } 
                else 
                {
                    return { updated: false };
                }
                
            } 
            else 
            {
                QuantityFlag = true;
                return { updated: false };
            }
        });

        //Execute all update promises in parallel
        const results = await Promise.all(updatePromises);
        const hasFailures = results.some(({ updated }) => !updated);

        const ERPDetails = await sequelize.query(`SELECT SUM(Quantity) AS CNT, SUM(PickingQty) AS PickingQty  FROM ERP_Retrieval WITH (NOLOCK) WHERE OrderNo = :OrderNo`, 
            {
                replacements: { OrderNo: data[0].OrderNo }
            }
        );

        if(parseInt(ERPDetails[0][0].CNT) == parseInt(ERPDetails[0][0].PickingQty))
        {
            OrderComplete = true
        }
        
        if (!hasFailures) 
        {
            if(parseInt(data[0].Floor) == 1)
            {
                const result1 = await sequelize.query('EXEC SP_RawConfirmation_New @Type = :Type, @BinID = :BinID, @Floor = :Floor, @GTPStation = :GTPStation', {
                    replacements: {
                        Type: "Confirm",
                        BinID: data[0].BinID,
                        Floor: data[0].Floor,
                        GTPStation: data[0].GTPPickingStation
                    }
                });
            }
    
            if(parseInt(data[0].Floor) == 2)
            {
                const result2 = await sequelize.query('EXEC SP_RawConfirmation_New2 @Type = :Type, @BinID = :BinID, @Floor = :Floor, @GTPStation = :GTPStation', {
                    replacements: {
                        Type: "Confirm",
                        BinID: data[0].BinID,
                        Floor: data[0].Floor,
                        GTPStation: data[0].GTPPickingStation
                    }
                });  
            }
    
            if(parseInt(data[0].Floor) == 3)
            {
                const result3 = await sequelize.query('EXEC SP_RawConfirmation_New3 @Type = :Type, @BinID = :BinID, @Floor = :Floor, @GTPStation = :GTPStation', {
                    replacements: {
                        Type: "Confirm",
                        BinID: data[0].BinID,
                        Floor: data[0].Floor,
                        GTPStation: data[0].GTPPickingStation
                    }
                });     
            }

            ProcessStatus = 0
            res.status(200).json({ status: 1, message: 'Bin Move Successful', data: data, ProcessStatus: ProcessStatus, OrderComplete: OrderComplete });
        } 
        else 
        {
            const message = QuantityFlag ? 'Failed to Bin Move. Picked Quantity is greater than Order Quantity': 'Failed to Bin Move';
            res.status(202).json({ status: 0, message,  data: data, ProcessStatus: ProcessStatus , OrderComplete: OrderComplete });
        }
    } 
    catch (error) 
    {
        console.log(error);
        res.status(202).json({ status: 0, message: 'Bin move failed. Please Retry', ProcessStatus: ProcessStatus, OrderComplete: OrderComplete, error:error.message  });
    }
};

const binMoveRetry = async (req, res) => {
    try 
    {
        const data = req.body;
        const { UserName } = req.user;        
        if(parseInt(data.Floor) == 1)
        {
            const result1 = await sequelize.query('EXEC SP_RawConfirmation_New @Type = :Type, @BinID = :BinID, @Floor = :Floor, @GTPStation = :GTPStation', {
                replacements: {
                    Type: "Confirm",
                    Floor: data.Floor,
                    GTPStation: data.GTPPickingStation
                }
            });
        }

        if(parseInt(data.Floor) == 2)
        {
            const result1 = await sequelize.query('EXEC SP_RawConfirmation_New2 @Type = :Type, @BinID = :BinID, @Floor = :Floor, @GTPStation = :GTPStation', {
                replacements: {
                    Type: "Confirm",
                    Floor: data.Floor,
                    GTPStation: data.GTPPickingStation
                }
            });    
        }

        if(parseInt(data.Floor) == 3)
        {
            const result1 = await sequelize.query('EXEC SP_RawConfirmation_New3 @Type = :Type, @BinID = :BinID, @Floor = :Floor, @GTPStation = :GTPStation', {
                replacements: {
                    Type: "Confirm",
                    Floor: data.Floor,
                    GTPStation: data.GTPPickingStation
                }
            });    
        }
        res.status(200).json({ status: 1, message: 'Bin Move Successful', ProcessStatus: 0 });
    } 
    catch (error) 
    {
        res.status(202).json({ status: 0, message: 'Bin move failed. Please Retry', ProcessStatus: 5 });
    }
};

const getBinRetrievalData = async (req, res) => {
    try {
        const { EquipmentNo, AisleId, Side, Level, Bay, BinId, require } = req.body;

        const result = await sequelize.query('EXEC SP_PalletWiseRetrieval @Side = :Side, @Level = :Level, @Bay = :Bay, @ReqEquipmentNo = :ReqEquipmentNo, @aisleNo = :aisleNo, @Require = :Require, @BinID = :BinId', {
            replacements: {
                Side: Side,
                Level: Level,
                Bay: Bay,
                ReqEquipmentNo: EquipmentNo,
                aisleNo: AisleId,
                Require: require,
                BinId: BinId
            },
            logging: console.log,
        });

        const header = await tableHeader('BinWiseRetrieval');
        res.status(200).json({status: 1, message: 'Bin Retrieval Successfully', header: header, data: result[0]});
    } catch (error) {
        res.status(202).json({status: 0, message: error.message});
    }
}


const unloadBin = async (req, res) => {
    try {
        const { Floor, Station, RetrievePalletsEmpty } = req.body;
        const user = 'admin';  
        const mode = 'Palletwise';  

        // Build the UDT rows dynamically
        const udtEmptyRows = RetrievePalletsEmpty.map((row) => {
            return `('${row.BinID}', ${row.Side}, ${row.Level}, ${row.Bay}, ${row.Deep})`;
        }).join(',');

        // Construct the SQL query
        const query = `
            DECLARE @UDT_Empty UDT_PalletRetrieval_new;

            INSERT INTO @UDT_Empty (BinID, Side, Level, Bay, Deep)
            VALUES ${udtEmptyRows};

            EXEC [dbo].[SP_PalletWiseRetrieval]  
                @mode = :mode,
                @floorlevel = :floorlevel,
                @GTPStationlevel = :GTPStationlevel,
                @UDT_Empty = @UDT_Empty,
                @user = :user
        `;

        // Execute the query using Sequelize
        const result = await sequelize.query(query, {
            replacements: { 
                mode,
                floorlevel: parseInt(Floor),
                GTPStationlevel: parseInt(Station),
                user,
            },
            type: sequelize.QueryTypes.RAW,
        });

        // Respond with success
        res.status(200).json({
            status: 1,
            message: 'Bin Retrieval Process Completed',
            data: result[0],
        });
    } catch (error) {
        // Respond with error
        res.status(500).json({ 
            status: 0, 
            message: error.message 
        });
    }
};


const getOrderApproval = async (req, res) => {
    try {
        // const { fromDate, toDate } = req.body;
        // const today = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss'); 
        // let startDate = fromDate
        //     ? moment(fromDate).startOf('day').format('YYYY-MM-DD HH:mm:ss')
        //     : moment(today).startOf('day').format('YYYY-MM-DD HH:mm:ss');
    
        // let endDate = toDate
        //     ? moment(toDate).endOf('day').format('YYYY-MM-DD HH:mm:ss')
        //     : today;

        let tableName = `ERP_Retrieval`; 

        // where ((CreatedTime BETWEEN '${startDate}' AND '${endDate}') or (CreatedTime IS NULL))`
        const result = await sequelize.query(`select * from ${tableName} WITH (NOLOCK) where ReqType != 'Manual'`);
        const header = await tableHeader('OrderApproval');
        res.status(200).send({ status: 1, data: result[0], header });
    } catch (error) {
        res.status(202).send({ status: 0, message: error.message });
    }
};

// const getRetrievalOrderData = async (req, res) => {
//     try 
//     {
//         const fromDate = req.body.fromDate
//         const toDate = req.body.toDate
//         let {OrderNo, Floor, Station,Status,isOrderConfirm,isTrolleyConfirm} = req.body
//         let startDate = moment(fromDate).startOf('day').format('YYYY-MM-DD HH:mm:ss')
//         let endDate = moment(toDate).endOf('day').format('YYYY-MM-DD HH:mm:ss')
//         let Query = `SELECT TOP 500
//             OrderNo,
//             MIN(CreatedDate) AS OrderDate,
//             MIN(Floor) AS Floor, 
//             MIN(Station) AS Station,
//             SUM(Quantity) AS SumOfOrderQuantity,
//             SUM(PickingQty) AS SumOfPickingQuantity,
//             MIN(CreatedDate) AS StartDate,
//             MAX(UpdatedDate) AS EndDate,
//             MAX(OrderCompletedTime) AS OrderCompletedTime,
//             CONVERT(varchar, DATEADD(SECOND, DATEDIFF(SECOND, MIN(CreatedDate), MAX(UpdatedDate)), 0), 108) AS TimeDiff,
//             CASE
//                 WHEN MIN(isOrderConfirm) = 'N' THEN 'No'
//                 ELSE 'Yes'
//             END AS isOrderConfirm,
//             CASE
//                 WHEN MIN(isTrolleyConfirm) = 'N' THEN 'No'
//                 ELSE 'Yes'
//             END AS isTrolleyConfirm,
//             CASE 
// 				WHEN SUM(CASE WHEN Status = 'MH' THEN 1 ELSE 0 END) > 0 THEN 'MH'
// 				WHEN SUM(CASE WHEN Status = 'AH' THEN 1 ELSE 0 END) > 0 THEN 'AH'
// 				WHEN SUM(CASE WHEN Status IN ('P', 'E') THEN 1 ELSE 0 END) > 0 THEN 
// 					(CASE WHEN SUM(CASE WHEN Status = 'E' THEN 1 ELSE 0 END) > 0 THEN 'E' ELSE 'P' END)
// 				WHEN SUM(CASE WHEN Status = 'M' THEN 1 ELSE 0 END) > 0 THEN 'M'
// 				ELSE MIN(Status) 
// 			END AS Status
//         FROM
//             ERP_Retrieval WITH (NOLOCK)
//         WHERE
//             ItemCode != 'EMPTY'
//             AND CreatedDate >= '${startDate}'
//             AND CreatedDate <= '${endDate}'`

//         if(OrderNo != '')
//         {
//             Query +=`AND OrderNo LIKE '%${OrderNo}%'`
//         }

//         if(Floor != '')
//         {
//             Query +=`AND Floor LIKE '%${Floor}%'`
//         }
        
//         if(Station != '')
//         {
//             Query +=`AND Station LIKE '%${Station}%'`
//         }

//         if(Status != '')
//         {
//             Query +=`AND Status = '${Status}'`
//         }

//         if(isOrderConfirm != '')
//         {
//             Query +=`AND isOrderConfirm LIKE '%${isOrderConfirm}%'`
//         }

//         if(isTrolleyConfirm != '')
//         {
//             Query +=`AND isTrolleyConfirm LIKE '%${isTrolleyConfirm}%'`
//         }

//         Query +=`GROUP BY
//             OrderNo
//             ORDER BY 
//             OrderDate DESC;`
//         const result = await sequelize.query(Query)

//         let header = await tableHeader('RetrievalOrder');
                
//         res.status(200).send({ status: 1, header, data: result[0]});
//     } 
//     catch (error) 
//     {
//         res.status(202).send({ status: 0, message: error.message });
//     }
// }
const getRetrievalOrderData = async (req, res) => {
    try {
        const {
            fromDate,
            toDate,
            OrderNo = '',
            Floor = '',
            Station = '',
            Status = '',
            isOrderConfirm = '',
            isTrolleyConfirm = ''
        } = req.body;

        const startDate = moment(fromDate).startOf('day').format('YYYY-MM-DD HH:mm:ss');
        const endDate = moment(toDate).endOf('day').format('YYYY-MM-DD HH:mm:ss');

        // Initialize query with base
        let query = `
            SELECT TOP 500
                OrderNo,
                MIN(CreatedDate) AS OrderDate,
                MIN(Floor) AS Floor, 
                MIN(Station) AS Station,
                SUM(Quantity) AS SumOfOrderQuantity,
                SUM(PickingQty) AS SumOfPickingQuantity,
                MIN(CreatedDate) AS StartDate,
                MAX(UpdatedDate) AS EndDate,
                MAX(OrderCompletedTime) AS OrderCompletedTime,
                CONVERT(varchar, DATEADD(SECOND, DATEDIFF(SECOND, MIN(CreatedDate), MAX(UpdatedDate)), 0), 108) AS TimeDiff,
                CASE WHEN MIN(isOrderConfirm) = 'N' THEN 'No' ELSE 'Yes' END AS isOrderConfirm,
                CASE WHEN MIN(isTrolleyConfirm) = 'N' THEN 'No' ELSE 'Yes' END AS isTrolleyConfirm,
                CASE 
                    WHEN SUM(CASE WHEN Status = 'MH' THEN 1 ELSE 0 END) > 0 THEN 'MH'
                    WHEN SUM(CASE WHEN Status = 'AH' THEN 1 ELSE 0 END) > 0 THEN 'AH'
                    WHEN SUM(CASE WHEN Status IN ('P', 'E') THEN 1 ELSE 0 END) > 0 
                        THEN CASE WHEN SUM(CASE WHEN Status = 'E' THEN 1 ELSE 0 END) > 0 THEN 'E' ELSE 'P' END
                    WHEN SUM(CASE WHEN Status = 'M' THEN 1 ELSE 0 END) > 0 THEN 'M'
                    ELSE MIN(Status) 
                END AS Status
            FROM ERP_Retrieval WITH (NOLOCK)
            WHERE ItemCode != 'EMPTY'
            AND CreatedDate BETWEEN '${startDate}' AND '${endDate}'
        `;

        // Track filters
        const filters = [];

        if (OrderNo) filters.push(`OrderNo LIKE '%${OrderNo}%'`);
        if (Floor) filters.push(`Floor LIKE '%${Floor}%'`);
        if (Station) filters.push(`Station LIKE '%${Station}%'`);
        if (Status) filters.push(`Status = '${Status}'`);
        if (isOrderConfirm) filters.push(`isOrderConfirm LIKE '%${isOrderConfirm}%'`);
        if (isTrolleyConfirm) filters.push(`isTrolleyConfirm LIKE '%${isTrolleyConfirm}%'`);

        // If all filters are empty, enforce isOrderConfirm != 'Y'
        const allFiltersEmpty = !OrderNo && !Floor && !Station && !Status && !isOrderConfirm && !isTrolleyConfirm;
        if (allFiltersEmpty) {
            filters.push(`isOrderConfirm != 'Y'`);
        }

        // Append filters to query
        if (filters.length > 0) {
            query += ' AND ' + filters.join(' AND ');
        }

        query += `
            GROUP BY OrderNo
            ORDER BY OrderDate DESC;
        `;
        const result = await sequelize.query(query);
        const totalCount = await sequelize.query(`SELECT COUNT(DISTINCT OrderNo) AS Count FROM ERP_Retrieval WITH (NOLOCK) WHERE ItemCode != 'EMPTY' 
                            AND CreatedDate BETWEEN '${startDate}' AND '${endDate}'`);

        const header = await tableHeader('RetrievalOrder');

        res.status(200).send({ status: 1, header, data: result[0], totalCount: totalCount[0][0].Count });

    } catch (error) {
        res.status(202).send({ status: 0, message: error.message });
    }
};

const getRetrievalOrderDetails = async (req, res) => {
    try 
    {
        let data = req.body
        let orderDetails =  await ERPRetrieval.findAll({where: {OrderNo: data.orderNo}, tableHint: TableHints.NOLOCK})
        if(orderDetails)
        {
            res.status(200).send({ status: 1, data: orderDetails});
        }
        else
        {
            res.status(202).send({ status: 0, message: 'Failed to get Order Details' });
        }
    } 
    catch (error) 
    {
        res.status(202).send({ status: 0, message: error.message });
    }
}

const retrievalOrderStart = async (req, res) => {
    try 
    {
        let data = req.body
        let updateOrderDetails =  await ERPRetrieval.update({Status:'MHR'}, {where: {OrderNo: data.orderNo, Status: 'MH'}})
        if(updateOrderDetails)
        {
            res.status(200).send({ status: 1, data: updateOrderDetails});
        }
        else
        {
            res.status(202).send({ status: 0, message: 'Failed to get Order Details' });
        }
    } 
    catch (error) 
    {
        res.status(202).send({ status: 0, message: error.message });
    }
}

const orderReExecute = async (req, res) => {
    try 
    {
        let data = req.body
        // Using Promise.all to run queries concurrently
        let [palletRequestDetails, palletRequestERPDetails, retrievalConfirm] = await Promise.all([
            sequelize.query(`SELECT BinID,Status,OrderID,AisleNo,ShuttleID FROM PalletRequestDetails WITH (NOLOCK) WHERE OrderID = '${data.orderNo}' AND Status IN('G','P','W')`),
            sequelize.query(`SELECT BinID,Status,OrderID,AisleNo,ShuttleID FROM PalletRequestDetails_ERP WITH (NOLOCK) WHERE OrderID = '${data.orderNo}' AND Status IN('G','P','W')`),
            sequelize.query(`SELECT BinID,Status,OrderNo FROM RetrievalConfirmation WITH (NOLOCK) WHERE OrderNo = '${data.orderNo}' AND Status IN('G','P','W')`)
        ]);
        
        if (palletRequestDetails[0].length > 0 || palletRequestERPDetails[0].length > 0 || retrievalConfirm[0].length > 0)
        {
            res.status(202).send({ status: 0, message: 'Order Already Processing' });
            return
        }
        
        // Fetch all relevant order details
        let updateOrderDetails = await ERPRetrieval.findAll({ where: { OrderNo: data.orderNo, status: { [Op.not]: ['C','E'] } }, tableHint: TableHints.NOLOCK });
        
        const detailPromises = updateOrderDetails.map(async (orderData) => {
            let order = { ...orderData.dataValues };
            
            let UnAssign = parseInt(order.Quantity) - parseInt(order?.PickingQty ?? 0)
            let updateOrderDetails = await ERPRetrieval.update({Status:'M', UnAssignedQuantity: UnAssign}, {where: {id: order.id}})
            if (updateOrderDetails) {
                return { updated: true };
            }
            else
            {
                return { updated: false };
            }
        })
        const results = await Promise.all(detailPromises);
        const hasFailures = results.flat().some(({ updated }) => !updated);
        if (hasFailures) 
        {
            await t.rollback();
            return res.status(202).json({ status: 0, message: 'Failed to update ReExecute' });
        }
        else
        {
            res.status(200).send({ status: 1, message: 'ReExecute updated successfully.'});
        }
    } 
    catch (error) 
    {
        res.status(202).send({ status: 0, message: error.message });
    }
}

const retrievalOrderHold = async (req, res) => {
    try 
    {
        let data = req.body
        let updateOrderDetails =  await ERPRetrieval.update({Status:'MH'}, {where: {OrderNo: data.orderNo, Status: { [Op.in]: ["G", "P", "M"] }}})
        let palletRequestDetails =  await sequelize.query(`update PalletRequestDetails_ERP set Status = 'MH' where OrderID = '${data.orderNo}' and Status = 'G'`);
        let StationUpdate = await sequelize.query(`update Master_Station_Conveyor set StationAssigned = 0, OrderNo = NULL where OrderNo = '${data.orderNo}'`);  
        
        if(updateOrderDetails)
        {
            res.status(200).send({ status: 1, data: updateOrderDetails});
        }
        else
        {
            res.status(202).send({ status: 0, message: 'Failed to get Order Details' });
        }
    } 
    catch (error) 
    {
        res.status(202).send({ status: 0, message: error.message });
    }
}

const RetrievalOrderDetails = async (req, res) => {
    try {
        const { orderNo } = req.body;
 
        let updateOrderDetails = await ERPRetrieval.findAll({ where: { OrderNo: orderNo }, tableHint: TableHints.NOLOCK });
 
        if (updateOrderDetails.length === 0) {
            return res.status(200).send({ status: 1, data: [] });
        }
 
        let binIDs = updateOrderDetails
            .map(order => order.BinID)
            .filter(binID => binID)
            .join(',')
            .split(',')
            .map(id => `'${id}'`)
            .join(',');
 
         
 
        if (!binIDs || binIDs.trim() === "") {
            return res.status(200).send({ status: 1, data: updateOrderDetails });
        }
 
        let [palletRequestDetails, palletRequestERPDetails, liftRequestDetails, retrievalConfirm] = await Promise.all([
            sequelize.query(`SELECT BinID,Status,OrderID,AisleNo,ShuttleID FROM PalletRequestDetails WITH (NOLOCK) WHERE OrderID = '${orderNo}' AND BinID IN (${binIDs}) AND Status NOT IN('C','E')`),
            sequelize.query(`SELECT BinID,Status,OrderID,AisleNo,ShuttleID FROM PalletRequestDetails_ERP WITH (NOLOCK) WHERE OrderID = '${orderNo}' AND BinID IN (${binIDs}) AND Status NOT IN ('C','E')`),
            sequelize.query(`SELECT BinID,Status FROM Kep_LiftRequestDetails WITH (NOLOCK) WHERE BinID IN (${binIDs}) AND ReqType = 'PIC' ORDER BY ReqTime DESC`),
            sequelize.query(`SELECT BinID,Status,OrderNo FROM RetrievalConfirmation WITH (NOLOCK) WHERE OrderNo = '${orderNo}' AND BinID IN (${binIDs})`)
        ]);
 
        let orderList = [];
 
        for (const orderData of updateOrderDetails) {
            let order = { ...orderData.dataValues };
            let binIDArray = order.BinID?.split(',') || [];
            order.alarmStatus = 'No Alarm';
 
            if (!binIDArray.length || binIDArray[0] === '') {
                order.ProcessStatus = order.Remark ||'Bin not Assigned';
                orderList.push(order);
                continue;
            }
 
            let palletRequest = palletRequestDetails[0].filter(p => binIDArray.includes(p.BinID));
            let palletRequestERP = palletRequestERPDetails[0].filter(p => binIDArray.includes(p.BinID));
            let liftRequest = liftRequestDetails[0].filter(l => binIDArray.includes(l.BinID));
            let retrieval = retrievalConfirm[0].filter(r => binIDArray.includes(r.BinID));

            if (palletRequestERP.length > 0) {
                order.ProcessStatus = `Bin Assigned in AisleNo ${palletRequestERP[0].AisleNo} / MLS ${palletRequestERP[0].ShuttleID}`;
            }
 
            if (palletRequest.length > 0) {
                const { Status, AisleNo, ShuttleID } = palletRequest[0];
 
                const alarmQuery = `
                    SELECT AlarmText FROM AlarmHistory_MLS WITH (NOLOCK) WHERE CAST(AlarmDateTime AS DATE) = CAST(GETDATE() AS DATE)
                      AND AisleNo = '${AisleNo}' AND EquipmentNo = '${ShuttleID}' AND AlarmAckTime IS NULL AND IsReset = 0
                `;
                const alarmResult = await sequelize.query(alarmQuery, { type: sequelize.QueryTypes.SELECT });
 
                order.alarmStatus = alarmResult.length ? alarmResult[0].AlarmText : 'No Alarm';
 
                if (Status === 'G') {
                    order.ProcessStatus = `Bin Requesting in AisleNo ${AisleNo}/MLS ${ShuttleID}`;
                } else if (Status === 'P') {
                    order.ProcessStatus = `Bin Processing in AisleNo ${AisleNo}/MLS ${ShuttleID}`;
                } else if (Status === 'AH') {
                    order.ProcessStatus = `Bin Auto Hold in AisleNo ${AisleNo}/MLS ${ShuttleID}`;
                } else {
                    order.ProcessStatus = `Bin Requesting in AisleNo ${AisleNo}/MLS ${ShuttleID}`;
                }
            }
 
            if (liftRequest.length > 0) {
               
                const liftStatus = liftRequest[0].Status;
                if (liftStatus === 'P') {
                    order.ProcessStatus = `Bin Processing in Lift`;
                } else if (liftStatus === 'G') {
                    order.ProcessStatus = `Bin Requesting in Lift`;
                }
            }
 
            if (retrieval.length > 0) {
                const retrievalStatus = retrieval[0].Status;
                if (retrievalStatus === 'P') {
                    order.ProcessStatus = 'Bin Present In GTPStation';
                } else if (retrievalStatus === 'G' || retrievalStatus === 'W') {
                    order.ProcessStatus = 'Bin Present In Conveyor / Buffer';  
                } else if (retrievalStatus === 'C') {
                    order.ProcessStatus = 'Process Completed';
                }
            }
 
            orderList.push(order);
        }
 
        res.status(200).send({ status: 1, data: orderList });
    } catch (error) {
        console.error(error);
        res.status(202).send({ status: 0, message: error.message });
    }
};

const getPickingOrderBinDetails = async (req, res) => {
    try {
        let data = req.body;
        const Floor = parseInt(data.Floor);
        let Station = parseInt(data.Station.replace('ST', ''));

        const result = await sequelize.query(`EXEC GetPickingScreenData @Floor = :Floor,@Station= :Station,@BinID= :BinID`,
            {
                replacements: {
                    Floor: Floor,
                    Station: Station,
                    BinID: data.BinID
                },
                Type: 'Show'
            }
        );
        let resData = result[0]   
        const responseData = {
            orderList: JSON.parse(resData[0].orderdetails),
            binList: JSON.parse(resData[0].binList),
            remarks: JSON.parse(resData[0].reason),
            totalBinCount: resData[0].TotalBinCount,
            totalOrderQty: resData[0].TotalOrderQty,
            totalPickingQty: resData[0].TotalPickingQty,
            CompleteBinCount: resData[0].CompleteBinCount,
            BinQtyCount: resData[0].BinQtyCount
        };
        res.status(200).send({ status: 1, responseData });
    } 
    catch (error) 
    {
        res.status(202).send({ status: 0, message: error.message });
    }
};

const binWisePreBinningReject = async (req, res) => {
    try {
        let preBinData = await BinComplete.findAll({where: {BinningStatus: 'Pending'}, tableHint: TableHints.NOLOCK});
 
        let binGroups = preBinData.reduce((acc, item) => {
            let { BinID, BinningStatus, ItemCode, Quantity, ...rest } = item.dataValues;
            let qty = parseInt(Quantity, 10) || 0;
 
            if (!acc[BinID]) {
                acc[BinID] = { BinID, ItemCode: [], Quantity: 0, allPending: true, ...rest };
            }
 
            acc[BinID].ItemCode.push(ItemCode);
            acc[BinID].Quantity += qty;
 
            if (BinningStatus !== 'Pending') {
                acc[BinID].allPending = false;
            }
 
            return acc;
        }, {});
 
        let filteredData = Object.values(binGroups)
            .filter(bin => bin.allPending)
            .map(({ id, CreatedDate, CreatedBy, UpdatedDate, UpdatedBy, isDelete, ItemStatus, scannedItem, allPending, ...rest }) => rest);
 
        let header = await tableHeader('PreBinningBinwisePending');
        res.status(200).send({ status: 1, message: 'Binwise PreBinning Data', data: filteredData, header: header });
    } catch (error) {
        res.status(202).send({ status: 0, message: error.message });
    }
};
 
 
const getPreBinningRejectData = async (req, res) => {
    const dataList = req.body;
 
    try {
        for (const { GRNNo, BinID } of dataList) {
            const binItems = await BinComplete.findAll({
                where: { GRNNo, BinID },
                tableHint: TableHints.NOLOCK
            });
 
            if (binItems.length === 0) continue;
 
            const updatePromises = [];
            const deletePromises = [];
 
            for (const { ItemCode, Quantity: binQty } of binItems) {
                const preBinEntry = await PreBinning.findOne({
                    where: { GRNNo, ItemCode },
                    tableHint: TableHints.NOLOCK
                });
 
                if (preBinEntry) {
                    const updatedQty = Math.max(preBinEntry.Binning_Qty - binQty, 0);
 
                    updatePromises.push(
                        PreBinning.update(
                            { Binning_Qty: updatedQty },
                            { where: { GRNNo, ItemCode } }
                        )
                    );
                }
 
                deletePromises.push(
                    BinComplete.destroy({
                        where: { GRNNo, BinID, ItemCode }
                    })
                );
            }
 
            await Promise.all([...updatePromises, ...deletePromises]);
        }
 
        return res.status(200).send({
            status: 1,
            message: 'PreBinning data updated and BinComplete entries deleted for all rows'
        });
 
    } catch (error) {
        return res.status(202).send({ status: 0, message: error.message });
    }
};

const getRetrieveReAssign = async (req, res) => {
    try {
        let { type} = req.body;
 
        let query = `EXEC KEP_SP_ReassignMLS_Display @type = :Type, @Orderno = :orderNo`;
        let replacements = {
            Type: type || 'Fetch',
            orderNo: req.body.orderNo || ''
        };

        const result = await sequelize.query(query, {
            replacements: replacements,
            type: sequelize.QueryTypes.SELECT  // Ensure the correct type is used
        });

        const header = await tableHeader('ReassignMLS');

        if(type == 'Confirm')
        {
            res.status(200).send({ status: 1, data:result[0][''], header });
        }
        else
        {
            res.status(200).send({ status: 1, data:result, header });
        }
        
        
    }
    catch (error)
    {
        res.status(202).send({ status: 0, message: error.message });
    }
};

const getPickingOrderDetails = async (req, res) => {
    try {
        const data = req.body;
        let orderData = await sequelize.query(`SELECT DISTINCT orderNo FROM ERP_Retrieval WITH (NOLOCK) WHERE Floor ='${data.Floor}' and Station ='${data.Station}' and Status in('P','MH','AH','S')`)
        let orderNo = orderData[0][0].orderNo;
        let updateOrderDetails = await ERPRetrieval.findAll({ where: { OrderNo: orderNo }, tableHint: TableHints.NOLOCK });
 
        if (updateOrderDetails.length === 0) {
            return res.status(200).send({ status: 1, data: [] });
        }
 
        let binIDs = updateOrderDetails
            .map(order => order.BinID)
            .filter(binID => binID)
            .join(',')
            .split(',')
            .map(id => `'${id}'`)
            .join(',');
 
         
 
        if (!binIDs || binIDs.trim() === "") {
            return res.status(200).send({ status: 1, data: updateOrderDetails });
        }
 
        let [palletRequestDetails, palletRequestERPDetails, liftRequestDetails, retrievalConfirm] = await Promise.all([
            sequelize.query(`SELECT BinID,Status,OrderID,AisleNo,ShuttleID FROM PalletRequestDetails WITH (NOLOCK) WHERE OrderID = '${orderNo}' AND BinID IN (${binIDs}) AND Status NOT IN('C','E')`),
            sequelize.query(`SELECT BinID,Status,OrderID,AisleNo,ShuttleID FROM PalletRequestDetails_ERP WITH (NOLOCK) WHERE OrderID = '${orderNo}' AND BinID IN (${binIDs}) AND Status NOT IN ('C','E')`),
            sequelize.query(`SELECT BinID,Status FROM Kep_LiftRequestDetails WITH (NOLOCK) WHERE BinID IN (${binIDs}) AND ReqType = 'PIC' ORDER BY ReqTime DESC`),
            sequelize.query(`SELECT BinID,Status,OrderNo FROM RetrievalConfirmation WITH (NOLOCK) WHERE OrderNo = '${orderNo}' AND BinID IN (${binIDs})`)
        ]);
 
        let orderList = [];
 
        for (const orderData of updateOrderDetails) {
            let order = { ...orderData.dataValues };
            let binIDArray = order.BinID?.split(',') || [];
            order.alarmStatus = 'No Alarm';
 
            if (!binIDArray.length || binIDArray[0] === '') {
                order.ProcessStatus = order.Remark ||'Bin not Assigned';
                orderList.push(order);
                continue;
            }
 
            let palletRequest = palletRequestDetails[0].filter(p => binIDArray.includes(p.BinID));
            let palletRequestERP = palletRequestERPDetails[0].filter(p => binIDArray.includes(p.BinID));
            let liftRequest = liftRequestDetails[0].filter(l => binIDArray.includes(l.BinID));
            let retrieval = retrievalConfirm[0].filter(r => binIDArray.includes(r.BinID));

            if (palletRequestERP.length > 0) {
                order.ProcessStatus = `Bin Assigned in AisleNo ${palletRequestERP[0].AisleNo} / MLS ${palletRequestERP[0].ShuttleID}`;
            }
 
            if (palletRequest.length > 0) {
                const { Status, AisleNo, ShuttleID } = palletRequest[0];
 
                const alarmQuery = `
                    SELECT AlarmText FROM AlarmHistory_MLS WITH (NOLOCK) WHERE CAST(AlarmDateTime AS DATE) = CAST(GETDATE() AS DATE)
                      AND AisleNo = '${AisleNo}' AND EquipmentNo = '${ShuttleID}' AND AlarmAckTime IS NULL AND IsReset = 0
                `;
                const alarmResult = await sequelize.query(alarmQuery, { type: sequelize.QueryTypes.SELECT });
 
                order.alarmStatus = alarmResult.length ? alarmResult[0].AlarmText : 'No Alarm';
 
                if (Status === 'G') {
                    order.ProcessStatus = `Bin Requesting in AisleNo ${AisleNo}/MLS ${ShuttleID}`;
                } else if (Status === 'P') {
                    order.ProcessStatus = `Bin Processing in AisleNo ${AisleNo}/MLS ${ShuttleID}`;
                } else if (Status === 'AH') {
                    order.ProcessStatus = `Bin Auto Hold in AisleNo ${AisleNo}/MLS ${ShuttleID}`;
                } else {
                    order.ProcessStatus = `Bin Requesting in AisleNo ${AisleNo}/MLS ${ShuttleID}`;
                }
            }
 
            if (liftRequest.length > 0) {
               
                const liftStatus = liftRequest[0].Status;
                if (liftStatus === 'P') {
                    order.ProcessStatus = `Bin Processing in Lift`;
                } else if (liftStatus === 'G') {
                    order.ProcessStatus = `Bin Requesting in Lift`;
                }
            }
 
            if (retrieval.length > 0) {
                const retrievalStatus = retrieval[0].Status;
                if (retrievalStatus === 'P') {
                    order.ProcessStatus = 'Bin Present In GTPStation';
                } else if (retrievalStatus === 'G' || retrievalStatus === 'W') {
                    order.ProcessStatus = 'Bin Present In Conveyor / Buffer';  
                } else if (retrievalStatus === 'C') {
                    order.ProcessStatus = 'Process Completed';
                }
            }
 
            orderList.push(order);
        }
        res.status(200).send({ status: 1, data: orderList });
    } catch (error) {
        console.error(error);
        res.status(202).send({ status: 0, message: error.message });
    }
};

module.exports = {
    storageUploadData,
    getStorageDetailsData,
    palletRequestPageData,
    addPalletNewItem,
    palletRequestList,
    retrievalPageData,
    relocationFromSideData,
    relocationToSideData,
    palletRelocate,
    PreBinningApprove,
    PreBinApproveStatus,
    getERPRetrievalData,
    addPalletRequest,
    EmptyBinStore,
    pickingRequestID,
    pickingApproval,
    tvDisplay,
    ScheduleQueueRequest, 
    updateScheduleQueueList,   
    stockAdjustmentList,
    stockAdjustmentUpdate,
    EmptyBinPageData,
    getEmptyBinCount,
    emptyBinRequest,
    updateRetriveQueueList,
    consolidationBinPageData,
    consolidationBinRetrieval,
    stockAdjustmentBinRequest,
    retrievalQueueMoveToPicking,
    MoveToPreBinning,
    orderwiseBinSummary,
    binMoveConfirm,
    getBinRetrievalData,
    unloadBin,
    getOrderApproval,
    getRetrievalOrderData,
    getRetrievalOrderDetails,
    retrievalOrderStart,
    retrievalOrderHold,
    RetrievalOrderDetails,
    binMoveRetry,
    getPickingOrderBinDetails,
    orderReExecute,
    getPreBinningRejectData,
    binWisePreBinningReject,
    getRetrieveReAssign,
    getPickingOrderDetails
}
