const express = require('express');
const cors = require('cors');
const app = express();
const bodyParser = require('body-parser');
const { Op, literal, QueryTypes } = require('sequelize');
const authenticateToken = require('./authenticateToken');
const cron = require('node-cron');
const moment = require('moment');

const projectRoutes = require('./routes/projectRoutes');
const masterRoutes = require('./routes/masterRoutes');
const historyRoutes = require('./routes/historyRoutes');
const operationRouter = require('./routes/operationRouter');
const palletRequest = require('./models/operation/storage');
const ERPRetrieval = require('./models/ERP_API/BinRetrieval')
const ERPRouter = require('./routes/ERPRoutes')
const HHTRouter = require('./routes/HHTRouter')
const { sequelize } = require('./config/database');
const KEPGroundConveyorStatus = require('./models/operation/KEPGroundConveyorStatus');
const RetrievalConfirmation = require('./models/operation/RetrievalConfirmation');
const transactionRoutes = require('./routes/transactionRoutes');
const statusRoutes = require('./routes/statusRouter');
const dataRoutes = require('./routes/dataRoutes');
const masterExport = require('./routes/masterExport')
const KepLiftRequestDetails = require('./models/operation/KEPTotlifeStatus');
const MasterPart = require('./models/master/MasterPart');
const MasterReason = require('./models/master/MasterReason');
const configRouter = require('./routes/configRouter')
const projectController = require('./controller/projectController');
const alarmHistoryModel = require('./models/history/AlarmHistory');
const InvPalletDetails = require('./models/transaction/InvPalletDetail')
const { TableHints } = require('sequelize');

// Socket.IO
const http = require('http');
const socketIo = require('socket.io');
const server = http.createServer(app);
const io = socketIo(server, {cors:{origin:'*'}});

app.use(express.json());
app.use(express.json({ limit: '1gb' }));
app.use(bodyParser.json({ limit: '1gb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '1gb' }));
app.use(cors({ origin: '*' }))


// Serve Angular app
app.use(express.static('public'));

// app.use(authenticateToken);
app.use('/api', projectRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/master',authenticateToken, masterRoutes); //authenticateToken,
app.use('/api/masterExport', masterExport);
app.use('/api/history', authenticateToken, historyRoutes); //authenticateToken,
app.use('/api/operation',authenticateToken, operationRouter);
app.use('/api/transaction', authenticateToken, transactionRoutes);
app.use('/api/status', authenticateToken, statusRoutes);
app.use('/api/ERP', authenticateToken, ERPRouter)
app.use('/api/HHT',authenticateToken, HHTRouter)
app.use('/api/config',authenticateToken, configRouter)

//Data Clean
// cron.schedule('0 0 * * *', async () => {  
//     try {
//       await projectController.TruncateTable();
//     } catch (err) {
//       console.error('Cron job failed:', err.message);
//     }
// });


// SSE endpoint
app.get('/StorageRequest', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let lastStoreDetails = null;

    // Function to fetch and send storage details if there are changes
    const sendStoreDetails = async () => {
        try {
            const storeDetails = await KepLiftRequestDetails.findAll({
                where: { ReqType: "STR", Status: { [Op.in]: ["G", "P"] } },
                tableHint: TableHints.NOLOCK
            });

            // Check if there are changes in the store details
            if (JSON.stringify(storeDetails) !== JSON.stringify(lastStoreDetails)) {
                lastStoreDetails = storeDetails;
                res.write(`data: ${JSON.stringify(storeDetails)}\n\n`);
            }
        } catch (error) {
            console.error('Error fetching storage details:', error);
            res.write('event: error\ndata: An error occurred while fetching data\n\n');
        }
    };

    // Send initial data
    await sendStoreDetails();

    // Set interval to send periodic updates
    const intervalId = setInterval(sendStoreDetails, 900);

    // Cleanup function for disconnection or error
    const cleanup = () => {
        clearInterval(intervalId);
        res.end();
    };

    // Register cleanup on client disconnect
    req.on('close', cleanup);
});


//retrivalQueue List
// SSE endpoint for retrieval queue
app.get('/RetrievalQueueRequest', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let lastRetrievalDetails = null;

    // Function to fetch and send retrieval details if there are changes
    const sendRetrievalDetails = async () => {
        try {
            const retrievalDetails = await ERPRetrieval.findAll({
                where: { Status: { [Op.in]: ["G", "P", "Hold", "M"] } },
                tableHint: TableHints.NOLOCK
            });

            const retrievalQueue = [];
            retrievalDetails.forEach((record) => {
                const data = record.dataValues;
                const existingIndex = retrievalQueue.findIndex(
                    (item) => item.OrderNo === data.OrderNo
                );

                if (existingIndex === -1) {
                    // New OrderNo entry
                    retrievalQueue.push({
                        OrderNo: data.OrderNo,
                        Type: data.Type,
                        Quantity: parseFloat(data.Quantity),
                        Station: data.Station,
                        NoOfItem: 1,
                        ItemStatus: [data.Status],
                        SequenceNo: data.SequenceNo,
                        PickingQty: parseInt(data.PickingQty),
                        Status: data.Status,
                    });
                } else {
                    // Existing OrderNo entry
                    const existing = retrievalQueue[existingIndex];
                    existing.Quantity += parseFloat(data.Quantity);
                    existing.NoOfItem += 1;
                    existing.PickingQty += parseInt(data.PickingQty),
                    existing.ItemStatus.push(data.Status);
                    if(existing.Station == "")
                    {
                        existing.Station = data.Station
                    }

                    // Update the overall status based on priorities
                    if (existing.ItemStatus.includes("P")) {
                        existing.Status = "P";
                    } else if (existing.ItemStatus.includes("Hold")) {
                        existing.Status = "Hold";
                    } else {
                        existing.Status = "G";
                    }
                }
            });

            // Sort by SequenceNo
            retrievalQueue.sort((a, b) => a.SequenceNo - b.SequenceNo);

            // Check for changes and send updates
            if (JSON.stringify(retrievalQueue) !== JSON.stringify(lastRetrievalDetails)) {
                lastRetrievalDetails = retrievalQueue;
                res.write(`data: ${JSON.stringify(retrievalQueue)}\n\n`);
            }
        } catch (error) {
            console.error("Error fetching retrieval details:", error);
            res.write('event: error\ndata: An error occurred while fetching data\n\n');
        }
    };

    // Send initial data
    await sendRetrievalDetails();

    // Send periodic updates
    const intervalId = setInterval(sendRetrievalDetails, 900);

    // Cleanup function
    const cleanup = () => {
        clearInterval(intervalId);
        res.end();
    };

    // Register cleanup on client disconnect
    req.on("close", cleanup);
});

//TV Display
app.get('/tvDisplay', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let previousResponseData = null;

    const getTVDisplay = async () => {
        try {
            const aisleData = req.query.aisle ?? '';
            const Aisle = aisleData === "All" ? "All" : aisleData.slice(-1);
            const startDate = moment().startOf('day').format('YYYY-MM-DD HH:mm:ss');
            const endDate = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss');

            let tableQuery, processQuery;

            if (Aisle == "All") 
            {
                tableQuery = `
                        WITH InvAgg AS (
                            SELECT BinID, SUM(Quantity) AS TotalQuantity
                            FROM Inv_PalletDetails WITH (NOLOCK)
                            GROUP BY BinID
                        )

                        SELECT 
                            LS.AisleNo,
                            COUNT(DISTINCT LS.LocationID) AS totalLocations,
                            SUM(CASE WHEN LS.BinID IS NULL THEN 1 ELSE 0 END) AS emptyLocations,
                            COUNT(DISTINCT CASE WHEN LS.BinID IS NOT NULL THEN LS.BinID END) AS occupiedLocations,
                            COUNT(DISTINCT CASE WHEN LS.BinID IS NOT NULL AND LS.ItemCode = 'EMPTY' THEN LS.BinID END) AS emptyBins,
                            COUNT(DISTINCT CASE WHEN LS.BinID IS NOT NULL AND LS.ItemCode != 'EMPTY' THEN LS.BinID END) AS occupiedBins,
                            SUM(CASE WHEN LS.BinID IS NOT NULL AND LS.ItemCode != 'EMPTY' THEN COALESCE(IA.TotalQuantity, 0) ELSE 0 END) AS occupiedItems
                        FROM LocationSpecification LS WITH (NOLOCK)
                        LEFT JOIN InvAgg IA ON IA.BinID = LS.BinID
                        GROUP BY LS.AisleNo
                        ORDER BY LS.AisleNo;`
            } 
            else 
            {
                tableQuery = `WITH InvAgg AS (
                                SELECT BinID, SUM(Quantity) AS TotalQuantity
                                FROM Inv_PalletDetails WITH (NOLOCK)
                                GROUP BY BinID
                            )
                            SELECT 
                                LS.AisleNo,
                                COUNT(DISTINCT LS.LocationID) AS totalLocations,
                                SUM(CASE WHEN LS.BinID IS NULL THEN 1 ELSE 0 END) AS emptyLocations,
                                COUNT(DISTINCT CASE WHEN LS.BinID IS NOT NULL THEN LS.BinID END) AS occupiedLocations,
                                COUNT(DISTINCT CASE WHEN LS.BinID IS NOT NULL AND LS.ItemCode = 'EMPTY' AND LS.ItemName = 'EMPTY' THEN LS.BinID END) AS emptyBins,
                                COUNT(DISTINCT CASE WHEN LS.BinID IS NOT NULL AND LS.ItemCode != 'EMPTY' AND LS.ItemName != 'EMPTY' THEN LS.BinID END) AS occupiedBins,
                                SUM(CASE WHEN LS.BinID IS NOT NULL AND LS.ItemCode != 'EMPTY' AND LS.ItemName != 'EMPTY' THEN COALESCE(IA.TotalQuantity, 0) ELSE 0 END) AS occupiedItems
                            FROM LocationSpecification LS WITH (NOLOCK)
                            LEFT JOIN InvAgg IA ON IA.BinID = LS.BinID
                            WHERE LS.AisleNo = '${Aisle}'
                            GROUP BY LS.AisleNo
                            ORDER BY LS.AisleNo;
                    `;
                // processQuery = `SELECT ReqType, BinID FROM PalletRequestDetails WHERE AisleNo = '${Aisle}' AND Status = 'P';`;
            }
            
            // Constructing the queries based on the aisle
            //currentProcessData, alarmStatusList
            const [tableData, result ] = await Promise.all([
                sequelize.query(tableQuery), // Assuming optimized SQL queries here
                //sequelize.query(processQuery),
                sequelize.query(`EXEC SP_ShowPalletRequestlist @Type = :Type,@FromDate= :FromDate,@ToDate= :ToDate,@StatusValue= :StatusValue,@ProcessType= :ProcessType,@AisleNo= :AisleNo,@ShuttleID= :ShuttleID,@BinID= :BinID,@load= :load`, {
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
                }),
                //alarmHistoryModel.findAll({ where: { AlarmAckTime: null, IsReset: 0 } })
            ]);

            const InwardDetails = {
                Aisle1IN: result[0].filter(item => item.ReqType == 'Store' && item.Status == 'Completed' && item.AisleNo == 1).length,
                Aisle2IN: result[0].filter(item => item.ReqType == 'Store' && item.Status == 'Completed' && item.AisleNo == 2).length,
                Aisle3IN: result[0].filter(item => item.ReqType == 'Store' && item.Status == 'Completed' && item.AisleNo == 3).length,
                Aisle4IN: result[0].filter(item => item.ReqType == 'Store' && item.Status == 'Completed' && item.AisleNo == 4).length,
                Aisle1OUT: result[0].filter(item => item.ReqType == 'Retrieval' && item.Status == 'Completed' && item.AisleNo == 1).length,
                Aisle2OUT: result[0].filter(item => item.ReqType == 'Retrieval' && item.Status == 'Completed' && item.AisleNo == 2).length,
                Aisle3OUT: result[0].filter(item => item.ReqType == 'Retrieval' && item.Status == 'Completed' && item.AisleNo == 3).length,
                Aisle4OUT: result[0].filter(item => item.ReqType == 'Retrieval' && item.Status == 'Completed' && item.AisleNo == 4).length,
            }
            // const alarmDetails = alarmStatusList.map(alarm => ({ ...alarm.dataValues, ErrorDescription: alarm.dataValues.AlarmText }));
            // const alarmCount = alarmDetails.length;

            const data = {
                status: 1,
                message: '',
                tableData:tableData[0],
                //alarmDetails,
                //currentProcessData,
                //alarmCount,
                InwardDetails
            };

            if (JSON.stringify(data) !== JSON.stringify(previousResponseData)) 
            {
                res.write(`data: ${JSON.stringify(data)}\n\n`);
                previousResponseData = data;
            }
        } catch (error) {
            res.write(`event: error\ndata: ${JSON.stringify({ status: 0, message: 'Internal Server Error' })}\n\n`);
        }
    };

    await getTVDisplay();
    const intervalId = setInterval(getTVDisplay, 7000);

    const cleanup = () => {
        clearInterval(intervalId);
        res.end();
    };

    req.on('close', cleanup);
    res.on('error', cleanup);
});

//LiveTracking
app.get('/liveTracking', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
 
    let lastLiveDetails = null;
 
    const sendLiveTrackingDetails = async () => {
        try {
            const { Floor } = req.query;
            const EquipmentNo = Floor || 1;
 
            // Fetch live tracking data
            const liveTracking = await KEPGroundConveyorStatus.findAll({
                where: {
                    EquipmentNo,
                    ConveyorName: { [Op.in]: ["U1F", "U2F", "U3F", "U4F"] },
                },
                tableHint: TableHints.NOLOCK
            });
 
            // Fetch retrieval confirmation data
            const retrievalConfirmation = await RetrievalConfirmation.findAll({
                where: {
                    Floor: EquipmentNo,
                    Status: { [Op.in]: ["G", "P","W"] },
                },
                tableHint: TableHints.NOLOCK
            });
 
            //Station Data
            const masterStation = await sequelize.query(`select ST_Code,StationAssigned,OrderNo from Master_Station_Conveyor  WITH (NOLOCK) where Floor ='${EquipmentNo}' `)
            let lastRetrieveData = await sequelize.query(`
             WITH RankedRetrievals AS (
                            SELECT *,
                                    ROW_NUMBER() OVER (
                                    PARTITION BY FLOOR, GTPPickingStation
                                    ORDER BY UpdateDateTime DESC
                                    ) AS rn
                            FROM RetrievalConfirmation  WITH (NOLOCK)
                            WHERE
                             Status IN ('P', 'C')
                            ) SELECT * FROM RankedRetrievals WHERE rn = 1 AND Floor = '${EquipmentNo}';
                        `)
            lastRetrieveData = lastRetrieveData[0]
           
            //DataFormatting
            let retrievalConfirmationData = []
            retrievalConfirmation.forEach((record) => {
                const data = record.dataValues;
                retrievalConfirmationData.push(data)
            })
 
            let liveTrackingData = []
            liveTracking.forEach((record) => {
                const data = record.dataValues;
                liveTrackingData.push(data)
            })      
 
            let MasterData = masterStation[0]
            // Combine data for comparison and output
            const combinedData = { liveTrackingData, retrievalConfirmationData, MasterData, lastRetrieveData };
 
            // Send data only if there's a change
            if (JSON.stringify(combinedData) !== JSON.stringify(lastLiveDetails)) {
                lastLiveDetails = combinedData;
                res.write(`data: ${JSON.stringify(combinedData)}\n\n`);
            }
        }
        catch (error)
        {
            res.write(
                `event: error\ndata: ${JSON.stringify({
                    message: "Failed to fetch live tracking data",
                    error: error.message,
                })}\n\n`
            );
        }
    };
 
    // Send initial data
    await sendLiveTrackingDetails();
 
    // Schedule periodic updates
    const intervalId = setInterval(sendLiveTrackingDetails, 1000);
 
    const cleanup = () => {
        clearInterval(intervalId);
        res.end();
    };
 
    // Cleanup on client disconnect or error
    req.on("close", cleanup);
    res.on("error", cleanup);
});

//EquipmentStatus
app.get('/equipmentStatus', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let lastEquipmentDetails = '';

    // Function to fetch and send storage details if there are changes
    const sendEquimentDetails = async () => {
        try 
        {
            let status = 0;
            let message = "Invalid Request";
             
            // Execute the stored procedure
            const result = await sequelize.query(
                'EXEC SP_getEquipment @Type = :type, @AisleID = :AisleID, @EquipmentNo = :EquipmentNo', 
                {
                    replacements: { 
                        type: req.query.type,
                        AisleID: (parseInt(req.query.AisleNo) ?? 1),
                        EquipmentNo: (parseInt(req.query.EquipmentNo) ?? 1)
                    },
                    type: 'SELECT'  // Ensure the correct type is used
                }
            );

            let conveyorStatus = ''
            if(req.query.type == 'BufferConveyorStatus')
            {                
                
                if(req.query.AisleNo == 1)
                {
                    conveyorStatus = await sequelize.query(`SELECT TOP(3) EquipmentNo,EquipmentType,AddressType,AddressIndex,AddressIndexText,AddressValue FROM WCSModbus_4000Register WITH (NOLOCK)`)
                }
                else if(req.query.AisleNo == 2)
                {
                    conveyorStatus = await sequelize.query(`SELECT TOP(3) EquipmentNo,EquipmentType,AddressType,AddressIndex,AddressIndexText,AddressValue FROM WCSModbus_4000Register_Eq2 WITH (NOLOCK)`)
                }
                else if(req.query.AisleNo == 3)
                {
                    conveyorStatus = await sequelize.query(`SELECT TOP(3) EquipmentNo,EquipmentType,AddressType,AddressIndex,AddressIndexText,AddressValue FROM WCSModbus_4000Register_Eq3 WITH (NOLOCK)`)
                }
            }

            // Check if the result is returned
            if (result && result.length > 0) 
            {
                status = 1;
                // Check if there are changes in the store details
                if (JSON.stringify(result[0]) !== JSON.stringify(lastEquipmentDetails)) 
                {
                    lastEquipmentDetails = result[0]
                    //RetrievalData:${JSON.stringify(RetrievalConfrimation)}
                    res.write(`data: ${JSON.stringify(result[0])}\n\n`);
                }
            } 
            else 
            {
                res.write('event: error\ndata: An error occurred while fetching data\n\n');
            }
        } 
        catch (error) 
        {
            res.write('event: error\ndata: An error occurred while fetching data\n\n');
        }
    };

    // Send initial data
    await sendEquimentDetails();

    // Send a message every 900 milliseconds
    const intervalIdEquipment = setInterval(sendEquimentDetails, 1000);

    // Cleanup on client disconnect
    req.on('close', () => {
        clearInterval(intervalIdEquipment);
        res.end();
    });

    // Ensure response is properly ended on error
    res.on('error', (err) => {
        clearInterval(intervalIdEquipment);
    });
});

//Picking Screen
app.get('/getPickingScreenData', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let lastBinID = '';
    // Function to fetch all necessary data in parallel
    const fetchPickingDetails = async () => {
        try 
        {
            const Floor = parseInt(req.query.Floor);
            let Station = parseInt(req.query.Station.replace('ST', ''));
        
            if (Floor === 2) Station -= 4;
            else if (Floor === 3) Station -= 8;
        
            // Fetch bin lists
            const retrievalBinList = await RetrievalConfirmation.findAll({
                where: { Floor, GTPPickingStation: Station, status: 'P', PickCategory: { [Op.not]: 'STK' } },
                tableHint: TableHints.NOLOCK
            });

            // Check for updates
            if (retrievalBinList.length > 0) 
            {
                //if(lastBinID !== retrievalBinList[0].dataValues.BinID)
                {
                    lastBinID = retrievalBinList[0].dataValues.BinID;
                    let sec = moment().seconds()
                    const responseData = {
                        BinID: retrievalBinList[0].dataValues.BinID,
                        HB: sec
                    };
            
                    res.write(`data: ${JSON.stringify(responseData)}\n\n`);
                }
            } 
            else if (retrievalBinList.length == 0)
            {
                lastBinID = '';
                let sec = moment().seconds()
                const emptyResponse = { BinID: '', HB: sec };
                res.write(`data: ${JSON.stringify(emptyResponse)}\n\n`);
            }
        } 
        catch (error) 
        {
            res.write(
                `event: error\ndata: ${JSON.stringify({
                    message: "Failed to fetch picking screen data",
                    error: error.message,
                })}\n\n`
            );
        }
    };

    // Send initial data
    await fetchPickingDetails();

    // Schedule periodic updates
    const intervalId = setInterval(fetchPickingDetails, 800);

    const cleanup = () => {
        clearInterval(intervalId);
        res.end();
    };

    // Cleanup on client disconnect or error
    req.on('close', cleanup);
    res.on('error', cleanup);
});


//StockAdjustment Screen
app.get('/getStockAdjustmentScreenData', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let lastBinID = '';
    const sendPickingDetails = async () => {
        try 
        {
            const Floor = parseInt(req.query.Floor);
            let Station = parseInt(req.query.Station.replace('ST', ''));
            if (Floor === 2) Station -= 4;
            else if (Floor === 3) Station -= 8;

            // Fetch bin lists
            const retrievalBinList = await RetrievalConfirmation.findAll({
                where: { Floor: Floor, GTPPickingStation: Station, Status: 'P', PickCategory: 'STK'},
                tableHint: TableHints.NOLOCK
            });

            // Check for updates
            if (retrievalBinList.length > 0 && lastBinID !== retrievalBinList[0].dataValues.BinID) 
            {
                lastBinID = retrievalBinList[0].dataValues.BinID;
                const retrievalBin = [retrievalBinList[0].dataValues];
    
                let Inv_PalletDetails = await InvPalletDetails.findAll({where: {BinID: lastBinID},tableHint: TableHints.NOLOCK})

                const partList = await MasterPart.findAll({
                    attributes: ['ItemCode', 'Color'],
                    tableHint: TableHints.NOLOCK
                });

                const partCodes = partList.map((item) => ({
                    ItemCode: item.ItemCode,
                    Color: item.Color,
                }));

                const coloredOrders = Inv_PalletDetails.map((orderList) => {
                    const order = orderList;
                    const matchingPart = partCodes.find(
                        (part) => part.ItemCode === order.itemCode
                    );
                    return {
                        ...order,
                        color: matchingPart ? matchingPart.Color : '#FFFFFF',
                    };
                });

                const coloredBins = retrievalBin.map((binList) => {
                    const matchingPart = partCodes.find(
                        (part) => part.ItemCode === binList.itemCode
                    );
                    return {
                        ...binList,
                        color: matchingPart ? matchingPart.Color : '#FFFFFF',
                    };
                });

                const responseData = {
                    orderList: coloredOrders,
                    binList: coloredBins
                };
        
                res.write(`data: ${JSON.stringify(responseData)}\n\n`);
            } 
            else if (retrievalBinList.length === 0) 
            {
                lastBinID = '';
                const emptyResponse = { orderList: [], binList: [], remarks: [] };
                res.write(`data: ${JSON.stringify(emptyResponse)}\n\n`);
            }
        } 
        catch (error) 
        {
            res.write(
                `event: error\ndata: ${JSON.stringify({
                    message: "Failed to fetch picking screen data",
                    error: error.message,
                })}\n\n`
            );
        }
    };

    // Send initial data
    await sendPickingDetails();

    // Schedule periodic updates
    const intervalId = setInterval(sendPickingDetails, 1000);

    const cleanup = () => {
        clearInterval(intervalId);
        res.end();
    };

    // Cleanup on client disconnect or error
    req.on('close', cleanup);
    res.on('error', cleanup);
});

// OverAll Equipment Status
app.get('/getEquipmentStatusData', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
 
    let lastResponseData = null; // Store last sent data
 
    const getEquipmentStatusData = async () => {
        try {
            // Query 1: Fetch KEP_MLS_EquipmentStatus
            const equipmentStatus = await sequelize.query(
                `SELECT AisleID, ShuttleID, EquipmentHeartBeat, Ready,CurrentMode FROM KEP_MLS_EquipmentStatus WITH (NOLOCK)`,
                { type: sequelize.QueryTypes.SELECT }
            );
 
            // Query 2: Fetch KEP_TL_Totelift_Status with JOIN
            const toteliftStatus = await sequelize.query(
                `SELECT TLS.EquipmentHeartbeat, TLS.AisleNo, TLS.Ready, TLS.CurrentMode,
                        TLS.Carriage1BinID1, TLS.Carriage1BinID2, TLS.Carriage2BinID1, TLS.Carriage2BinID2,
                        TLS.Carriage3BinID1, TLS.Carriage3BinID2, TLS.Carriage4BinID1, TLS.Carriage4BinID2,
                        TLM.Ready AS MonitorReady, TLM.CurrentMode AS MonitorMode, TLM.InError
                 FROM KEP_TL_Totelift_Status TLS WITH (NOLOCK)
                 LEFT JOIN KEP_TL_ToteliftStatusMonitor TLM ON TLM.AisleNo = TLS.AisleNo`,
                { type: sequelize.QueryTypes.SELECT }
            );
 
            // Query 3: Fetch KEP_TL_BufferConveyor_Status
            const bufferConveyorStatus = await sequelize.query(
                `SELECT * FROM KEP_TL_BufferConveyor_Status WITH (NOLOCK)`,
                { type: sequelize.QueryTypes.SELECT }
            );
 
            // Construct new response
            const newResponseData = {
                equipmentStatus,
                toteliftStatus,
                bufferConveyorStatus
            };
 
            // Convert to JSON string for comparison
            const newResponseString = JSON.stringify(newResponseData);
 
            // **Check if data has changed before sending**
            if (lastResponseData !== newResponseString) {
                lastResponseData = newResponseString; // Update last sent data
                res.write(`data: ${newResponseString}\n\n`);
            }
        } catch (error) {
            console.error("Error fetching Equipment Status data:", error);
            res.write(
                `event: error\ndata: ${JSON.stringify({
                    message: "Failed to fetch Equipment Status data",
                    error: error.message,
                })}\n\n`
            );
        }
    };
 
    // Send initial data
    await getEquipmentStatusData();
 
    // Schedule periodic updates every 1 second
    const intervalId = setInterval(getEquipmentStatusData, 800);
 
    const cleanup = () => {
        clearInterval(intervalId);
        res.end();
    };
 
    // Cleanup on client disconnect or error
    req.on('close', cleanup);
    res.on('error', cleanup);
});

const PORT = process.env.PORT || 3300//8083;

// Use server variable to listen instead of app
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
