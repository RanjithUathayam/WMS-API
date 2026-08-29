/*
    RightsMenuList seed rows for the Location Master / Location Mapping workflow.
    Database: [WMS_NEW].[dbo]

    Same format/guard as sql/RightsMenuList_Data.sql (safe to run multiple times — skips any
    pattern that already exists). Kept as a separate file rather than appended to
    RightsMenuList_Data.sql so it can be reviewed/run independently.

    Includes two patterns that were already referenced in authenticateToken.js's moduleNames
    (endpoints '/pallet', '/complete' under Pallet Mapping) but were never seeded here — meaning
    no non-Admin user could ever be granted Pallet Mapping access via the admin Rights UI. Adding
    them now closes that pre-existing gap on the same Prebinning -> Pallet Mapping -> Location
    Mapping -> Inventory path this feature depends on.
*/

INSERT INTO dbo.RightsMenuList (module, sub_module, lists, creates, modifies, deletes, exports, pattern, IsDelete, createdAt)
SELECT v.module, v.sub_module, v.lists, v.creates, v.modifies, v.deletes, v.exports, v.pattern, 0, GETDATE()
FROM (VALUES
    -- ===================== Pallet Mapping (pre-existing gap, closed here) =====================
    ('Pallet Mapping', 'Pallet / Box Validate & View',      1,0,0,0,0, 'palletMapping_list'),
    ('Pallet Mapping', 'Box Add / Pallet Complete',         0,1,0,0,0, 'palletMapping_creates'),

    -- ===================== Location Master =====================
    ('Location Master', 'Warehouse / Row / Position / Details List', 1,0,0,0,0, 'locationMaster_list'),
    ('Location Master', 'Create Location / Generate Positions',      0,1,0,0,0, 'locationMaster_creates'),
    ('Location Master', 'Update / Activate / Deactivate Location',   0,0,1,0,0, 'locationMaster_modifies'),

    -- ===================== Location Mapping =====================
    ('Location Mapping', 'Map Pallet To Location',          0,1,0,0,0, 'locationMapping_creates')
) AS v(module, sub_module, lists, creates, modifies, deletes, exports, pattern)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.RightsMenuList r WHERE r.pattern = v.pattern
);
GO
