const jwt = require('jsonwebtoken');
const User = require('./models/login/login')
const UserGroup = require('./models/master/UserGroup')
const APILog = require('./models/Api_Log')
const { sequelize } = require('./config/database');
const moment = require('moment');
const CustomerAPILog = require('./models/Customer_api_logs')
const { TableHints } = require('sequelize');

// Middleware function for token validation
const authenticateToken = async (req, res, next) => {
    if((req.url != '/ERPLogin') && (req.url != '/login') && (req.url != '/getPickStationData'))
    {
        const authHeader = req.headers['authenticatetoken'];
        const token = authHeader

        if (!token) 
        {
            return res.sendStatus(401); // Unauthorized if token is missing
        }
        
        try 
        {
            const decoded = await jwt.verify(token, 'CAL-WMS'); // Verify token

            // Use Sequelize to find user in the database
            const user = await User.findOne({ where: { id: decoded.userId },tableHint: TableHints.NOLOCK });
            const userRights = await UserGroup.findOne({ where: { groupname: user.dataValues.UserGroup.toLowerCase() },tableHint: TableHints.NOLOCK });
            req.user = user.dataValues; // Attach decoded user information to request object
            req.user.Rights = userRights.rights

            if (!user) 
            {
                return res.status(401).json({ status: 0, message:'Unauthorized if user is not found'}) ; // Unauthorized if user is not found
            }
        } 
        catch (error) 
        {
            return res.status(403).json({ status: 0, message:'Forbidden if token is invalid or expired'}) // Forbidden if token is invalid or expired
        }
        
        next();
    }
    else
    {
        next()
    }
};

  const moduleNames = [
    // Master
    { endpoint: '/MasterBin',pattern:'master_Bin_list', moduleName: 'Master Bin List',type:'List' },
    { endpoint: '/MasterPart',pattern:'master_item_list', moduleName: 'Master Item List',type:'List' },
    { endpoint: '/MasterReason',pattern:'master_reason_list', moduleName: 'Master Item List',type:'List' },
    
    //TODO
    { endpoint: '/ErrorTable',pattern:'error_master', moduleName: 'Error Table List',type:'List' },
    { endpoint: '/UserGroup',pattern:'user_group_list', moduleName: 'User Group List',type:'List' },
    { endpoint: '/UserManagement',pattern:'user_master_list', moduleName: 'User Group List',type:'List' },
    
    // HHT
    { endpoint: '/getPendingGRN',pattern:'preBinning_list', moduleName:'PreBinning GRN List', type:'List' },
    { endpoint: '/getGRNDetails',pattern:'preBinning_list', moduleName:'GRNDetails List', type:'List' },
    { endpoint: '/binComplete',pattern:'preBinning_creates', moduleName:'Bin Complete List', type:'add' },
    { endpoint: '/getGRNStatus',pattern:'preBinning_list', moduleName:'GRN Status List', type:'List' },
    { endpoint: '/completeItem',pattern:'preBinning_creates', moduleName:'GRN Item Complete', type:'add' },
    { endpoint: '/getBinDetails',pattern:'preBinning_creates', moduleName:'GRN Item Complete', type:'add' },
    { endpoint: '/giveDeviceRights',pattern:'preBinning_creates', moduleName:'GRN Item Complete', type:'add' },
    { endpoint: '/getDeveiceDetails',pattern:'preBinning_list', moduleName:'GRN Item Complete', type:'List' },
    { endpoint: '/getBinDetailsForRefilling',pattern:'preBinning_list', moduleName:'GRN Item Complete', type:'add' },
    { endpoint: '/updateRefilledBin',pattern:'preBinning_creates', moduleName:'GRN Item Complete', type:'add' },
    { endpoint: '/updateStock',pattern:'preBinning_creates', moduleName:'GRN Item Complete', type:'add' },

    // Pre-Binning box process (routes/preBinningRoutes.js, mounted at /api/pre-binning).
    // checkPermission() below only keys off the first path segment after the router's baseUrl, so
    // /box/validate, /box/complete and /box/:boxNumber/items all share this one '/box' entry.
    { endpoint: '/warehouses',pattern:'preBinning_list', moduleName: 'Pre-Binning Warehouses', type:'List' },
    { endpoint: '/warehouse-stock',pattern:'preBinning_list', moduleName: 'Pre-Binning Warehouse Stock', type:'List' },
    { endpoint: '/box',pattern:'preBinning_creates', moduleName: 'Pre-Binning Box', type:'add' },
    // NOTE: no entry added here for POST /item/scan — '/item' already exists below for
    // GET /api/transaction/item (Item Inventory List) and the two would collide (same first
    // segment). It intentionally falls through to that entry's 'transaction_item_list' pattern;
    // see the summary note to the team about this shared-name limitation in checkPermission().

    // Label Print Configuration & Printing (routes/labelPrintRoutes.js, mounted at /api/label-print).
    // '/job' covers both POST /job (create) and GET /job/:printJobId/preview — same first segment.
    { endpoint: '/config',pattern:'labelPrint_list', moduleName: 'Label Print Config', type:'List' },
    { endpoint: '/printers',pattern:'labelPrint_list', moduleName: 'Label Print Printers', type:'List' },
    { endpoint: '/job',pattern:'labelPrint_creates', moduleName: 'Label Print Job', type:'add' },
    { endpoint: '/print',pattern:'labelPrint_creates', moduleName: 'Label Print', type:'add' },
    { endpoint: '/retry',pattern:'labelPrint_creates', moduleName: 'Label Print Retry', type:'add' },

    // Label Reservation & Printing (routes/labelReservationRoutes.js, mounted at /api/label).
    // '/print' is already registered above for /api/label-print/print/:printJobId and is reused
    // here — checkPermission keys off the first path segment only, regardless of which router or
    // mount prefix the request came through, so both routes share the 'labelPrint_creates' pattern.
    { endpoint: '/reserveLabelNumbers',pattern:'labelPrint_creates', moduleName: 'Label Reserve Numbers', type:'add' },
    { endpoint: '/printers',pattern:'labelPrint_list', moduleName: 'Label Detect Printers', type:'List' },


    // transaction
    { endpoint: '/itemfilter',pattern:'transaction_item_list', moduleName: 'Item Transaction List',type:'List' },
    // { endpoint: '/checkAuth',pattern:'bin_request', moduleName: 'Pallet Request List',type:'List' },
    { endpoint: '/binRequest',pattern:'transaction_binrequest_list', moduleName: 'Pallet Request List',type:'List' },
    { endpoint: '/toteliftRequest',pattern:'transaction_toteliftRequest_list', moduleName: 'Totelift Request List',type:'List' },
    { endpoint: '/item',pattern:'transaction_item_list', moduleName: 'Item Inventory List',type:'List' },
    { endpoint: '/inventory',pattern:'inventory_item_list', moduleName: 'Inventory List',type:'List' },
    { endpoint: '/resetAlarm',pattern:'history_alarm_list', moduleName: 'Alarm Reset',type:'List' },
    { endpoint: '/searchAlarmHistory',pattern:'history_alarm_list', moduleName: 'Alarm History Search',type:'List' },
    { endpoint: '/rejectedHistory',pattern:'history_rejectedbin_list', moduleName: 'Rejected History List',type:'List' },
    { endpoint: '/maintenanceHistory',pattern:'history_maintenance_list', moduleName: 'Maintenance History List',type:'List' },
    { endpoint: '/userLog',pattern:'history_userlog_list', moduleName: 'User Log List',type:'List' },
    { endpoint: '/expiryAlert',pattern:'history_expiryalert_list', moduleName: 'Expiry Alert List',type:'List' },
    { endpoint: '/loadUnLoad',pattern:'history_storageretrival_list', moduleName: 'Load Unload List',type:'List' },

    { endpoint: '/storageExcelUpload',pattern:'operation_store_list', moduleName: 'Storage Excel Upload',type:'Add' },
    { endpoint: '/binRequestPageData',pattern:'operation_storedetails_list', moduleName: 'PageLoad Data',type:'List' },
    { endpoint: '/addNewBinStore',pattern:'', moduleName: 'Pallet Master Create',type:'Add' }, //TODO
    { endpoint: '/binRequestList',pattern:'', moduleName: 'Pallet Request Create',type:'Add' }, //TODO
    { endpoint: '/retrievalPageData',pattern:'', moduleName: 'PageLoad Data',type:'List' },
    { endpoint: '/relocationFromSideData',pattern:'operation_relocation_list', moduleName: 'relocation Pallete Detila',type:'List' },
    { endpoint: '/relocationToSideData',pattern:'operation_relocation_list', moduleName: 'Pallete relocation side Detila',type:'List' },
    { endpoint: '/palletRelocate',pattern:'operation_relocation_list', moduleName: 'Pallete Relocated',type:'Add' },
    
    { endpoint: '/getStorageDetailsData',pattern:'operation_storedetails_list', moduleName: 'Storage Details List',type:'List' },
    { endpoint: '/getERPRetrievalData',pattern:'operation_retrive_list', moduleName: 'Operation Retrival List',type:'List' },
    { endpoint: '/addPalletRequest',pattern:'operation_retrive_creates', moduleName: 'Operation Retrival add',type:'add' },
    { endpoint: '/updateRetriveQueueList',pattern:'operation_retrive_list', moduleName: 'Operation Retrival List',type:'List'},
    { endpoint: '/ScheduleQueueRequest',pattern:'operation_retrive_list', moduleName: 'Operation Retrival List',type:'List' },
    { endpoint: '/updateScheduleQueueList',pattern:'operation_retrive_list', moduleName: 'Operation Retrival List',type:'List' },
    
    { endpoint: '/getBinRetrievalData',pattern:'operation_binWiseRetrieval_list', moduleName: 'BinWiseRetrieval',type:'List' },
    { endpoint: '/unloadBin',pattern:'operation_binWiseRetrieval_list', moduleName: 'BinWiseRetrieval',type:'update' },

    // History - User Entry Log
    { endpoint: '/userEntryLog', pattern: 'history_userentryLog_list', moduleName: 'Expiry Alert List', type: 'List' },
    { endpoint: '/insertUserEntryLog', pattern: 'history_userentryLog_list', moduleName: 'Expiry Alert List', type: 'List' },

    //StockAdjustment
    { endpoint: '/stockadjustmentBin',pattern:'operation_stockadjustment_list', moduleName: 'Stock Adjustment List',type:'List' },
    { endpoint: '/updateStockAdjustment',pattern:'operation_stockadjustment_modifies', moduleName: 'Stock Adjustment Update',type:'update' },
    { endpoint: '/stockAdjustmentBinRequest',pattern:'operation_stockadjustment_creates', moduleName: 'Stock Adjustment Request',type:'add' },

    //ConsolidationBin
    { endpoint: '/consolidationBinPageData',pattern:'operation_consolidationBin_list', moduleName: 'Consolidation Bin List',type:'List' },
    { endpoint: '/consolidationBinRetrieval',pattern:'operation_consolidationBin_creates', moduleName: 'Consolidation Bin List',type:'List' },

    //EmptyBin
    { endpoint: '/EmptyBinStore',pattern:'operation_emptybin_creates', moduleName: 'Operation EmptyBin add',type:'add' },
    { endpoint: '/EmptyBinPageData',pattern:'operation_emptybin_list', moduleName: 'Operation EmptyBin List',type:'List' },
    { endpoint: '/getEmptyBinCount',pattern:'operation_emptybin_list', moduleName: 'Operation EmptyBin List',type:'List' },
    { endpoint: '/emptyBinRequest',pattern:'operation_emptybin_creates', moduleName: 'Operation EmptyBin add',type:'add'},
    //Status
    { endpoint: '/locationStatus',pattern:'status_location_list', moduleName: 'Location Status List',type:'List' },
    { endpoint: '/getLocationDetails',pattern:'status_location_list', moduleName: 'Location Status List',type:'List' },
    { endpoint: '/getLocationManualBinList',pattern:'status_location_list', moduleName: 'Location Status List',type:'List' },
    { endpoint: '/getLocationManualEntry',pattern:'status_location_list', moduleName: 'Location Status List',type:'List' },
    { endpoint: '/equipmentStatus',pattern:'status_equipment_list', moduleName: 'Equipment Status List',type:'List' },
    { endpoint: '/pickingId',pattern:'operation_Picking_list', moduleName: 'Picking ID List',type:'List' }, 
    { endpoint: '/pickingApproval',pattern:'operation_Picking_list', moduleName: 'Picking Approval',type:'List' },
    
    //TV Display
    { endpoint: '/tvDisplay',pattern:'operation_tvDisplay_list', moduleName: 'TV Display List',type:'List' },
    { endpoint: '/liveTracking',pattern:'status_liveTracking_list', moduleName: 'Live Tracking Display List',type:'List' },

    //Prebinning Approve
    {endpoint: '/PreBinningApprove',pattern:'operation_preBinningApprove_list', moduleName: 'Pre Binning Approve',type:'List'},
    {endpoint: '/PreBinApproveStatus',pattern:'operation_preBinningApprove_creates', moduleName: 'Pre Binning Approve',type:'add'},
    {endpoint: '/MoveToPreBinning',pattern:'operation_preBinningApprove_list', moduleName: 'Pre Binning Approve',type:'List'},

    //DEMO
    { endpoint: '/retrievalQueueMoveToPicking',pattern:'operation_retrive_list', moduleName: 'Operation Retrival List',type:'List' },

    //OrderwiseBin Summary
    { endpoint: '/orderwiseBinSummary',pattern:'transaction_orderwiseBinSummary_list', moduleName: 'Orderwise Bin Summary List',type:'List' },

    //Equipment    
    { endpoint: '/updateEmergencyScreenData',pattern:'status_emergencyOperation_list', moduleName: 'Equipment Emergency',type:'List' },
    {endpoint: '/updateEmergencyStationStart',pattern:'status_emergencyOperation_list', moduleName: 'Equipment Emergency',type:'List' },

    //OrderApproval
    {endpoint: '/orderApproval',pattern:'operation_orderApproval_list', moduleName: 'Order Approval',type:'List' }, 

    // Location Maintenance
    {endpoint: '/locationMaintenance',pattern:'status_locationMaintenance_list', moduleName: 'Location Maintenance',type:'List' },
    {endpoint: '/updateLocationMaintenance', pattern: 'status_locationMaintenance_list', moduleName: 'Location Maintenance',type:'List'},

    {endpoint: '/updateEmergencySemiautoCommand',pattern:'status_emergencyOperation_list', moduleName: 'Equipment Emergency',type:'List' },

    //Transaction-ERP Retrieval Confirmation
    {endpoint: '/getERPConfirmation', pattern: 'transaction_retrievalConfirmation_list', moduleName: 'Retrieval Confirmation', type: 'List'},

    //WCS Alarm
    {endpoint: '/getWCSAlarmData', pattern:'status_wcsAlarm_list', moduleName: 'WCS Alarm',type:'List' },
    {endpoint: '/dataCancelProcess', pattern:'status_wcsAlarm_creates', moduleName: 'WCS Alarm',type:'List' },
    {endpoint: '/BinPresent', pattern:'status_wcsAlarm_list', moduleName: 'WCS Alarm',type:'List' },
    {endpoint: '/dataCancelFreeLocation', pattern:'status_wcsAlarm_list', moduleName: 'WCS Alarm',type:'List' },
    { endpoint: '/binMoveConfirm',pattern:'operation_Picking_list', moduleName: 'Picking Approval',type:'update' },
    { endpoint: '/getPickingOrderBinDetails',pattern:'operation_Picking_list', moduleName: 'Picking Approval',type:'List' },
    {endpoint: '/wcsAlarmReset', pattern:'status_wcsAlarm_list', moduleName: 'WCS Alarm',type:'update' },

    // Autopallet read
    {endpoint: '/getAutoPalletData',pattern:'status_autoPalletRead_list', moduleName:'AutoPalletRead',type:'List'},
    {endpoint: '/getLoadStationBuffer', pattern: 'equipment_loadStationBuffer_list', moduleName: 'Load Station Buffer', type: 'List'},
    {endpoint: '/getUnloadStationBuffer', pattern: 'equipment_unloadStationBuffer_list', moduleName: 'UnLoad Station Buffer', type: 'List'},
    {endpoint: '/getLiftReachedBin', pattern: 'equipment_liftReachedBin_list', moduleName: 'Lift Reached Bin', type: 'List'},
    {endpoint: '/getLoadConveyorBuffer', pattern: 'equipment_loadConveyorBuffer_list', moduleName: 'Load Conveyor Buffer', type: 'List'},
    {endpoint: '/getWCSMLSSend', pattern: 'equipment_mlsSend_list', moduleName: 'MLS Send', type: 'List'},
    {endpoint: '/getWCSTLSend', pattern: 'equipment_toteLiftSend_list', moduleName: 'ToteLift Send', type: 'List'},
    { endpoint: '/getGroundConveyor', pattern: 'status_groundConveyor_list', moduleName: 'GroundConveyor', type: 'List'},
    {endpoint: '/addressDataLoad', pattern: 'status_conveyorAddressDetails_list', moduleName: 'ConveyorAddressDetails', type:'List'},
    {endpoint: '/addressDataLoadOpc', pattern: 'status_conveyorAddressDetails_list', moduleName: 'ConveyorAddressDetails', type:'List'},
    {endpoint: '/updateRegisterAddress', pattern: 'status_conveyorAddressDetails_list', moduleName: 'ConveyorAddressDetails', type:'List'},

     
    //equipment config
    {endpoint: '/getEquipmentData', pattern: 'equipment_config_list', moduleName: 'Equipment Config', type: 'List'},
    {endpoint: '/updateEquipmentData', pattern: 'equipment_config_list', moduleName: 'Equipment Config', type: 'List'},
    {endpoint: '/getEquipmentIPConfigData', pattern: 'equipment_config_list', moduleName: 'Equipment Config', type: 'List'},
    {endpoint: '/updateEquipmentIPConfigData', pattern: 'equipment_config_list', moduleName: 'Equipment Config', type: 'List'},
 
    //mls based
    {endpoint: '/getMLSAutocmdData', pattern: 'equipment_mlsAutoCommandStore_list', moduleName: 'MLS AutoCommand Store', type: 'List'},
    {endpoint: '/getMLSError', pattern: 'equipment_mlsError_list', moduleName: 'MLS Error', type: 'List'},
    {endpoint: '/getTLAutocmdData', pattern: 'equipment_toteliftAutoCmd_list', moduleName: 'ToteLift Auto Cmd', type: 'List'},
    {endpoint: '/getTLError', pattern: 'equipment_tlError_list', moduleName: 'TL Error', type: 'List'},
    {endpoint: '/getMLSSemiAutoCmd', pattern: 'equipment_mlsSemiAutoCmd_list', moduleName: 'MLS SemiAutoCmd', type: 'List'},
    {endpoint: '/getTLSemiAutoCmd', pattern: 'equipment_toteliftSemiAutoCmd_list', moduleName: 'Totelift SemiAutoCmd', type: 'List'},
    { endpoint: '/getWCSSendModbus', pattern: 'equipment_wcsSendModbus_list', moduleName: 'WCS Send Modbus', type: 'List'},
    {endpoint: '/getOrderApproval', pattern: 'operation_orderApproval_list', moduleName: 'OrderApproval', type: 'List'},
    { endpoint: '/getEquipmentRequest', pattern: 'equipment_requestdetails_list', moduleName: 'Equipment Request', type: 'List'},
    { endpoint: '/getCraneMovement', pattern: 'equipment_mlsMovement_list', moduleName: 'MLS Movement', type: 'List'},
    { endpoint: '/getStoreRetrieveSummary', pattern: 'transaction_oeeTransaction_list', moduleName: 'OEE Transaction', type: 'List'},
    { endpoint: '/getOrderProcessingSummary', pattern: 'transaction_orderProcessingSummary_list', moduleName: 'Order Processing Summary', type: 'List'},
    { endpoint: '/getPreBinningSummary', pattern: 'transaction_prebinningSummary_list', moduleName: 'Pre Binning Summary', type: 'List'},
    { endpoint: '/getRetrievalOrderData', pattern: 'operation_retrive_list', moduleName: 'Retrive Summary', type: 'List'},
    { endpoint: '/getRetrievalOrderDetails', pattern: 'operation_retrive_list', moduleName: 'Retrive Summary', type: 'List'},
    { endpoint: '/retrievalOrderStart', pattern: 'operation_retrive_list', moduleName: 'RetriveSummary', type: 'List'},
    { endpoint: '/orderReExecute', pattern: 'operation_retrive_list', moduleName: 'RetriveSummary', type: 'List'},
    { endpoint: '/retrievalOrderHold', pattern: 'operation_retrive_list', moduleName: 'Retrive Summary', type: 'List' },
    { endpoint: '/RetrievalOrderDetails', pattern: 'operation_retrive_list', moduleName: 'RetriveSummary', type: 'List' },
    {endpoint: '/binWisePreBinningReject', pattern: 'operation_binwisePrebinningReject_list', moduleName: 'BinWisePreBinningReject', type: 'List'},
    {endpoint: '/rejectPreBinning', pattern: 'operation_binwisePrebinningReject_list', moduleName: 'BinWisePreBinningReject', type: 'List'},

    {endpoint: '/getLiveStationDetails',pattern:'status_liveTracking_list', moduleName: 'Live Tracking Display List',type:'List' },
    { endpoint: '/getStoreRetrieveDashboard', pattern: 'transaction_oeeTransaction_list', moduleName: 'OEE Transaction', type: 'List'},
    { endpoint: '/getRetrieveReAssign', pattern: 'operation_retrive_list', moduleName: 'RetriveSummary', type: 'List' },
    {endpoint: '/getStationConfig', pattern: 'equipment_config_list', moduleName: 'Equipment Config', type: 'List'},
    {endpoint: '/updateStationConfig', pattern: 'equipment_config_list', moduleName: 'Equipment Config', type: 'List'},
    { endpoint: '/getPickingOrderDetails', pattern: 'operation_retrive_list', moduleName: 'RetriveSummary', type: 'List' }
  ];

  const moduleNotCheckNames = [
    { endpoint: '/createERPItemMaster',pattern:'', moduleName: 'ERP Item Master',type:'All Function' },
    {endpoint: '/createERPBinMaster', pattern:'', moduleName: 'ERP Bin Master',type:'All Function'},
    {endpoint: '/createERPPreBinning', pattern:'', moduleName: 'ERP Pre Binning',type:'All Function'},
    {endpoint: '/createERPRetrieval', pattern:'', moduleName: 'ERP Retrieval',type:'Retrieval'},
    {endpoint: '/createERPStockAdjustment', pattern:'', moduleName: 'ERP Retrieval',type:'Retrieval'},
    {endpoint: '/nextTrolley', pattern:'', moduleName: 'ERP NextTrolley',type:'Retrieval'},
    {endpoint: '/getTrolleyReprint', pattern:'', moduleName: 'ERP NextTrolley',type:'Retrieval'},
    {endpoint: '/getPendingTrolleyData', pattern:'', moduleName: 'ERP NextTrolley',type:'Retrieval'},
    {endpoint: '/getInventoryData', pattern:'', moduleName: 'ERP Inventory Details',type:'ERPList'},
    {endpoint: '/getGRNPushingList', pattern:'', moduleName: 'ERP GRN Pushing List',type:'ERPList'},
    {endpoint: '/getGRNPushingDetails', pattern:'', moduleName: 'ERP GRN Pushing Details',type:'ERPList'},
    {endpoint: '/createGRNPushingTransaction', pattern:'', moduleName: 'ERP GRN Pushing Transaction',type:'ERPAdd'},
  ]

    // Middleware function for permission verification
    function checkPermission(req, res, next) 
    {
        let endUrl=req.originalUrl;
        let entry=endUrl.replace(req.baseUrl,'');
        let endpoint=entry.split('/');

        if (endUrl.includes('?')) {
            let entry = endUrl.replace(req.baseUrl, '');
            entry = entry.split('?')[0];
            const endpointParts = entry.split('/');
            endpoint[1] = endpointParts.filter(part => part.trim() !== '').pop();
        }

        if((req.url != '/ERPLogin') && (req.url != '/login') && (req.url != '/getPickStationData'))
        {
            const erpModules = moduleNotCheckNames.find(module => (module.endpoint).toLowerCase() == ('/'+endpoint[1]).toLowerCase());
            
            if(!erpModules)
            {             
                const requestedModule = moduleNames.find(module => (module.endpoint).toLowerCase() == ('/'+endpoint[1]).toLowerCase());
                const premission = JSON.parse(req.user.Rights) ?? [];
                let foundPermission = []
                if(requestedModule)
                {
                    foundPermission = (premission.find(row => (row).trim().toLowerCase() === (requestedModule.pattern).trim().toLowerCase()) ?? []).length
                }
               
                if (!requestedModule) 
                {
                    return res.status(202).json({ status:0,message: 'Invalid request endpoint' });
                }
                else if (req.user.UserGroup=='Admin' || req.url.startsWith('/api/data'))
                {

                }
                else if((premission.length == 0) || (foundPermission == 0))
                {
                    return res.status(202).json({ status:0, message: 'You do not have permission to access this page' });        
                }   
            }
            next()
        }
        else
        {
            next()
        }
    }
  
    // Middleware function for logging API requests to the database
    function logAPIToDatabase(req, res, next) {
        //const RequestTime = sequelize.literal('GETDATE()');
        const startTime = new Date();
        let userID = req.user ? req.user['UserName'] || '0' : req.body.id || '0';
        const requestInfo = {
            URL: req.originalUrl,
            RequestedDateTime: sequelize.literal(`'${moment(startTime).format('YYYY-MM-DD HH:mm:ss.SSS')}'`),
            RequestBody: req.body,
            UserName: userID,
        };
   
        let originalWrite = res.write;
        let originalEnd = res.end;
        let responseBody = '';
   
        res.write = function (chunk, ...args) {
            responseBody += chunk;
            originalWrite.apply(res, [chunk, ...args]);
        };
   
        res.end = function (chunk, ...args) {
            if (chunk) {
                responseBody += chunk;
            }
            res.locals.responseBody = responseBody;
            originalEnd.apply(res, [chunk, ...args]);
        };
   
        res.once('finish', async () => {
            try {
                const duration = new Date() - startTime; 

                let endUrl=req.originalUrl;
                let entry=endUrl.replace(req.baseUrl,'');
                let endpoint=entry.split('/');
                const erpModules = moduleNotCheckNames.find(module => (module.endpoint).toLowerCase() == ('/'+endpoint[1]).toLowerCase());
            
                if(!erpModules)
                {  
                    await APILog.create({
                        ...requestInfo,
                        StatusCode: res.statusCode,
                        ResponseDateTime: sequelize.literal(`'${moment(startTime).format('YYYY-MM-DD HH:mm:ss.SSS')}'`),
                        ResponseBody: res.locals.responseBody || null,
                        Duration: duration
                    });
                }
                else
                {
                    await CustomerAPILog.create({
                        ...requestInfo,
                        StatusCode: res.statusCode,
                        ResponseDateTime: sequelize.literal(`'${moment(startTime).format('YYYY-MM-DD HH:mm:ss.SSS')}'`),
                        ResponseBody: res.locals.responseBody || null,
                        Duration: duration
                    });
                }
            } catch (error) {
                console.error('Error saving API log:', error);
            }
        });
   
        res.once('error', async (err) => {
            try {
                const duration = new Date() - startTime; 
                
                let endUrl=req.originalUrl;
                let entry=endUrl.replace(req.baseUrl,'');
                let endpoint=entry.split('/');
                const erpModules = moduleNotCheckNames.find(module => (module.endpoint).toLowerCase() == ('/'+endpoint[1]).toLowerCase());
            
                if(!erpModules)
                {  
                    await APILog.create({
                        ...requestInfo,
                        StatusCode: res.statusCode,
                        ResponseDateTime: sequelize.literal(`'${moment(startTime).format('YYYY-MM-DD HH:mm:ss.SSS')}'`),
                        ResponseBody: res.locals.responseBody || null,
                        Duration: duration
                    });
                }
                else
                {
                    await CustomerAPILog.create({
                        ...requestInfo,
                        StatusCode: res.statusCode,
                        ResponseDateTime: sequelize.literal(`'${moment(startTime).format('YYYY-MM-DD HH:mm:ss.SSS')}'`),
                        ResponseBody: res.locals.responseBody || null,
                        Duration: duration
                    });
                }
            } catch (error) {
                console.error('Error saving API log:', error);
            }
        });
   
        next();
    }
  
    // Apply middleware functions to the logAPIToDatabase middleware
    function authPermissionUserLog(req, res, next) {
        authenticateToken(req, res, () => {
            checkPermission(req, res, () => {
                logAPIToDatabase(req, res, next);
            });
        });
    }

module.exports = authPermissionUserLog;
