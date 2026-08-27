INSERT INTO dbo.RightsMenuList (module, sub_module, lists, creates, modifies, deletes, exports, pattern, IsDelete, createdAt)
SELECT v.module, v.sub_module, v.lists, v.creates, v.modifies, v.deletes, v.exports, v.pattern, 0, GETDATE()
FROM (VALUES
    -- ===================== Master =====================
    ('Master', 'Bin Master',            1,1,1,1,1, 'master_Bin_list'),
    ('Master', 'Item Master',           1,1,1,1,1, 'master_item_list'),
    ('Master', 'Reason Master',         1,1,1,1,1, 'master_reason_list'),
    ('Master', 'Error Master',          1,1,1,1,1, 'error_master'),
    ('Master', 'HHT Master',            1,1,1,1,1, 'master_hht_list'),            -- NEW: models/master/MasterHHT.js, no moduleNames entry yet
    ('Master', 'Station Master',        1,1,1,1,1, 'master_station_list'),        -- NEW: models/master/MasterStation.js, no moduleNames entry yet

    -- ===================== User =====================
    ('User', 'User Group',              1,1,1,1,1, 'user_group_list'),
    ('User', 'User Master',             1,1,1,1,1, 'user_master_list'),
    ('User', 'User Rights',             1,0,1,0,0, 'user_rights_list'),           -- NEW: models/master/RightsList.js, no moduleNames entry yet

    -- ===================== Pre-Binning =====================
    ('Pre-Binning', 'GRN / Warehouse List',        1,0,0,0,1, 'preBinning_list'),
    ('Pre-Binning', 'Bin Complete / Box Scan',      0,1,0,0,0, 'preBinning_creates'),

    -- ===================== Label Print =====================
    ('Label Print', 'Label Print Config',           1,0,0,0,1, 'labelPrint_list'),
    ('Label Print', 'Label Print Job / Reserve',    0,1,0,0,0, 'labelPrint_creates'),

    -- ===================== Transaction =====================
    ('Transaction', 'Item Transaction / Inventory',       1,0,0,0,1, 'transaction_item_list'),
    ('Transaction', 'Pallet Request List',                 1,0,0,0,1, 'transaction_binrequest_list'),
    ('Transaction', 'Totelift Request List',               1,0,0,0,1, 'transaction_toteliftRequest_list'),
    ('Transaction', 'Orderwise Bin Summary',               1,0,0,0,1, 'transaction_orderwiseBinSummary_list'),
    ('Transaction', 'Retrieval Confirmation',              1,0,0,0,1, 'transaction_retrievalConfirmation_list'),
    ('Transaction', 'OEE Transaction',                     1,0,0,0,1, 'transaction_oeeTransaction_list'),
    ('Transaction', 'Order Processing Summary',            1,0,0,0,1, 'transaction_orderProcessingSummary_list'),
    ('Transaction', 'Pre-Binning Summary',                 1,0,0,0,1, 'transaction_prebinningSummary_list'),

    -- ===================== Inventory =====================
    ('Inventory', 'Inventory List',                        1,0,0,0,1, 'inventory_item_list'),

    -- ===================== History =====================
    ('History', 'Alarm History',                           1,0,0,0,1, 'history_alarm_list'),
    ('History', 'Rejected Pallet History',                 1,0,0,0,1, 'history_rejectedbin_list'),
    ('History', 'Maintenance History',                     1,0,0,0,1, 'history_maintenance_list'),
    ('History', 'User Log History',                        1,0,0,0,1, 'history_userlog_list'),
    ('History', 'Expiry Alert History',                    1,0,0,0,1, 'history_expiryalert_list'),
    ('History', 'Storage / Retrieval History',              1,0,0,0,1, 'history_storageretrival_list'),
    ('History', 'User Entry Log',                           1,0,0,0,1, 'history_userentryLog_list'),

    -- ===================== Operation =====================
    ('Operation', 'Storage Excel Upload',                  1,0,0,0,1, 'operation_store_list'),
    ('Operation', 'Storage Details List',                  1,0,0,0,1, 'operation_storedetails_list'),
    ('Operation', 'Pallet Relocation',                      1,1,0,0,1, 'operation_relocation_list'),
    ('Operation', 'Retrieval / Retrieve Summary',           1,0,0,0,1, 'operation_retrive_list'),
    ('Operation', 'Retrieval Add',                          0,1,0,0,0, 'operation_retrive_creates'),
    ('Operation', 'BinWise Retrieval',                      1,0,1,0,1, 'operation_binWiseRetrieval_list'),
    ('Operation', 'Stock Adjustment List',                  1,0,0,0,1, 'operation_stockadjustment_list'),
    ('Operation', 'Stock Adjustment Update',                0,0,1,0,0, 'operation_stockadjustment_modifies'),
    ('Operation', 'Stock Adjustment Request',               0,1,0,0,0, 'operation_stockadjustment_creates'),
    ('Operation', 'Consolidation Bin List',                 1,0,0,0,1, 'operation_consolidationBin_list'),
    ('Operation', 'Consolidation Bin Retrieval',            0,1,0,0,0, 'operation_consolidationBin_creates'),
    ('Operation', 'Empty Bin List',                         1,0,0,0,1, 'operation_emptybin_list'),
    ('Operation', 'Empty Bin Store / Request',              0,1,0,0,0, 'operation_emptybin_creates'),
    ('Operation', 'Picking',                                1,0,1,0,1, 'operation_Picking_list'),
    ('Operation', 'TV Display',                             1,0,0,0,0, 'operation_tvDisplay_list'),
    ('Operation', 'Pre-Binning Approve List',               1,0,0,0,1, 'operation_preBinningApprove_list'),
    ('Operation', 'Pre-Binning Approve Status',             0,1,0,0,0, 'operation_preBinningApprove_creates'),
    ('Operation', 'Order Approval',                         1,0,0,0,1, 'operation_orderApproval_list'),
    ('Operation', 'BinWise Pre-Binning Reject',             1,0,0,0,1, 'operation_binwisePrebinningReject_list'),

    -- ===================== Status =====================
    ('Status', 'Location Status',                           1,0,0,0,1, 'status_location_list'),
    ('Status', 'Equipment Status',                          1,0,0,0,1, 'status_equipment_list'),
    ('Status', 'Live Tracking Display',                     1,0,0,0,0, 'status_liveTracking_list'),
    ('Status', 'Equipment Emergency',                       1,0,1,0,0, 'status_emergencyOperation_list'),
    ('Status', 'Location Maintenance',                      1,0,1,0,0, 'status_locationMaintenance_list'),
    ('Status', 'WCS Alarm',                                 1,0,1,0,1, 'status_wcsAlarm_list'),
    ('Status', 'WCS Alarm Cancel / Reset',                  0,1,0,0,0, 'status_wcsAlarm_creates'),
    ('Status', 'Auto Pallet Read',                          1,0,0,0,1, 'status_autoPalletRead_list'),
    ('Status', 'Ground Conveyor',                           1,0,0,0,1, 'status_groundConveyor_list'),
    ('Status', 'Conveyor Address Details',                  1,0,1,0,0, 'status_conveyorAddressDetails_list'),

    -- ===================== Equipment =====================
    ('Equipment', 'Load Station Buffer',                    1,0,0,0,0, 'equipment_loadStationBuffer_list'),
    ('Equipment', 'Unload Station Buffer',                  1,0,0,0,0, 'equipment_unloadStationBuffer_list'),
    ('Equipment', 'Lift Reached Bin',                       1,0,0,0,0, 'equipment_liftReachedBin_list'),
    ('Equipment', 'Load Conveyor Buffer',                   1,0,0,0,0, 'equipment_loadConveyorBuffer_list'),
    ('Equipment', 'MLS Send',                               1,0,0,0,0, 'equipment_mlsSend_list'),
    ('Equipment', 'ToteLift Send',                          1,0,0,0,0, 'equipment_toteLiftSend_list'),
    ('Equipment', 'Equipment Config',                       1,0,1,0,0, 'equipment_config_list'),
    ('Equipment', 'MLS AutoCommand Store',                  1,0,0,0,0, 'equipment_mlsAutoCommandStore_list'),
    ('Equipment', 'MLS Error',                              1,0,0,0,0, 'equipment_mlsError_list'),
    ('Equipment', 'ToteLift Auto Cmd',                      1,0,0,0,0, 'equipment_toteliftAutoCmd_list'),
    ('Equipment', 'TL Error',                               1,0,0,0,0, 'equipment_tlError_list'),
    ('Equipment', 'MLS SemiAuto Cmd',                       1,0,0,0,0, 'equipment_mlsSemiAutoCmd_list'),
    ('Equipment', 'ToteLift SemiAuto Cmd',                  1,0,0,0,0, 'equipment_toteliftSemiAutoCmd_list'),
    ('Equipment', 'WCS Send Modbus',                        1,0,0,0,0, 'equipment_wcsSendModbus_list'),
    ('Equipment', 'Equipment Request Details',              1,0,0,0,0, 'equipment_requestdetails_list'),
    ('Equipment', 'MLS Movement',                           1,0,0,0,0, 'equipment_mlsMovement_list')
) AS v(module, sub_module, lists, creates, modifies, deletes, exports, pattern)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.RightsMenuList r WHERE r.pattern = v.pattern
);
GO
