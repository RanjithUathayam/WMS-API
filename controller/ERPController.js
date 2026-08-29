const PreBinning = require('../models/ERP_API/PreBinning')
const { sequelize, sequelize2 } = require('../config/database');
const MasterPart = require('../models/master/MasterPart')
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

module.exports = {
    getGRNPushingList,
    getGRNPushingDetails,
    createGRNPushingTransaction,
};
