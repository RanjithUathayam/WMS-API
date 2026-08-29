const storageData = require('../models/operation/storageDetails')
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const BinComplete = require('../models/HHT/binComplete')
const PreBinning = require('../models/ERP_API/PreBinning')
const MasterReason = require('../models/master/MasterReason');
const MasterPart = require('../models/master/MasterPart')
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

module.exports = {
    PreBinningApprove,
    PreBinApproveStatus,
    MoveToPreBinning,
    binWisePreBinningReject,
    getPreBinningRejectData,
};
