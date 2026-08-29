/*
    RightsMenuList seed rows for the CURRENT screen set only (post API cleanup):
    Login, Home, About, Developer/Table Config, User Control (User Control / Change Password /
    Device Management), Item Master, Location Master, User Entry Log, User Login Report,
    Inventory List, Pre-Binning Approval, Binwise Pre-Binning Reject, GRN Pushing,
    Pre-Binning Status, Label Print.

    Same idempotent guard as sql/RightsMenuList_Data.sql (safe to run multiple times — skips any
    pattern that already exists), so this can be run standalone even though every pattern below
    was already inserted by RightsMenuList_Data.sql / RightsMenuList_LocationMaster_Data.sql.

    NOTE — shared pattern, not a bug in this script: 'preBinning_list' / 'preBinning_creates' gate
    THREE unrelated screens at once (Device Management, Pre-Binning Status, and part of Location
    Master's warehouse/row/position reads), because authenticateToken.js's checkPermission()
    matches by first URL path segment only, and /getDeveiceDetails, /getGRNDetails, /warehouses and
    /warehouse all happen to share that one moduleNames entry. Granting a user group this pattern
    grants all three screens together; there is currently no way to grant just one.

    Login, Home, About, Developer/Table Config, Change Password and the User Rights popup need NO
    row here — their endpoints (/api, /api/data, /getPickStationData) aren't gated by
    authenticateToken.js at all. GRN Pushing needs no row either — its ERP endpoints sit in
    authenticateToken.js's moduleNotCheckNames list and are always allowed for any authenticated
    user, independent of rights.
*/

INSERT INTO dbo.RightsMenuList (module, sub_module, lists, creates, modifies, deletes, exports, pattern, IsDelete, createdAt)
SELECT v.module, v.sub_module, v.lists, v.creates, v.modifies, v.deletes, v.exports, v.pattern, 0, GETDATE()
FROM (VALUES
    -- ===================== User Control =====================
    ('User', 'User Group',                                 1,1,1,1,1, 'user_group_list'),
    ('User', 'User Master',                                1,1,1,1,1, 'user_master_list'),

    -- ===================== User Control - Device Management / Pre-Binning Status =====================
    -- Shared pattern — see header note.
    ('Pre-Binning', 'GRN / Warehouse List',                1,0,0,0,1, 'preBinning_list'),
    ('Pre-Binning', 'Bin Complete / Box Scan',              0,1,0,0,0, 'preBinning_creates'),

    -- ===================== Item Master =====================
    ('Master', 'Item Master',                              1,1,1,1,1, 'master_item_list'),

    -- ===================== Location Master =====================
    ('Location Master', 'Warehouse / Row / Position / Details List', 1,0,0,0,0, 'locationMaster_list'),
    ('Location Master', 'Create Location / Generate Positions',      0,1,0,0,0, 'locationMaster_creates'),
    ('Location Master', 'Update / Activate / Deactivate Location',   0,0,1,0,0, 'locationMaster_modifies'),

    -- ===================== User Entry Log / User Login Report =====================
    ('History', 'User Entry Log',                          1,0,0,0,1, 'history_userentryLog_list'),
    ('History', 'User Log History',                        1,0,0,0,1, 'history_userlog_list'),

    -- ===================== Inventory List =====================
    ('Inventory', 'Inventory List',                        1,0,0,0,1, 'inventory_item_list'),

    -- ===================== Pre-Binning Approval =====================
    ('Operation', 'Pre-Binning Approve List',               1,0,0,0,1, 'operation_preBinningApprove_list'),
    ('Operation', 'Pre-Binning Approve Status',             0,1,0,0,0, 'operation_preBinningApprove_creates'),

    -- ===================== Binwise Pre-Binning Reject =====================
    ('Operation', 'BinWise Pre-Binning Reject',             1,0,0,0,1, 'operation_binwisePrebinningReject_list'),

    -- ===================== Label Print =====================
    ('Label Print', 'Label Print Config',                   1,0,0,0,1, 'labelPrint_list'),
    ('Label Print', 'Label Print Job / Reserve',            0,1,0,0,0, 'labelPrint_creates')
) AS v(module, sub_module, lists, creates, modifies, deletes, exports, pattern)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.RightsMenuList r WHERE r.pattern = v.pattern
);
GO
