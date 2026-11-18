const { Op, and } = require('sequelize');
const { sequelize } = require('../config/database');
const PreBinning = require('../models/ERP_API/PreBinning')
const MasterPart = require('../models/master/MasterPart')
const BinComplete = require('../models/HHT/binComplete');
const MasterBin = require('../models/master/MasterBin');
const storageData = require('../models/operation/storageDetails')
const MasterReason = require('../models/master/MasterReason');
const MasterHHTDevice = require('../models/HHT/deviceRights');
const { TableHints } = require('sequelize');

const getPendingGRN = async(req,res) =>{
    try 
    {
        // Fetch distinct GRN NO where status is 'Pending'
        const distinctGRNNos = await PreBinning.findAll({
            attributes: [
                [sequelize.fn('DISTINCT', sequelize.col('GRNNo')), 'GRNNo']
            ],
            where: {
                GRNStatus: 'Pending'
            },
            tableHint: TableHints.NOLOCK
        });

        const remarks = await MasterReason.findAll({
            attributes: ['ReasonID','ReasonDescription'],
            tableHint: TableHints.NOLOCK
        })
        
        // Extract the GRN_NO values from the result
        const grnNos = distinctGRNNos.map(item => item.GRNNo); 
        if (grnNos) 
        {                        
            res.status(200).json({status: 1, message: 'Pending GRN Data Get successfully... ', data: grnNos, remarks: remarks })
        } 
        else 
        {
            res.status(200).json({status: 1, message: 'Currently No Pending GRN', data: grnNos })
        }
    } 
    catch (error) 
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

// const getGRNDetails = async(req,res) =>{
//     try 
//     {
//         // Fetch distinct GRN NO where status is 'Pending'
//         let GRNDetails = ''
//         if(req.body.GRNNo == 'All')
//         {
//             GRNDetails = await PreBinning.findAll({limit: 500});
//         }
//         else
//         {
//             GRNDetails = await PreBinning.findAll({
//                 where: {
//                     GRNNo: req.body.GRNNo
//                 },
//                 limit: 500
//             })
//         }
                
//         let GRNList = []
//         for(let i = 0; i < GRNDetails.length; i++)
//         {
//             let list = GRNDetails[i].dataValues
//             let itemData =  await MasterPart.findOne({where:{ItemCode: GRNDetails[i].ItemCode}})
//             if(itemData.dataValues)
//             {
//                 list['itemGroup'] = itemData.dataValues.ItemGroup
//                 list['BinCapacity'] = itemData.dataValues.BinCapacity
//                 list['Color'] = itemData.dataValues.Color
//             }
//             GRNList.push(list)
//         }

//         if (GRNList) 
//         {                        
//             res.status(200).json({status: 1, message: 'GRN Data Get successfully... ', data: GRNList })
//         } 
//         else 
//         {
//             res.status(200).json({status: 1, message: 'GRN Not Founded', data: GRNList })
//         }
//     } 
//     catch (error) 
//     {
//         res.status(202).json({status: 0, message: error.message});
//     }
// }

const getGRNDetails = async (req, res) => {
    try {
        const { GRNNo, FilterGRNNo, ItemCode, BinID } = req.body;

        const where = {};
        // Add GRNNo filter only if it's not 'All'
        if (GRNNo && GRNNo !== 'All') {
            where.GRNNo = GRNNo;
        }
        
        // Add LIKE conditions only if the values are provided
        if (FilterGRNNo) {
            where.GRNNo = { [Op.like]: `%${FilterGRNNo}%` };
        }
        if (ItemCode) {
            where.ItemCode = { [Op.like]: `%${ItemCode}%` };
        }
        if (BinID) {
            where.BinID = { [Op.like]: `%${BinID}%` };
        }

        const grnDetails = await PreBinning.findAll({ where: where, limit: 300, tableHint: TableHints.NOLOCK });

        if (!grnDetails.length) {
            return res.status(200).json({ status: 1, message: 'GRN Not Found', data: [] });
        }

        // Fetch related MasterPart data in parallel
        const grnList = await Promise.all(grnDetails.map(async (grn) => {
            const grnData = grn.dataValues;
            const itemData = await MasterPart.findOne({ where: { ItemCode: grn.ItemCode }, tableHint: TableHints.NOLOCK });

            if (itemData?.dataValues) {
                grnData.itemGroup = itemData.ItemGroup;
                grnData.BinCapacity = itemData.BinCapacity;
                grnData.Color = itemData.Color;
            }

            return grnData;
        }));

        return res.status(200).json({
            status: 1,
            message: 'GRN Data fetched successfully.',
            data: grnList,
        });

    } catch (error) {
        return res.status(500).json({ status: 0, message: error.message });
    }
};

const binComplete = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        let failures = [];
        let completed = [];
        const dataList = req.body.data;

        // Verify BinMaster for all items in dataList first
        const binIDs = [...new Set(dataList.map(data => data.BinID))];
        const validBins = await MasterBin.findAll({
            where: { BinID: binIDs, BinStatus: 1, isDelete: 0 },
            transaction: t,
            tableHint: TableHints.NOLOCK
        });

        if (validBins.length !== binIDs.length) {
            const invalidBinIDs = binIDs.filter(binID => !validBins.some(bin => bin.BinID === binID));
            return res.status(400).json({ status: 'error', message: `Invalid Bin IDs: ${invalidBinIDs.join(', ')}` });
        }

        // Fetch GRN Details in bulk
        const grnCriteria = dataList.map(data => ({ GRNNo: data.GRNNo, ItemCode: data.ItemCode }));
        const GRNDetails = await PreBinning.findAll({
            where: {
                [Op.or]: grnCriteria
            },
            transaction: t,
            tableHint: TableHints.NOLOCK
        });

        const GRNMap = GRNDetails.reduce((acc, grn) => {
            acc[`${grn.GRNNo}_${grn.ItemCode}`] = grn;
            return acc;
        }, {});

        const createPromises = dataList.map(async (data) => {
            try {
                const GRNDetail = GRNMap[`${data.GRNNo}_${data.ItemCode}`];

                if (!GRNDetail) 
                {
                    failures.push({ GRNNo: data.GRNNo, ItemCode: data.ItemCode, BinID: data.BinID });
                    return;
                }

                const selectBinData = await BinComplete.findOne({
                    where: {
                        BinID: data.BinID,
                        GRNNo: data.GRNNo,
                        ItemCode: data.ItemCode
                    },
                    transaction: t,
                    tableHint: TableHints.NOLOCK
                });

                //let binOldQty = selectBinData ? selectBinData.Quantity : 0;
                let updateQty = parseInt(GRNDetail.Binning_Qty || 0) + parseInt(data.Quantity) //+ parseInt(binOldQty);
                if(parseInt(GRNDetail.Quantity) >= parseInt(updateQty))
                {           
                    if (!selectBinData) 
                    {
                        data.CreatedBy = req.user.UserName
                        data.GRNType = GRNDetail.Type
                        data.DocNo = GRNDetail.DocNo
                        data.scannedItem = JSON.stringify(data.scannedItem)
                        await BinComplete.create(data, { transaction: t });
                    } 
                    else 
                    {
                        data.UpdatedBy = req.user.UserName;
                        data.GRNType = GRNDetail.Type;
                        data.DocNo = GRNDetail.DocNo;
                        data.UpdatedDate = sequelize.literal('GETDATE()');
    
                        await BinComplete.update(
                            { Quantity: data.Quantity, UpdatedBy: data.UpdatedBy, UpdatedDate: data.UpdatedDate },
                            {
                                where: { BinID: data.BinID, GRNNo: data.GRNNo, ItemCode: data.ItemCode },
                                transaction: t
                            }
                        );                        
                    }
                    completed.push(data);
                }
                // else
                // {
                //     failures.push({ GRNNo: data.GRNNo, ItemCode: data.ItemCode, BinID: data.BinID });
                // }

            } catch (error) {
                failures.push({ GRNNo: data.GRNNo, ItemCode: data.ItemCode, BinID: data.BinID });
            }
        });

        await Promise.all(createPromises);
        if (failures.length === 0) {
            await t.commit();
            //Update Binning_Qty
            dataList.map(async (data) => {
                let BinDetails = await sequelize.query(`select SUM(Quantity) as CNT from T_BIN_COMPLETE WITH (NOLOCK) where GRNNo = '${data.GRNNo}' and ItemCode = '${data.ItemCode}'`)
                let BinningQty = BinDetails[0][0].CNT ?? 0
                await PreBinning.update(
                    { Binning_Qty: BinningQty },
                    {
                        where: { GRNNo: data.GRNNo, ItemCode: data.ItemCode }
                    }
                );
            })
            return res.status(200).json({ TokenNo: req.headers['authenticatetoken'], Status: 1, Reason: 'Binning created successfully' });
        }
        else
        {
            await t.rollback();
            return res.status(202).json({ status: 0, message: 'Failed to create Binning', data: failures });
        }
    } 
    catch (error)
    {
        await t.rollback();
        res.status(202).json({ status: 0, message: error.message });
    }
};

const getGRNStatus = async(req,res) =>{
    try 
    {
        // Fetch distinct GRN NO where status is 'Pending'
        const GRNDetails = await PreBinning.findAll({
            where: {
                GRNStatus: {
                    [Op.not]: 'Complete'
                }
            },
            tableHint: TableHints.NOLOCK
        });
        
        let dataDetails = []
        if(GRNDetails)
        {
            GRNDetails.forEach(GRNData =>{
                let dataList = GRNData.dataValues
                let index = dataDetails.findIndex(item => item.GRNNo === dataList.GRNNo)

                if(index < 0)
                {
                    let list = {}
                    list.GRNNo = dataList.GRNNo
                    list.item = []
                    list.item.push(dataList.ItemCode)
                    list.itemStatus = []
                    list.itemStatus.push(dataList.GRNStatus)
                    list.GRNStatus = dataList.GRNStatus
                    list.reqQty = parseFloat(dataList.Quantity) 
                    list.binnedQty = parseFloat(dataList.Binning_Qty) 
                    dataDetails.push(list)
                }
                else
                {
                    dataDetails[index].itemStatus.push(dataList.GRNStatus)
                    dataDetails[index].item.push(dataList.ItemCode)
                    dataDetails[index].reqQty += parseFloat(dataList.Quantity) 
                    dataDetails[index].binnedQty += parseFloat(dataList.Binning_Qty) 
                    let filterData = dataDetails[index].itemStatus.filter(row => row === 'Completed')
                    if(filterData.length == dataDetails[index].item.length)
                    {
                        dataDetails[index].GRNStatus = 'Completed'
                    }
                    else if(filterData.length > 0)
                    {
                        dataDetails[index].GRNStatus = 'InProgress'
                    }
                    else
                    {
                        dataDetails[index].GRNStatus = 'Pending'
                    }
                }  
            })   
        }

        if (GRNDetails) 
        {                        
            res.status(200).json({status: 1, message: 'GRN Data Get successfully... ', data: dataDetails })
        } 
        else 
        {
            res.status(200).json({status: 1, message: 'Currently No GRN', data: dataDetails })
        }
    } 
    catch (error) 
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

const completeItem = async(req,res) =>{
    try 
    {
        const data = req.body.data;
        // const item = data[0]
        try 
        {
            // Fetch distinct GRN NO where status is 'Pending'
            const GRNDetails = await PreBinning.findOne({
                where: {
                    GRNNo: data.GRNNo,
                    ItemCode: data.ItemCode
                },
                tableHint: TableHints.NOLOCK
            });       
    
            if(GRNDetails)
            {
                const updateItem = await PreBinning.update({GRNStatus:'Completed', GRNRemarks: data.remarks}, {
                    where: { GRNNo: data.GRNNo, ItemCode: data.ItemCode}, 
                    returning: true
                })

                const insertedRow = await BinComplete.update({ItemStatus:'Completed'}, {
                    where: { GRNNo: data.GRNNo, ItemCode: data.ItemCode}, 
                    returning: true
                });

                if (insertedRow) 
                {
                    res.status(202).json({ TokenNo: req.headers['authenticatetoken'], Status: 1, message: 'Complete GRN Item successfully' });
                } 
                else 
                {
                    res.status(202).json({ status: 0, message: 'Failed to Complete GRN Item', data: data });
                }   
            }
            else 
            {
                res.status(202).json({ status: 0, message: 'Failed to Complete GRN Item', data: data });
            }
        } 
        catch (error) 
        {
            res.status(202).json({ status: 0, message: error.message, data: data });
        }        
    } 
    catch (error) 
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

const getBinDetails = async(req,res) =>{
    try 
    {
        const data = req.body;
        try 
        {
            const validBins = await MasterBin.findOne({
                where: { BinID: data.BinID, BinStatus: 1, isDelete: 0 },
                tableHint: TableHints.NOLOCK
            });

            const validTBins = await BinComplete.findOne({
                where: { BinID: data.BinID, BinningStatus: 'Pending' },
                tableHint: TableHints.NOLOCK
            }) ?? []

            const storageDetails = await storageData.findAll({where:{BinID: data.BinID},tableHint: TableHints.NOLOCK})
            
            if(validBins)
            {
                if(validTBins.length == 0)
                {
                    if(storageDetails.length > 0)
                    {
                        res.status(202).json({status: 0, message: 'This BinID already In Inventory', data: [] })
                    }
                    else
                    {
                        const BinDetails = await BinComplete.findAll({
                            where: {
                                BinID: data.BinID,
                                BinningStatus: 'Pending'
                            },
                            tableHint: TableHints.NOLOCK
                        });
                        
                        if(BinDetails)
                        {                        
                            res.status(200).json({status: 1, message: 'Bin Data Get successfully... ', data: BinDetails })
                        }
                        else
                        {
                            res.status(200).json({status: 1, message: 'Currently No Bin', data: [] })
                        }
                    }
                }
                else
                {
                    res.status(202).json({status: 0, message: 'Entered Bin ID Already Completed', data: [] })
                }
            }
            else
            {
                res.status(202).json({status: 0, message: 'Entered Bin ID is not Found in Bin Master, Create Bin ID in Bin Master', data: [] })
            }
        } 
        catch (error) 
        {
            res.status(202).json({ status: 0, message: error.message, data: data });
        }        
    } 
    catch (error) 
    {
        res.status(202).json({status: 0, message: error.message});
    }
}


const giveDeviceRights = async (req, res) => {
    try {
        const data = req.body;

        const device = await MasterHHTDevice.findOne({ where: { deviceId: data.deviceId }, tableHint: TableHints.NOLOCK });
        if (device) {
            await MasterHHTDevice.update({ Rights: data.Rights,UpdatedBy: data.currentUser}, { where: { deviceId: data.deviceId } });
            res.status(200).json({ status: 1, message: 'Device rights updated successfully' });
        } else {
            res.status(404).json({ status: 0, message: 'Device not found' });
        }
    } catch (error) {
        res.status(500).json({ status: 0, message: error.message });
    }
};

const getDevices = async (req, res) => {
    try {
        const devices = await MasterHHTDevice.findAll({tableHint: TableHints.NOLOCK});
        res.status(200).json({ status: 1, data: devices });
    } catch (error) {
        res.status(500).json({ status: 0, message: error.message });
    }
};
 
const getBinDetailsForRefilling = async (req, res) => {
    try {        
        const data = req.body;
        const storageDetails = await storageData.findAll({where:{BinID: data.BinID}, tableHint: TableHints.NOLOCK})
        res.status(200).json({ status: 1, data: storageDetails });
    } catch (error) {
        res.status(500).json({ status: 0, message: error.message });
    }
};

// const updateRefilledBin = async (req, res) => {
//     try {
//         const { dataArr, BinID: binID } = req.body;
 
//         const itemCodes = dataArr.map(item => item.ItemCode);
 
//         const [existingItems, masterParts] = await Promise.all([
//             storageData.findAll({ where: { BinID: binID }, attributes: ['ItemCode', 'Quantity'] }),
//             MasterPart.findAll({ where: { ItemCode: itemCodes } })
//         ]);
 
//         const existingItemsMap = new Map(existingItems.map(item => [item.ItemCode, item.Quantity]));
//         const masterPartsMap = new Map(masterParts.map(part => [part.ItemCode, part]));
 
//         const updatePromises = [];
//         const insertItems = [];
//         const errors = [];
 
//         for (let item of dataArr) 
//         {
//             if (existingItemsMap.has(item.ItemCode)) 
//             {
//                 updatePromises.push(
//                     storageData.update(
//                         { Quantity: item.Quantity },
//                         { where: { BinID: binID, ItemCode: item.ItemCode } }
//                     )
//                 );
//             } 
//             else 
//             {
//                 const masterPart = masterPartsMap.get(item.ItemCode);
//                 if (masterPart) {
//                     insertItems.push({
//                         ...item,
//                         ...masterPart.get(),
//                         InQuantity: 0,
//                         OutQuantity: 0,
//                         BinID: binID,
//                         PickType: 'Re-fill'
//                     });
//                 } else {
//                     errors.push({ ItemCode: item.ItemCode, message: 'ItemCode not found in Item Master' });
//                 }
//             }
//         }

//         await Promise.all(updatePromises);
//         if (insertItems.length) await storageData.bulkCreate(insertItems);
 
//         if (errors.length) {
//             return res.status(202).json({ status: 0, message: 'Some items were not found in Item Master', errors });
//         }
 
//         res.status(200).json({ status: 1, message: 'Bin Refilled Successfully' });
//     } catch (error) {
//         res.status(500).json({ status: 0, message: error.message });
//     }
// };
const updateRefilledBin = async (req, res) => {
    try {
        const { dataArr, BinID: binID } = req.body;

        if (!Array.isArray(dataArr) || !binID) {
            return res.status(400).json({ status: 0, message: 'Invalid input format.' });
        }

        const itemCodes = dataArr.map(item => item.ItemCode);

        const [existingItems, masterParts] = await Promise.all([
            storageData.findAll({
                where: { BinID: binID },
                attributes: ['ItemCode', 'Quantity'],
                tableHint: TableHints.NOLOCK
            }),
            MasterPart.findAll({
                where: { ItemCode: itemCodes },
                tableHint: TableHints.NOLOCK
            })
        ]);

        const existingItemsMap = new Map(existingItems.map(item => [item.ItemCode, item.Quantity]));
        const masterPartsMap = new Map(masterParts.map(part => [part.ItemCode, part]));

        const updatePromises = [];
        const insertItems = [];
        const errors = [];

        for (const item of dataArr) {
            const { ItemCode, Quantity } = item;

            if (!ItemCode || Quantity == null) {
                errors.push({ ItemCode, message: 'Missing required fields' });
                continue;
            }

            if (existingItemsMap.has(ItemCode)) {
                updatePromises.push(
                    storageData.update(
                        { Quantity },
                        { where: { BinID: binID, ItemCode } }
                    )
                );
            } else {
                const masterPart = masterPartsMap.get(ItemCode);
                if (masterPart) {
                    insertItems.push({
                        ItemCode,
                        ItemName: masterPart.ItemName,
                        ItemGroup: masterPart.ItemGroup,
                        Category: masterPart.Category,
                        Color: masterPart.Color,
                        Size: masterPart.Size,
                        Style: masterPart.Style,
                        Quantity,
                        BinID: binID,
                        InQuantity: 0,
                        OutQuantity: 0,
                        PickType: 'Re-fill',
                        Description: masterPart.Description || null,
                        UOM: masterPart.UOM || null,
                        // Add other required fields from masterPart here if needed
                    });
                } else {
                    errors.push({ ItemCode, message: 'ItemCode not found in Item Master' });
                }
            }

            await sequelize.query(`
                DELETE FROM Inv_PalletDetails 
                WHERE BinID = :BinID AND ItemCode = :ItemCode AND Quantity = 0`, {
                replacements: { BinID: binID, ItemCode: ItemCode }
            });
        }

        await Promise.all(updatePromises);

        if (insertItems.length) {
            try {
                await storageData.bulkCreate(insertItems, { validate: true });
            } catch (bulkError) {
                console.error('BulkCreate failed:', bulkError);
                return res.status(500).json({
                    status: 0,
                    message: 'Bulk insert failed.',
                    error: bulkError.message
                });
            }
        }

        if (errors.length) {
            return res.status(202).json({
                status: 0,
                message: 'Some items were not processed correctly.',
                errors
            });
        }

        return res.status(200).json({ status: 1, message: 'Bin Refilled Successfully' });

    } catch (error) {
        console.error('Server Error:', error);
        return res.status(500).json({ status: 0, message: 'Server error.', error: error.message });
    }
};

const updateStock = async (req, res) => {
    try {
        const { dataArr, BinID: binID } = req.body;
  
        const itemCodes = dataArr.map(item => item.ItemCode);
 
        const [existingItems, masterParts] = await Promise.all([
            storageData.findAll({ where: { BinID: binID }, attributes: ['ItemCode', 'Quantity'], tableHint: TableHints.NOLOCK }),
            MasterPart.findAll({ where: { ItemCode: itemCodes }, tableHint: TableHints.NOLOCK })
        ]);
 
        const existingItemsMap = new Map(existingItems.map(item => [item.ItemCode, item.Quantity]));
        const masterPartsMap = new Map(masterParts.map(part => [part.ItemCode, part]));
 
        const updatePromises = [];
        const insertItems = [];
        const deletePromises = [];
        const errors = [];
 
        for (let item of dataArr) {
            if (existingItemsMap.has(item.ItemCode)) {
                if (item.ScannedQty === 0) {
                    deletePromises.push(
                        storageData.destroy({
                            where: { BinID: binID, ItemCode: item.ItemCode }
                        })
                    );
                } else {
                    updatePromises.push(
                        storageData.update(
                            { Quantity: item.ScannedQty, OutQuantity: 0, UpdatedDate: sequelize.literal('GETDATE()'), UserName: req.user.UserName  },
                            { where: { BinID: binID, ItemCode: item.ItemCode } }
                        )
                    );
                }
            } else {
                const masterPart = masterPartsMap.get(item.ItemCode);
                if (masterPart) {
                    insertItems.push({
                        ...item,
                        ...masterPart.get(),
                        InQuantity: 0,
                        OutQuantity: 0,
                        Quantity: item.ScannedQty,
                        BinID: binID,
                        PickType: 'HHT-StockAdjustment',
                        UpdatedDate: sequelize.literal('GETDATE()'),
                        UserName: req.user.UserName
                    });
                } else {
                    errors.push({ ItemCode: item.ItemCode, message: `ItemCode not found in Item Master ${item.ItemCode}` });
                }
            }
        }
 
        await Promise.all(updatePromises);
        await Promise.all(deletePromises);
        if (insertItems.length) {
            try 
            {
                await storageData.bulkCreate(insertItems);
            } 
            catch (error) 
            {
                return res.status(400).json({ status: 0, message: 'Failed to insert items', error: error.message });
            }
        }

 
        if (errors.length) {
            return res.status(202).json({ status: 0, message: `Some items were not found in Item Master ${JSON.stringify(errors.map(err => (err.ItemCode)))}`, errors });
        }
 
        res.status(200).json({ status: 1, message: 'Stock Updated Successfully' });
    } catch (error) {
        res.status(500).json({ status: 0, message: error.message });
    }
};

module.exports = {
    getPendingGRN,
    getGRNDetails,
    binComplete,
    getGRNStatus,
    completeItem,
    getBinDetails,
    giveDeviceRights,
    getDevices,
    getBinDetailsForRefilling,
    updateRefilledBin,
    updateStock
}