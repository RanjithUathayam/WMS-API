const User = require('../models/ERP_API/login')
const ItemMaster = require('../models/ERP_API/itemMaster')
const BinMaster = require('../models/ERP_API/BinMaster')
const PreBinning = require('../models/ERP_API/PreBinning')
const Retrieval = require('../models/ERP_API/BinRetrieval')
const stockAdjust = require('../models/ERP_API/StockAdjustment')
const schedule = require('../models/ERP_API/BinSchedule')
const nightShuffle = require('../models/ERP_API/NightShuffle')
const { Op, and } = require('sequelize');
const { sequelize, sequelize2 } = require('../config/database');
let jwt = require('jsonwebtoken');
const MasterPart = require('../models/master/MasterPart')
const axios = require('axios');
const ERPAPIURL = 'http://10.0.210.8:91/' //'http://192.168.0.11:89/'
const CustomerAPILog = require('../models/Customer_api_logs')
const ERPRetrieval = require('../models/ERP_API/BinRetrieval')
const moment = require('moment');
const { TableHints } = require('sequelize');

const processERPPreBinningData = async (dataList, userName) => {
    const seen = new Map();
    const data = [];
    const duplicateData = [];

    for (const itemData of dataList) {
        const key = `${itemData.GRNNo}-${itemData.ItemCode}`;
        if (seen.has(key)) {
            duplicateData.push({ GRNNo: itemData.GRNNo, ItemCode: itemData.ItemCode });
        } else {
            data.push(itemData);
            seen.set(key, true);
        }
    }

    let failures = [...duplicateData];

    const createPromises = data.map(async (itemData) => {
        const itemDetails = await MasterPart.findOne({
            where: { ItemCode: itemData.ItemCode },
            tableHint: TableHints.NOLOCK
        });

        if (!itemDetails) {
            failures.push({ GRNNo: itemData.GRNNo, ItemCode: itemData.ItemCode });
            return { created: false };
        }

        itemData.ItemName = itemDetails.dataValues.ItemName;
        itemData.ItemGroup = itemDetails.dataValues.ItemGroup;

        const existingItem = await PreBinning.findOne({
            where: { GRNNo: itemData.GRNNo, ItemCode: itemData.ItemCode },
            tableHint: TableHints.NOLOCK
        });

        if (existingItem) {
            failures.push({ GRNNo: itemData.GRNNo, ItemCode: itemData.ItemCode });
            return { created: false };
        }

        itemData.CreatedBy = userName;
        await PreBinning.create(itemData);
        return { created: true };
    });

    const results = await Promise.all(createPromises);
    const hasFailures = results.some(({ created }) => !created);

    if ((!hasFailures) && (failures.length === 0)) {
        return { status: 1, Reason: 'PreBinning created successfully', data: [] };
    }

    return { status: 0, message: 'Failed to create PreBinning', data: failures };
};

/* Master */
//Login Data
const ERPLoginVerify = async(req,res) =>{
    const { username, password} = req.body;
    try 
    {
        //User verification
        const user = await User.findOne({ where: { 'UserName':username, 'Password':password }, tableHint: TableHints.NOLOCK });

        if (!user) 
        {
            return res.status(202).json({status: 0, AuthenticationID:"", message: 'Invalid username and password' });
        }
        
        // Generate JWT token
        const token = jwt.sign({ userId: user.id }, 'CAL-WMS', { expiresIn: '24h' });
  
        res.status(200).json({ status: 1, AuthenticationID:token, Reason:"Authentication Success"});
    } 
    catch (error) {
        res.status(202).json({status: 0, AuthenticationID:"", Reason:"Authentication Failure", message: error.message });
    }
}

// Create a new ERP ItemMaster
const createERPItemMaster = async (req, res) => {
    try 
    {
        const dataList  = req.body.data;  

        //check duplicate 
        const seen = new Map();
        const data = [];
        const duplicateData = [];
        for (const itemData of dataList) 
        {
            const { ItemCode } = itemData;

            if (seen.has(ItemCode)) 
            {
                duplicateData.push({ItemCode: itemData.ItemCode});
            } 
            else 
            {
                data.push(itemData);
                seen.set(ItemCode, true);
            }
        }
        
        if(req.body.ProcessType == 'addItemMaster')
        {                
            let failures = duplicateData
            let completed = []
            // Array to store promises for creating new items
            const createPromises = data.map(async (itemData) => {
                try 
                {
                    itemData.CreatedBy = req.user.UserName;
                    // Check if the item already exists
                    const existingItem = await ItemMaster.findOne({ where: { ItemCode: itemData.ItemCode }, tableHint: TableHints.NOLOCK });
                    if (existingItem) 
                    {
                        // Item already exists, do not create
                        failures.push({ ItemCode: itemData.ItemCode })
                        return { item: existingItem, created: false };
                    } 
                    else 
                    {
                        // Item does not exist, create it
                        const newItem = await ItemMaster.create(itemData);
                        completed.push(newItem)
                        return { item: newItem, created: true };
                    }
                } 
                catch (error) 
                {
                    // Handle errors in finding or creating items
                    throw error;
                }
            });

            // Execute all promises concurrently
            const results = await Promise.all(createPromises);

            // Check the results for any failures
            const hasFailures = results.some(({ created }) => !created);

            // Respond based on whether there were any failures
            if ((!hasFailures) && (failures.length == 0))
            {
                res.status(202).json({ TokenNo: req.headers['authenticatetoken'], Status: 1, Reason: 'ItemMaster created successfully' });
            } 
            else 
            {
                res.status(202).json({ status: 0, message: 'Failed to create ItemMaster', data: failures });
            }   
        }
        else if(req.body.ProcessType == 'updateItemMaster')
        {
            let failures = duplicateData
            let completed = []
            // Array to store promises for creating new items
            const createPromises = data.map(async (itemData) => {
                try 
                {
                    // Check if the item already exists
                    const existingItem = await ItemMaster.findOne({ where: { ItemCode: itemData.ItemCode }, tableHint: TableHints.NOLOCK });
                    if (existingItem) 
                    {
                        itemData.UpdatedBy = req.user.UserName;
                        itemData.UpdatedDate = sequelize.literal('GETDATE()');
                        // Item exist, update it
                        const newItem = await ItemMaster.update(itemData, {where: { ItemCode: itemData.ItemCode}, returning: true,});
                        completed.push(newItem)
                        return { item: newItem, created: true };
                    } 
                    else 
                    {
                        // New Item, do not update
                        failures.push({ ItemCode: itemData.ItemCode })
                        return { item: existingItem, created: false };
                    }
                } 
                catch (error) 
                {
                    throw error;
                }
            });

            // Execute all promises concurrently
            const results = await Promise.all(createPromises);

            // Check the results for any failures
            const hasFailures = results.some(({ created }) => !created);

            // Respond based on whether there were any failures
            if ((!hasFailures) && (failures.length == 0))
            {
                res.status(202).json({ TokenNo: req.headers['authenticatetoken'], Status: 1, Reason: 'ItemMaster update successfully' });
            } 
            else 
            {
                res.status(202).json({ status: 0, message: 'Failed to update ItemMaster', data: failures });
            }
        }
        else if(req.body.ProcessType == 'deleteItemMaster')
        {
            let failures = duplicateData
            let completed = []
            // Array to store promises for creating new items
            const createPromises = data.map(async (itemData) => {
                try 
                {
                    // Check if the item already exists
                    const existingItem = await ItemMaster.findOne({ where: { ItemCode: itemData.ItemCode }, tableHint: TableHints.NOLOCK });
                    if (existingItem) 
                    {
                        itemData.DeletedBy =  req.user.UserName;
                        itemData.DeletedDate = sequelize.literal('GETDATE()');
                        itemData.isDelete = 1
                        itemData.UpdatedBy = req.user.UserName;
                        itemData.UpdatedDate = sequelize.literal('GETDATE()');

                        // Item exist, update it
                        const newItem = await ItemMaster.update(itemData, {where: { ItemCode: itemData.ItemCode}, returning: true,});
                        completed.push(newItem)
                        return { item: newItem, created: true };
                    } 
                    else 
                    {
                        // New Item, do not update
                        failures.push({ ItemCode: itemData.ItemCode })
                        return { item: existingItem, created: false };
                    }
                } 
                catch (error) 
                {
                    throw error;
                }
            });

            // Execute all promises concurrently
            const results = await Promise.all(createPromises);

            // Check the results for any failures
            const hasFailures = results.some(({ created }) => !created);

            // Respond based on whether there were any failures
            if ((!hasFailures) && (failures.length == 0))
            {
                res.status(202).json({ TokenNo: req.headers['authenticatetoken'], Status: 1, Reason: 'ItemMaster deleted successfully' });
            } 
            else 
            {
                res.status(202).json({ status: 0, message: 'Failed to deleted ItemMaster', data: failures });
            }
        }
        else if(req.body.ProcessType == 'activateItemMaster')
        {
            let failures = duplicateData
            let completed = []
            // Array to store promises for creating new items
            const createPromises = data.map(async (itemData) => {
                try 
                {
                    // Check if the item already exists
                    const existingItem = await ItemMaster.findOne({ where: { ItemCode: itemData.ItemCode }, tableHint: TableHints.NOLOCK });
                    if (existingItem) 
                    {
                        itemData.ActivatedDate = sequelize.literal('GETDATE()');
                        itemData.ActivatedBy = req.user.UserName;
                        itemData.isActive = 'Y'
                        itemData.isDelete = 0
                        itemData.UpdatedBy = req.user.UserName;
                        itemData.UpdatedDate = sequelize.literal('GETDATE()');

                        // Item exist, update it
                        const newItem = await ItemMaster.update(itemData, {where: { ItemCode: itemData.ItemCode}, returning: true,});
                        completed.push(newItem)
                        return { item: newItem, created: true };
                    } 
                    else 
                    {
                        // New Item, do not update
                        failures.push({ ItemCode: itemData.ItemCode })
                        return { item: existingItem, created: false };
                    }
                } 
                catch (error) 
                {
                    throw error;
                }
            });

            // Execute all promises concurrently
            const results = await Promise.all(createPromises);

            // Check the results for any failures
            const hasFailures = results.some(({ created }) => !created);

            // Respond based on whether there were any failures
            if ((!hasFailures) && (failures.length == 0))
            {
                res.status(202).json({ TokenNo: req.headers['authenticatetoken'], Status: 1, Reason: 'ItemMaster deleted successfully' });
            } 
            else 
            {
                res.status(202).json({ status: 0, message: 'Failed to deleted ItemMaster', data: failures });
            }
        }
    } 
    catch (error) 
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

//Create ERP Bin Master
const createERPBinMaster = async (req, res) => {
    try 
    {
        const dataList  = req.body.data;  

        //check duplicate 
        const seen = new Map();
        const data = [];
        const duplicateData = [];
        for (const itemData of dataList) 
        {
            const { BinID } = itemData;

            if (seen.has(BinID)) 
            {
                duplicateData.push({ BinID: itemData.BinID });
            } 
            else 
            {
                data.push(itemData);
                seen.set(BinID, true);
            }
        }
        
        if(req.body.ProcessType == 'addBinMaster')
        {                
            let failures = duplicateData
            let completed = []
            const createPromises = data.map(async (itemData) => {
                try 
                {
                    itemData.CreatedBy = req.user.UserName;
                    // Check if the item already exists
                    const existingItem = await BinMaster.findOne({ where: { BinID: itemData.BinID }, tableHint: TableHints.NOLOCK });
                    if (existingItem) 
                    {
                        // Item already exists, do not create
                        failures.push({ BinID: itemData.BinID })
                        return { item: existingItem, created: false };
                    } 
                    else 
                    {
                        // Item does not exist, create it
                        const newItem = await BinMaster.create(itemData);
                        completed.push(newItem)
                        return { item: newItem, created: true };
                    }
                } 
                catch (error) 
                {
                    throw error;
                }
            });

            const results = await Promise.all(createPromises);
            const hasFailures = results.some(({ created }) => !created);

            if ((!hasFailures) && (failures.length == 0))
            {
                res.status(202).json({ TokenNo: req.headers['authenticatetoken'], Status: 1, Reason: 'BinMaster created successfully' });
            } 
            else 
            {
                res.status(202).json({ status: 0, message: 'Failed to create BinMaster', data: failures });
            }   
        }
        else if(req.body.ProcessType == 'updateBinMaster')
        {
            let failures = duplicateData
            let completed = []

            const createPromises = data.map(async (itemData) => {
                try 
                {
                    // Check if the item already exists
                    const existingItem = await BinMaster.findOne({ where: { BinID: itemData.BinID }, tableHint: TableHints.NOLOCK });
                    if (existingItem) 
                    {
                        itemData.UpdatedBy = req.user.UserName;
                        itemData.UpdatedDate = sequelize.literal('GETDATE()');;
                        // Item exist, update it
                        const newItem = await BinMaster.update(itemData, {where: { BinID: itemData.BinID}, returning: true,});
                        completed.push(newItem)
                        return { item: newItem, created: true };
                    } 
                    else 
                    {
                        failures.push({ BinID: itemData.BinID })
                        return { item: existingItem, created: false };
                    }
                } 
                catch (error) 
                {
                    throw error;
                }
            });

            const results = await Promise.all(createPromises);

            const hasFailures = results.some(({ created }) => !created);

            if ((!hasFailures) && (failures.length == 0))
            {
                res.status(202).json({ TokenNo: req.headers['authenticatetoken'], Status: 1, Reason: 'BinMaster update successfully' });
            } 
            else 
            {
                res.status(202).json({ status: 0, message: 'Failed to update BinMaster', data: failures });
            }
        }
        else if(req.body.ProcessType == 'deleteBinMaster')
        {
            let failures = duplicateData
            let completed = []
            // Array to store promises for creating new items
            const createPromises = data.map(async (itemData) => {
                try 
                {
                    // Check if the item already exists
                    const existingItem = await BinMaster.findOne({ where: { BinID: itemData.BinID }, tableHint: TableHints.NOLOCK });
                    if (existingItem) 
                    {
                        itemData.DeletedBy =  req.user.UserName;
                        itemData.DeletedDate = sequelize.literal('GETDATE()');
                        itemData.isDelete = 1
                        itemData.UpdatedBy = req.user.UserName;
                        itemData.UpdatedDate = sequelize.literal('GETDATE()');

                        // Item exist, update it
                        const newItem = await BinMaster.update(itemData, {where: { BinID: itemData.BinID}, returning: true,});
                        completed.push(newItem)
                        return { item: newItem, created: true };
                    } 
                    else 
                    {
                        // New Item, do not update
                        failures.push({ BinID: itemData.BinID })
                        return { item: existingItem, created: false };
                    }
                } 
                catch (error) 
                {
                    throw error;
                }
            });

            // Execute all promises concurrently
            const results = await Promise.all(createPromises);

            // Check the results for any failures
            const hasFailures = results.some(({ created }) => !created);

            // Respond based on whether there were any failures
            if ((!hasFailures) && (failures.length == 0))
            {
                res.status(202).json({ TokenNo: req.headers['authenticatetoken'], Status: 1, Reason: 'BinMaster deleted successfully' });
            } 
            else 
            {
                res.status(202).json({ status: 0, message: 'Failed to deleted BinMaster', data: failures });
            }
        }
        else if(req.body.ProcessType == 'activateItemMaster')
        {
            let failures = duplicateData
            let completed = []
            // Array to store promises for creating new items
            const createPromises = data.map(async (itemData) => {
                try 
                {
                    // Check if the item already exists
                    const existingItem = await BinMaster.findOne({ where: { BinID: itemData.BinID }, tableHint: TableHints.NOLOCK });
                    if (existingItem) 
                    {
                        itemData.ActivatedDate = sequelize.literal('GETDATE()');
                        itemData.ActivatedBy = req.user.UserName;
                        itemData.isActive = 'Y'
                        itemData.isDelete = 0
                        itemData.UpdatedBy = req.user.UserName;
                        itemData.UpdatedDate = sequelize.literal('GETDATE()');

                        // Item exist, update it
                        const newItem = await BinMaster.update(itemData, {where: { BinID: itemData.BinID}, returning: true,});
                        completed.push(newItem)
                        return { item: newItem, created: true };
                    } 
                    else 
                    {
                        // New Item, do not update
                        failures.push({ BinID: itemData.BinID })
                        return { item: existingItem, created: false };
                    }
                } 
                catch (error) 
                {
                    throw error;
                }
            });

            // Execute all promises concurrently
            const results = await Promise.all(createPromises);

            // Check the results for any failures
            const hasFailures = results.some(({ created }) => !created);

            // Respond based on whether there were any failures
            if ((!hasFailures) && (failures.length == 0))
            {
                res.status(202).json({ TokenNo: req.headers['authenticatetoken'], Status: 1, Reason: 'BinMaster deleted successfully' });
            } 
            else 
            {
                res.status(202).json({ status: 0, message: 'Failed to deleted BinMaster', data: failures });
            }
        }
    } 
    catch (error) 
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

//Create ERP Pre Binning
const createERPPreBinning = async (req, res) => {
    try 
    {
        const dataList  = req.body.data;  
        
        if(req.body.ProcessType == 'addPreBinning')
        {                
            const result = await processERPPreBinningData(dataList, req.user.UserName);
            if (result.status === 1)
            {
                res.status(200).json({ TokenNo: req.headers['authenticatetoken'], Status: 1, Reason: 'PreBinning created successfully' });
            } 
            else 
            {
                res.status(202).json(result);
            }   
        }
        else if(req.body.ProcessType == 'updatePreBinning')
        {
            const seen = new Map();
            const data = [];
            const duplicateData = [];

            for (const itemData of dataList) 
            {
                const key = `${itemData.GRNNo}-${itemData.ItemCode}`;
                if (seen.has(key)) 
                {
                    duplicateData.push({GRNNo: itemData.GRNNo, ItemCode: itemData.ItemCode});
                } 
                else 
                {
                    data.push(itemData);
                    seen.set(key, true);
                }
            }

            let failures = duplicateData
            let completed = []

            const createPromises = data.map(async (itemData) => {
                try 
                {
                    // Check if the item already exists
                    const existingItem = await PreBinning.findOne({ where: {GRNNo: itemData.GRNNo , ItemCode: itemData.ItemCode }, tableHint: TableHints.NOLOCK });
                    if (existingItem) 
                    {
                        itemData.UpdatedBy = req.user.UserName;
                        itemData.UpdatedDate = sequelize.literal('GETDATE()');;
                        // Item exist, update it
                        const newItem = await PreBinning.update(itemData, {where: { GRNNo: itemData.GRNNo , ItemCode: itemData.ItemCode }, returning: true,});
                        completed.push(newItem)
                        return { item: newItem, created: true };
                    } 
                    else 
                    {
                        failures.push({GRNNo: itemData.GRNNo, ItemCode: itemData.ItemCode})
                        return { item: existingItem, created: false };
                    }
                } 
                catch (error) 
                {
                    throw error;
                }
            });

            const results = await Promise.all(createPromises);

            const hasFailures = results.some(({ created }) => !created);

            if ((!hasFailures) && (failures.length == 0))
            {
                res.status(202).json({ TokenNo: req.headers['authenticatetoken'], Status: 1, Reason: 'PreBinning update successfully' });
            } 
            else 
            {
                res.status(202).json({ status: 0, message: 'Failed to update PreBinning', data: failures });
            }
        }
    } 
    catch (error) 
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

//Create ERP Retrieval Request
const createERPRetrieval = async (req, res) => {
    try 
    {
        const dataList  = req.body.data;  

        //check duplicate 
        const seen = new Map();
        const data = [];
        const duplicateData = [];

        for (const itemData of dataList) 
        {
            const { OrderNo, ItemCode } = itemData;
            const key = `${OrderNo}-${ItemCode}`; // Combine OrderNo and ItemCode to create a unique key
            
            if (seen.has(key)) 
            {
                duplicateData.push({ OrderNo, ItemCode });
            } 
            else 
            {
                data.push(itemData);
                seen.set(key, true);
            }
        }
        
        if(req.body.ProcessType == 'addRetrieval')
        {                
            let failures = duplicateData
            let completed = []
            let ReqType = 'ERP'
            const createPromises = data.map(async (itemData) => {
                try 
                {
                    if(itemData.ReqType)
                    {
                        ReqType = itemData.ReqType
                    }
                    
                    // Check if the item already exists
                    const existingItem = await Retrieval.findOne({ where: {OrderNo: itemData.OrderNo, ItemCode: itemData.ItemCode}, tableHint: TableHints.NOLOCK });
                    if (existingItem) 
                    {                        
                        // Item already exists, do not create
                        failures.push({OrderNo: itemData.OrderNo, ItemCode: itemData.ItemCode})
                        return { item: existingItem, created: false };
                    } 
                    else 
                    {
                        itemData.CreatedBy = req.user.UserName;
                        itemData.ReqType = ReqType
                        // Item does not exist, create it
                        let InvDetails = await sequelize.query(`select COALESCE(SUM(Quantity), 0) as CNT, COALESCE(SUM(OutQuantity), 0) as OUTCNT from Inv_PalletDetails WITH (NOLOCK) where ItemCode = '${itemData.ItemCode}'`);
                        let outQty = await sequelize.query(`select COALESCE(SUM(Quantity), 0) as movedOutQty from ERP_Retrieval WITH (NOLOCK) where ItemCode = '${itemData.ItemCode}' and Status not in ('C','PC','PCC','E')`);
                        let AvlQuantity = parseInt(InvDetails[0][0].CNT) - parseInt(outQty[0][0].movedOutQty)
                        if(parseInt(AvlQuantity) > 0)
                        {
                            let BalanceQty = 0
                            if(AvlQuantity >= itemData.Quantity)
                            {
                                BalanceQty = itemData.Quantity
                            }
                            else
                            {
                                BalanceQty = AvlQuantity
                            }
                            itemData.OutQuantity = BalanceQty
                            itemData.AvlQuantity = BalanceQty
                            const newItem = await Retrieval.create(itemData);
                            completed.push(newItem)
                            return { item: newItem, created: true };
                        }
                        else
                        {
                            // Item already exists, do not create
                            failures.push({OrderNo: itemData.OrderNo, ItemCode: itemData.ItemCode, message: `Requested Stock is Not Available in ASRS. Available Stock: ${InvDetails[0][0].CNT}`})
                            return { item: existingItem, created: false };
                        }
                    }
                } 
                catch (error) 
                {
                    throw error;
                }
            });

            const results = await Promise.all(createPromises);
            const hasFailures = results.some(({ created }) => !created);

            if ((!hasFailures) && (failures.length == 0))
            {
                res.status(200).json({ TokenNo: req.headers['authenticatetoken'], Status: 1, Reason: 'Retrieval created successfully' });
            } 
            else 
            {
                res.status(400).json({ status: 0, message: 'Failed to create Retrieval', data: failures });
            }   
        }
        else if(req.body.ProcessType == 'updateRetrieval')
        {
            let failures = duplicateData
            let completed = []
            let ReqType = 'ERP'
            const createPromises = data.map(async (itemData) => {
                try 
                {
                    if(itemData.ReqType)
                    {
                        ReqType = itemData.ReqType
                    }
                    // Check if the item already exists
                    const existingItem = await Retrieval.findOne({ where: {OrderNo: itemData.OrderNo , ItemCode: itemData.ItemCode, Status: 'G' }, tableHint: TableHints.NOLOCK });
                    if (existingItem) 
                    {
                        itemData.UpdatedBy = req.user.UserName;
                        itemData.UpdatedDate = sequelize.literal('GETDATE()');
                        itemData.ReqType = ReqType
                        // Item exist, update it
                        const newItem = await Retrieval.update(itemData, {where: { OrderNo: itemData.OrderNo , ItemCode: itemData.ItemCode }, returning: true,});
                        completed.push(newItem)
                        return { item: newItem, created: true };
                    } 
                    else 
                    {
                        failures.push({OrderNo: itemData.OrderNo, ItemCode: itemData.ItemCode})
                        return { item: existingItem, created: false };
                    }
                } 
                catch (error) 
                {
                    throw error;
                }
            });

            const results = await Promise.all(createPromises);

            const hasFailures = results.some(({ created }) => !created);

            if ((!hasFailures) && (failures.length == 0))
            {
                res.status(200).json({ TokenNo: req.headers['authenticatetoken'], Status: 1, Reason: 'Retrieval update successfully' });
            } 
            else 
            {
                res.status(400).json({ status: 0, message: 'Failed to update Retrieval', data: failures });
            }
        }
        else if(req.body.ProcessType == 'addSchedule')
        {                
            let failures = duplicateData
            let completed = []
            let ReqType = 'ERP'
            const createPromises = data.map(async (itemData) => {
                try 
                {
                    if(itemData.ReqType)
                    {
                        ReqType = itemData.ReqType
                    }

                    // Check if the item already exists
                    const existingItem = await schedule.findOne({ where: {OrderNo: itemData.OrderNo, ItemCode: itemData.ItemCode, Status: 'G'}, tableHint: TableHints.NOLOCK });
                    if (existingItem) 
                    {                        
                        // Item already exists, do not create
                        failures.push({OrderNo: itemData.OrderNo, ItemCode: itemData.ItemCode})
                        return { item: existingItem, created: false };
                    } 
                    else 
                    {
                        itemData.CreatedBy = req.user.UserName;
                        itemData.ReqType = ReqType
                        
                        // Item does not exist, create it

                        const newItem = await schedule.create({
                            OrderNo: itemData.OrderNo,
                            DocEntry: itemData.DocEntry,
                            Type: itemData.Type,
                            ItemCode: itemData.ItemCode,
                            ItemName: itemData.ItemName,
                            Quantity: itemData.Quantity,
                            Station: itemData.Station,
                            Floor: itemData.Floor,
                            ReqType: itemData.ReqType,
                            SequenceNo: itemData.SequenceNo,
                            ScheduleDateTime: sequelize.literal(`'${moment(itemData.ScheduleDateTime).format('YYYY-MM-DD HH:mm:ss.SSS')}'`),
                            CreatedBy: itemData.CreatedBy
                        });
                        completed.push(newItem)
                        return { item: newItem, created: true };
                    }
                } 
                catch (error) 
                {
                    throw error;
                }
            });

            const results = await Promise.all(createPromises);
            const hasFailures = results.some(({ created }) => !created);

            if ((!hasFailures) && (failures.length == 0))
            {
                res.status(200).json({ TokenNo: req.headers['authenticatetoken'], Status: 1, Reason: 'Schedule created successfully' });
            } 
            else 
            {
                res.status(400).json({ status: 0, message: 'Failed to create Schedule', data: failures });
            }   
        }
        else if(req.body.ProcessType == 'updateSchedule')
        {
            let failures = duplicateData
            let completed = []
            let ReqType = 'ERP'
            const createPromises = data.map(async (itemData) => {
                try 
                {
                    if(itemData.ReqType)
                    {
                        ReqType = itemData.ReqType
                    }

                    // Check if the item already exists
                    const existingItem = await schedule.findOne({ where: {OrderNo: itemData.OrderNo , ItemCode: itemData.ItemCode, Status: 'G' }, tableHint: TableHints.NOLOCK });
                    if (existingItem) 
                    {
                        itemData.UpdatedBy = req.user.UserName;
                        itemData.UpdatedDate = sequelize.literal('GETDATE()');
                        itemData.ReqType = ReqType
                        // Item exist, update it
                        const newItem = await schedule.update(itemData, {where: { OrderNo: itemData.OrderNo , ItemCode: itemData.ItemCode }, returning: true,});
                        completed.push(newItem)
                        return { item: newItem, created: true };
                    } 
                    else 
                    {
                        failures.push({OrderNo: itemData.OrderNo, ItemCode: itemData.ItemCode})
                        return { item: existingItem, created: false };
                    }
                } 
                catch (error) 
                {
                    throw error;
                }
            });

            const results = await Promise.all(createPromises);

            const hasFailures = results.some(({ created }) => !created);

            if ((!hasFailures) && (failures.length == 0))
            {
                res.status(200).json({ TokenNo: req.headers['authenticatetoken'], Status: 1, Reason: 'Schedule update successfully' });
            } 
            else 
            {
                res.status(400).json({ status: 0, message: 'Failed to update Schedule', data: failures });
            }
        }
        else if(req.body.ProcessType == 'addNightShuffle')
        {                
            let failures = duplicateData
            let completed = []
            let ReqType = 'ERP'
            const createPromises = data.map(async (itemData) => {
                try 
                {
                    if(itemData.ReqType)
                    {
                        ReqType = itemData.ReqType
                    }
                    // Check if the item already exists
                    const existingItem = await nightShuffle.findOne({ where: {OrderNo: itemData.OrderNo, ItemCode: itemData.ItemCode, Status: 'G'}, tableHint: TableHints.NOLOCK });
                    if (existingItem) 
                    {                        
                        // Item already exists, do not create
                        failures.push({OrderNo: itemData.OrderNo, ItemCode: itemData.ItemCode})
                        return { item: existingItem, created: false };
                    } 
                    else 
                    {
                        itemData.CreatedBy = req.user.UserName;
                        itemData.ReqType = ReqType
                        // Item does not exist, create it
                        const newItem = await nightShuffle.create(itemData);
                        completed.push(newItem)
                        return { item: newItem, created: true };
                    }
                } 
                catch (error) 
                {
                    throw error;
                }
            });

            const results = await Promise.all(createPromises);
            const hasFailures = results.some(({ created }) => !created);

            if ((!hasFailures) && (failures.length == 0))
            {
                res.status(200).json({ TokenNo: req.headers['authenticatetoken'], Status: 1, Reason: 'NightShuffle created successfully' });
            } 
            else 
            {
                res.status(400).json({ status: 0, message: 'Failed to create NightShuffle', data: failures });
            }   
        }
        else if(req.body.ProcessType == 'updateNightShuffle')
        {
            let failures = duplicateData
            let completed = []
            let ReqType = 'ERP'
            const createPromises = data.map(async (itemData) => {
                try 
                {
                    if(itemData.ReqType)
                    {
                        ReqType = itemData.ReqType
                    }

                    // Check if the item already exists
                    const existingItem = await nightShuffle.findOne({ where: {OrderNo: itemData.OrderNo , ItemCode: itemData.ItemCode, Status: 'G' }, tableHint: TableHints.NOLOCK });
                    if (existingItem) 
                    {
                        itemData.UpdatedBy = req.user.UserName;
                        itemData.UpdatedDate = sequelize.literal('GETDATE()');
                        itemData.ReqType = ReqType
                        // Item exist, update it
                        const newItem = await nightShuffle.update(itemData, {where: { OrderNo: itemData.OrderNo , ItemCode: itemData.ItemCode }, returning: true,});
                        completed.push(newItem)
                        return { item: newItem, created: true };
                    } 
                    else 
                    {
                        failures.push({OrderNo: itemData.OrderNo, ItemCode: itemData.ItemCode})
                        return { item: existingItem, created: false };
                    }
                } 
                catch (error) 
                {
                    throw error;
                }
            });

            const results = await Promise.all(createPromises);

            const hasFailures = results.some(({ created }) => !created);

            if ((!hasFailures) && (failures.length == 0))
            {
                res.status(200).json({ TokenNo: req.headers['authenticatetoken'], Status: 1, Reason: 'NightShuffle update successfully' });
            } 
            else 
            {
                res.status(400).json({ status: 0, message: 'Failed to update NightShuffle', data: failures });
            }
        }
    } 
    catch (error) 
    {
        res.status(400).json({status: 0, message: error.message});
    }
}

//Create ERP StockAdjustment Request
const createERPStockAdjustment = async (req, res) => {
    try 
    {
        const dataList  = req.body.data;  

        //check duplicate 
        const seen = new Map();
        const data = [];
        const duplicateData = [];
        for (const itemData of dataList) 
        {
            const { BinID,ItemCode } = itemData;

            if (seen.has(BinID && ItemCode)) 
            {
                duplicateData.push({BinID: itemData.BinID, ItemCode: itemData.ItemCode});
            } 
            else 
            {
                data.push(itemData);
                seen.set(BinID && ItemCode, true);
            }
        }
        
        if(req.body.ProcessType == 'addStockAdjustment')
        {                
            let failures = duplicateData
            let completed = []
            const createPromises = data.map(async (itemData) => {
                try 
                {
                    // Check if the item already exists
                    const existingItem = await stockAdjust.findOne({ where: {BinID: itemData.BinID, ItemCode: itemData.ItemCode}, tableHint: TableHints.NOLOCK });
                    if (existingItem) 
                    {                        
                        // Item already exists, do not create
                        failures.push({BinID: itemData.BinID, ItemCode: itemData.ItemCode})
                        return { item: existingItem, created: false };
                    } 
                    else 
                    {
                        itemData.CreatedBy = req.user.UserName;
                        // Item does not exist, create it
                        const newItem = await stockAdjust.create(itemData);
                        completed.push(newItem)
                        return { item: newItem, created: true };
                    }
                } 
                catch (error) 
                {
                    throw error;
                }
            });

            const results = await Promise.all(createPromises);
            const hasFailures = results.some(({ created }) => !created);

            if ((!hasFailures) && (failures.length == 0))
            {
                res.status(202).json({ TokenNo: req.headers['authenticatetoken'], Status: 1, Reason: 'StockAdjustment created successfully' });
            } 
            else 
            {
                res.status(202).json({ status: 0, message: 'Failed to create StockAdjustment', data: failures });
            }   
        }
        else if(req.body.ProcessType == 'updateStockAdjustment')
        {
            let failures = duplicateData
            let completed = []

            const createPromises = data.map(async (itemData) => {
                try 
                {
                    // Check if the item already exists
                    const existingItem = await stockAdjust.findOne({ where: {BinID: itemData.BinID, ItemCode: itemData.ItemCode}, tableHint: TableHints.NOLOCK });
                    if (existingItem) 
                    {
                        itemData.UpdatedBy = req.user.UserName;
                        itemData.UpdatedDate = sequelize.literal('GETDATE()');;
                        // Item exist, update it
                        const newItem = await stockAdjust.update(itemData, {where: {BinID: itemData.BinID, ItemCode: itemData.ItemCode}, returning: true,});
                        completed.push(newItem)
                        return { item: newItem, created: true };
                    } 
                    else 
                    {
                        failures.push({BinID: itemData.BinID, ItemCode: itemData.ItemCode})
                        return { item: existingItem, created: false };
                    }
                } 
                catch (error) 
                {
                    throw error;
                }
            });

            const results = await Promise.all(createPromises);

            const hasFailures = results.some(({ created }) => !created);

            if ((!hasFailures) && (failures.length == 0))
            {
                res.status(202).json({ TokenNo: req.headers['authenticatetoken'], Status: 1, Reason: 'StockAdjustment update successfully' });
            } 
            else 
            {
                res.status(202).json({ status: 0, message: 'Failed to update StockAdjustment', data: failures });
            }
        }
    } 
    catch (error) 
    {
        res.status(202).json({status: 0, message: error.message});
    }
}

//Create ERP Cancel order Request
const createERPCancelOrder = async (req, res) => {
    // try 
    // {
    //     const dataList  = req.body.data;  

    //     //check duplicate 
    //     const seen = new Map();
    //     const data = [];
    //     const duplicateData = [];
    //     for (const itemData of dataList) 
    //     {
    //         const { BinID,ItemCode } = itemData;

    //         if (seen.has(BinID && ItemCode)) 
    //         {
    //             duplicateData.push({BinID: itemData.BinID, ItemCode: itemData.ItemCode});
    //         } 
    //         else 
    //         {
    //             data.push(itemData);
    //             seen.set(BinID && ItemCode, true);
    //         }
    //     }
        
    //     if(req.body.ProcessType == 'addStockAdjustment')
    //     {                
    //         let failures = duplicateData
    //         let completed = []
    //         const createPromises = data.map(async (itemData) => {
    //             try 
    //             {
    //                 // Check if the item already exists
    //                 const existingItem = await stockAdjust.findOne({ where: {BinID: itemData.BinID, ItemCode: itemData.ItemCode} });
    //                 if (existingItem) 
    //                 {                        
    //                     // Item already exists, do not create
    //                     failures.push({BinID: itemData.BinID, ItemCode: itemData.ItemCode})
    //                     return { item: existingItem, created: false };
    //                 } 
    //                 else 
    //                 {
    //                     itemData.CreatedBy = req.user.UserName;
    //                     // Item does not exist, create it
    //                     const newItem = await stockAdjust.create(itemData);
    //                     completed.push(newItem)
    //                     return { item: newItem, created: true };
    //                 }
    //             } 
    //             catch (error) 
    //             {
    //                 throw error;
    //             }
    //         });

    //         const results = await Promise.all(createPromises);
    //         const hasFailures = results.some(({ created }) => !created);

    //         if ((!hasFailures) && (failures.length == 0))
    //         {
    //             res.status(202).json({ TokenNo: req.headers['authenticatetoken'], Status: 1, Reason: 'StockAdjustment created successfully' });
    //         } 
    //         else 
    //         {
    //             res.status(202).json({ status: 0, message: 'Failed to create StockAdjustment', data: failures });
    //         }   
    //     }
    //     else if(req.body.ProcessType == 'updateStockAdjustment')
    //     {
    //         let failures = duplicateData
    //         let completed = []

    //         const createPromises = data.map(async (itemData) => {
    //             try 
    //             {
    //                 // Check if the item already exists
    //                 const existingItem = await stockAdjust.findOne({ where: {BinID: itemData.BinID, ItemCode: itemData.ItemCode} });
    //                 if (existingItem) 
    //                 {
    //                     itemData.UpdatedBy = req.user.UserName;
    //                     itemData.UpdatedDate = sequelize.literal('GETDATE()');;
    //                     // Item exist, update it
    //                     const newItem = await stockAdjust.update(itemData, {where: {BinID: itemData.BinID, ItemCode: itemData.ItemCode}, returning: true,});
    //                     completed.push(newItem)
    //                     return { item: newItem, created: true };
    //                 } 
    //                 else 
    //                 {
    //                     failures.push({BinID: itemData.BinID, ItemCode: itemData.ItemCode})
    //                     return { item: existingItem, created: false };
    //                 }
    //             } 
    //             catch (error) 
    //             {
    //                 throw error;
    //             }
    //         });

    //         const results = await Promise.all(createPromises);

    //         const hasFailures = results.some(({ created }) => !created);

    //         if ((!hasFailures) && (failures.length == 0))
    //         {
    //             res.status(202).json({ TokenNo: req.headers['authenticatetoken'], Status: 1, Reason: 'StockAdjustment update successfully' });
    //         } 
    //         else 
    //         {
    //             res.status(202).json({ status: 0, message: 'Failed to update StockAdjustment', data: failures });
    //         }
    //     }
    // } 
    // catch (error) 
    // {
    //     res.status(202).json({status: 0, message: error.message});
    // }
}

const nextTrolley = async (req, res) => {
    
    const startTime = new Date()
    try 
    {
        const dataList = req.body; 
        // Fetch Bearer Token (assuming you have a function for this)
        let bearerToken = '' 
        const tokenData = await fetchBearerToken();

        if(tokenData.status === 1)
        {
            bearerToken = tokenData.TokenNo
        }
        else
        {
            res.status(202).json({ status: 0, message: tokenData.message });
        }

        // Prepare headers with Authorization header
        const headers = {
            'Authorization': `Bearer ${bearerToken}`,
            'Content-Type': 'application/json'
        };

        // Example API URL to trigger
        const apiUrl = ERPAPIURL+'RetrievalConfirmation/TrolleyConfirmation'; //TODO URL NOT GIVEN IN UATHAYAM TEAM
        let RetrievalData = []
        for(let i = 0; i < dataList.length; i++)
        {
            let item = dataList[i]
            let query = `update ERP_Retrieval set TrolleyNo = '${item.trolley}', isTrolleyConfirm='Y' where ItemCode ='${item.itemCode}' and orderNo = '${item.orderNo}'`
            let ERPDetails = await sequelize.query(query);
            item.reqQuantity = parseFloat(item.reqQuantity)
            item.tokenNo = bearerToken
            item.processType = 'TrolleyConfirmation'
            RetrievalData.push(item)
        }

        // Example payload (if needed)
        const payload = {
            "type": "CraftsmanRequest",
            stationID: dataList[0].station,
            data: RetrievalData
        }
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

        if (response.status == 200) 
        {
            res.status(200).json({ status: 1, message: 'Next Trolley successfully'});
        } 
        else 
        {
            res.status(202).json({ status: 0, message: 'Next Trolley Failed' });        
        }
    } 
    catch (error) 
    {
        res.status(202).json({ status: 0, message: error.message });
    }
}

const getTrolleyReprint = async (req, res) => {
    
    const startTime = new Date()
    try 
    {
        let data = req.body
        let dataList = await ERPRetrieval.findAll( {where: { OrderNo: data.orderNo, Status:{[Op.in]: ["C","PC","PCC"]}, PickingQty: { [Op.gt]: 0 } }, tableHint: TableHints.NOLOCK } );
    
        let bearerToken = '' 
        const tokenData = await fetchBearerToken();

        if(tokenData.status === 1)
        {
            bearerToken = tokenData.TokenNo
        }
        else
        {
            res.status(202).json({ status: 0, message: tokenData.message });
        }

        // Prepare headers with Authorization header
        const headers = {
            'Authorization': `Bearer ${bearerToken}`,
            'Content-Type': 'application/json'
        };

        // Example API URL to trigger
        const apiUrl = ERPAPIURL+'RetrievalConfirmation/TrolleyConfirmation'; //TODO URL NOT GIVEN IN UATHAYAM TEAM
        
        let RetrievalData = []
        for(let i = 0; i < dataList.length; i++)
        {
            let item = dataList[i].dataValues
            let list = {}
            list.tokenNo = bearerToken,
            list.processType = 'TrolleyConfirmation',
            list.orderNo = item.OrderNo,
            list.type = item.Type,
            list.trolley = item.TrolleyNo,
            list.itemCode = item.ItemCode,
            list.itemName = item.ItemName,
            list.itemGroup = '',
            list.reqQuantity = parseFloat(item.Quantity),
            list.pickedQty = parseFloat(item.PickingQty),
            list.remark = item.ConfirmRemark
            let query = `update ERP_Retrieval set isTrolleyConfirm='Y' where ItemCode ='${item.ItemCode}' and orderNo = '${item.OrderNo}'`
            let ERPDetails = await sequelize.query(query);
            RetrievalData.push(list)
        }

        // Example payload (if needed)
        const payload = {
            "type": "CraftsmanRequest",
            stationID: dataList[0].dataValues.Station,
            data: RetrievalData
        }
        
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

        if (response.status == 200) 
        {
            res.status(200).json({ status: 1, message: 'Next Trolley successfully'});
        } 
        else 
        {
            res.status(202).json({ status: 0, message: 'Next Trolley Failed' });        
        }
    } 
    catch (error) 
    {
        res.status(202).json({ status: 0, message: error.message });
    }
}

const getPendingTrolleyData = async (req, res) => {
    try
    {
        let data = req.body
        let orderList = await sequelize.query(`SELECT DISTINCT orderNo, TrolleyNo FROM ERP_Retrieval WITH (NOLOCK) WHERE isTrolleyConfirm = 'N' and Station ='${data.station}'`)
        if(orderList.length > 0)
        {
            res.status(200).json({ status: 1, message: 'Date Get Successfully', data: orderList[0]});
        }
        else
        {
            res.status(202).json({ status: 0, message: 'Failed to get data'});
        }
    }
    catch (error) 
    {
        res.status(202).json({ status: 0, message: error.message });
    }
}

const getInventoryData = async (req, res) => {
    try
    {
        let orderList = await sequelize.query(`SELECT ItemCode, SUM(Quantity) AS TotalQuantity, SUM(OutQuantity) AS TotalOutQuantity, SUM(Quantity - OutQuantity) AS AvailableStock
            FROM 
                Inv_PalletDetails WITH (NOLOCK)
            GROUP BY ItemCode;`)
        if(orderList.length > 0)
        {
            res.status(200).json({ status: 1, message: 'Date Get Successfully', data: orderList[0]});
        }
        else
        {
            res.status(202).json({ status: 0, message: 'Failed to get data'});
        }
    }
    catch (error) 
    {
        res.status(202).json({ status: 0, message: error.message });
    }
}

const getGRNPushingList = async (req, res) => {
    try
    {
        const type = req.body?.type || 'Binning';
        const result = await sequelize2.query(
            'EXEC [dbo].[@ASRS_Transaction] @type = :type',
            {
                replacements: { type },
                type: sequelize2.QueryTypes.SELECT
            }
        );
                
        return res.status(200).json({
            status: 1,
            message: result.length ? 'GRN Pushing list fetched successfully' : 'No GRN Pushing data found',
            data: result
        });
    }
    catch (error)
    {
        return res.status(202).json({ status: 0, message: error.message });
    }
}

const getGRNPushingDetails = async (req, res) => {
    try
    {
        const docEntry = req.body?.docEntry;

        if (docEntry === undefined || docEntry === null || docEntry === '') {
            return res.status(202).json({ status: 0, message: 'docEntry is required' });
        }

        const replacements = {
            type: req.body?.type || 'Binning',
            process: req.body?.process || 'GRPO',
            status: req.body?.status || 'Pending',
            docEntry
        };

        const result = await sequelize.query(
            'EXEC [dbo].[@ASRS_Transaction_Details] @type = :type, @process = :process, @status = :status, @docEntry = :docEntry',
            {
                replacements,
                type: sequelize.QueryTypes.SELECT
            }
        );

        return res.status(200).json({
            status: 1,
            message: result.length ? 'GRN Pushing details fetched successfully' : 'No GRN Pushing detail found',
            data: result
        });
    }
    catch (error)
    {
        return res.status(202).json({ status: 0, message: error.message });
    }
}

const createGRNPushingTransaction = async (req, res) => {
    const dbTransaction = await sequelize2.transaction();

    try
    {
        const docEntry = req.body?.docEntry;
        const type = req.body?.type || 'Binning';
        const process = req.body?.process || 'GRPO';
        const status = req.body?.status || 'Pending';

        if (docEntry === undefined || docEntry === null || docEntry === '') {
            await dbTransaction.rollback();
            return res.status(202).json({ status: 0, message: 'docEntry is required' });
        }

        const headerRows = await sequelize2.query(
            'EXEC [dbo].[@ASRS_Transaction] @type = :type',
            {
                replacements: { type },
                type: sequelize2.QueryTypes.SELECT,
                transaction: dbTransaction
            }
        );

        const selectedHeader = headerRows.find((row) => String(row.DocEntry) === String(docEntry));

        if (!selectedHeader) {
            await dbTransaction.rollback();
            return res.status(202).json({ status: 0, message: 'Selected GRN Pushing row not found' });
        }

        const detailRows = await sequelize2.query(
            'EXEC [dbo].[@ASRS_Transaction_Details] @type = :type, @process = :process, @status = :status, @docEntry = :docEntry',
            {
                replacements: { type, process, status, docEntry },
                type: sequelize2.QueryTypes.SELECT,
                transaction: dbTransaction
            }
        );

        if (!detailRows.length) {
            await dbTransaction.rollback();
            return res.status(202).json({ status: 0, message: 'Selected GRN Pushing detail rows not found' });
        }

        const insertedHeader = await sequelize2.query(`
            INSERT INTO Tran_TransHeader
            (
                TransType, Process, DocType, DocNum, DocEntry, Station, Floor,
                ScheduleDateTime, ShuffleDateTime, RetrievalTime, SapDocType,
                SapDocNum, SapDocEntry, SapStatus, CreatedDate, Status,
                LableRequired, ReqUserId, RequestedDate
            )
            OUTPUT INSERTED.Id
            VALUES
            (
                :transType, :process, :docType, :docNum, :docEntry, :station, :floor,
                :scheduleDateTime, :shuffleDateTime, :retrievalTime, :sapDocType,
                :sapDocNum, :sapDocEntry, :sapStatus, GETDATE(), :status,
                :lableRequired, :reqUserId, :requestedDate
            )
        `, {
            replacements: {
                transType: type,
                process,
                docType: selectedHeader.Type || process,
                docNum: selectedHeader.DocNum || '',
                docEntry: String(selectedHeader.DocEntry || docEntry),
                station: selectedHeader.Station || '',
                floor: selectedHeader.Floor || '',
                scheduleDateTime: selectedHeader.ReqDate || null,
                shuffleDateTime: null,
                retrievalTime: null,
                sapDocType: detailRows[0].DocType || process,
                sapDocNum: null,
                sapDocEntry: Number(detailRows[0].DocEntry) || null,
                sapStatus: 'Pending',
                status: 'Initiated',
                lableRequired: 0,
                reqUserId: req.user.id,
                requestedDate: new Date()
            },
            type: sequelize2.QueryTypes.SELECT,
            transaction: dbTransaction
        });

        const headerId = insertedHeader[0]?.Id;

        if (!headerId) {
            throw new Error('Failed to create transaction header');
        }

        for (const detail of detailRows) {
            await sequelize2.query(`
                INSERT INTO Tran_TransDetails
                (
                    HeaderId, DocType, DocNum, DocEntry, ProductCode, OrderQty,
                    ReqQty, ConfQty, SapDocEntry, SapDocNum, SapDocType, SapStatus,
                    ProductName, Trolley, [Sequence], [LineNo], PrintQty
                )
                VALUES
                (
                    :headerId, :docType, :docNum, :docEntry, :productCode, :orderQty,
                    :reqQty, :confQty, :sapDocEntry, :sapDocNum, :sapDocType, :sapStatus,
                    :productName, :trolley, :sequence, :lineNo, :printQty
                )
            `, {
                replacements: {
                    headerId,
                    docType: detail.DocType || process,
                    docNum: String(detail.DocNum || selectedHeader.DocNum || ''),
                    docEntry: String(detail.DocEntry || docEntry),
                    productCode: detail.ItemCode || '',
                    orderQty: Number(detail.Quantity || 0),
                    reqQty: Number(detail.Requested || detail.Quantity || 0),
                    confQty: Number(detail.Binned || 0),
                    sapDocEntry: Number(detail.DocEntry) || null,
                    sapDocNum: null,
                    sapDocType: detail.DocType || process,
                    sapStatus: 'Pending',
                    productName: detail.ItemName || '',
                    trolley: null,
                    sequence: null,
                    lineNo: detail.LineNo ?? null,
                    printQty: null
                },
                type: sequelize2.QueryTypes.INSERT,
                transaction: dbTransaction
            });
        }

        const preBinningPayload = detailRows.map((detail) => ({
            TransactionType: type,
            GRNNo: String(selectedHeader.DocEntry || docEntry),
            DocNo: selectedHeader.DocNum || detail.DocNum || '',
            PartyName: selectedHeader.PartyName || '',
            ItemCode: detail.ItemCode,
            Quantity: Number(detail.Requested || detail.Quantity || 0),
            Type: selectedHeader.Type || ''
        }));

        const preBinningResult = await processERPPreBinningData(preBinningPayload, req.user.UserName);

        await sequelize2.query(`
            UPDATE Tran_TransHeader
            SET Status = :status,
                SapStatus = :sapStatus,
                SapDocType = COALESCE(SapDocType, :sapDocType),
                SapDocEntry = COALESCE(SapDocEntry, :sapDocEntry)
            WHERE Id = :headerId
        `, {
            replacements: {
                headerId,
                status: preBinningResult.status === 1 ? 'Success' : 'Failed',
                sapStatus: preBinningResult.status === 1
                    ? preBinningResult.Reason
                    : (preBinningResult.message || 'PreBinning failed'),
                sapDocType: detailRows[0].DocType || process,
                sapDocEntry: Number(detailRows[0].DocEntry) || null
            },
            type: sequelize2.QueryTypes.UPDATE,
            transaction: dbTransaction
        });

        await dbTransaction.commit();

        return res.status(preBinningResult.status === 1 ? 200 : 202).json({
            status: preBinningResult.status,
            message: preBinningResult.Reason || preBinningResult.message,
            headerId,
            data: preBinningResult.data || []
        });
    }
    catch (error)
    {
        await dbTransaction.rollback();
        return res.status(202).json({ status: 0, message: error.message });
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

module.exports = {
    ERPLoginVerify,
    createERPItemMaster,
    createERPBinMaster,
    createERPPreBinning,
    createERPRetrieval,
    createERPStockAdjustment,
    createERPCancelOrder,
    nextTrolley,
    getTrolleyReprint,
    getPendingTrolleyData,
    getInventoryData,
    getGRNPushingList,
    getGRNPushingDetails,
    createGRNPushingTransaction
}
