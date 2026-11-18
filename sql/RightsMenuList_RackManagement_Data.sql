/*
    RightsMenuList seed rows for Rack Management (Rack Store / Rack Picking).

    Same idempotent guard as sql/RightsMenuList_Data.sql (safe to run multiple times — skips any
    pattern that already exists). Patterns match authenticateToken.js moduleNames:
      - rackManagement_list    -> /rackwarehouses, /rackscan, /rackitem, /rackhistory (reads + scan validation)
      - rackManagement_creates -> /racksave (Store / Pick save, changes inventory)

    A user group needs BOTH patterns to operate the screen (it scans before it saves).
*/

INSERT INTO dbo.RightsMenuList (module, sub_module, lists, creates, modifies, deletes, exports, pattern, IsDelete, createdAt)
SELECT v.module, v.sub_module, v.lists, v.creates, v.modifies, v.deletes, v.exports, v.pattern, 0, GETDATE()
FROM (VALUES
    ('Rack Management', 'Rack Scan / Item Scan / History',  1,0,0,0,1, 'rackManagement_list'),
    ('Rack Management', 'Rack Store / Rack Picking Save',   0,1,0,0,0, 'rackManagement_creates')
) AS v(module, sub_module, lists, creates, modifies, deletes, exports, pattern)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.RightsMenuList r WHERE r.pattern = v.pattern
);
GO
