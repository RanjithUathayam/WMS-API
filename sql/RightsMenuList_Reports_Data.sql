/*
    RightsMenuList seed rows for the four new report screens (Pre-Binning, Pallet Mapping,
    Location Mapping, Inventory Details — routes/reportRoutes.js, mounted at /api/reports).
    Database: [WMS_NEW].[dbo]

    Same format/guard as sql/RightsMenuList_LocationMaster_Data.sql (safe to run multiple times —
    skips any pattern that already exists). Kept as a separate file so it can be reviewed/run
    independently. Not required to test as Admin (Admin bypasses the rights check entirely), only
    to grant these reports to non-Admin roles from the admin Rights UI.
*/

INSERT INTO dbo.RightsMenuList (module, sub_module, lists, creates, modifies, deletes, exports, pattern, IsDelete, createdAt)
SELECT v.module, v.sub_module, v.lists, v.creates, v.modifies, v.deletes, v.exports, v.pattern, 0, GETDATE()
FROM (VALUES
    ('Reports', 'Pre-Binning Report',       1,0,0,0,1, 'report_preBinning_list'),
    ('Reports', 'Pallet Mapping Report',    1,0,0,0,1, 'report_palletMapping_list'),
    ('Reports', 'Location Mapping Report',  1,0,0,0,1, 'report_locationMapping_list'),
    ('Reports', 'Inventory Details Report', 1,0,0,0,1, 'report_inventory_list')
) AS v(module, sub_module, lists, creates, modifies, deletes, exports, pattern)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.RightsMenuList r WHERE r.pattern = v.pattern
);
GO
