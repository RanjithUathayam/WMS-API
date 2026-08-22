const { Op } = require('sequelize');
const moment = require('moment');
const { sequelize } = require('../config/database');
const userManagement = require('../models/master/UserManagement');
const RightsList = require('../models/master/RightsList');
const { TableHints } = require('sequelize');

const formattedUpdateDateTime = sequelize.literal("CONVERT(VARCHAR(10), UpdateDateTime, 103) + ' ' + CONVERT(VARCHAR(5), UpdateDateTime, 108)");

const modelFieldsMap = { 
    MasterPart: ['id', 'ItemCode', 'ItemName', 'ItemGroup', 'Category', 'Description', 'Color', 'Size', 'Style', 'BinCapacity', 'Field1', 'Field2', 'Field3', 'CreatedDate', 'CreatedBy', 'UpdatedDate', 'UpdatedBy', 'DeletedDate', 'DeletedBy', 'ActivatedDate', 'ActivatedBy', 'isActive', [sequelize.literal('(case when isDelete=0 then 1 else 0 end)'), 'Status']],
    MasterBin: ['AliasBinID', 'BinID', 'BinStatus','CreatedDate', 'CreatedBy', 'UpdatedDate', 'UpdatedBy','DeletedDate','DeletedBy', 'ActivatedDate', 'ActivatedBy', 'isActive',[sequelize.literal('(case when isDelete=0 then 1 else 0 end)'), 'Status']],
    MasterReason:['id', 'ReasonID', 'ReasonDescription','CreatedDate', 'CreatedBy', 'UpdatedDate', 'UpdatedBy',[sequelize.literal('(case when isDelete=0 then 1 else 0 end)'), 'Status']],

    UserManagement: ['id','FullName','UserName', 'Pwd', 'UserGroup'],
    UserGroup:['Id', 'groupname', 'rights',[sequelize.literal('(case when IsDelete=0 then 1 else 0 end)'), 'Status']],
    errortable: ['id', 'EquipmentType','ErrorCode','ErrorDescription','UpdatedDate',[sequelize.literal('(case when IsDelete=0 then 1 else 0 end)'), 'Status']],
    RightsList: ['id','module','sub_module','lists','creates','modifies','deletes','exports','pattern']
};

const primaryFields = {
    MasterPart: ['id','ItemCode'],
    MasterBin: ['AliasBinID','BinID'], 
    MasterReason: ['id','ReasonID'],  

    UserGroup: ['Id','groupname'],
    UserManagement: ['id','UserName'],
    errortable: ['id','EquipmentType'],
};

async function tableHeader(type)
{
    const model = require(`../models/Table_Header`);
    const result = await model.findAll({ attributes: ['details'],where:{type:type}, tableHint: TableHints.NOLOCK});
    if(result && result[0].details){
      return result[0].details;
    } 
    else {
      return [];
    }
}

async function getAll(req, res) {
    try {
        const modelName = req.params.model;
        const model = require(`../models/master/${modelName}`);
        const fields = modelFieldsMap[modelName]; 
        let whereCondition={};
        if(modelName =='MasterPart')
        {
            const { ItemCode, ItemName, ItemGroup } = req.query
            // Add LIKE conditions only if the values are provided
            if (ItemCode) {
                whereCondition.ItemCode = { [Op.like]: `%${ItemCode}%` };
            }
            if (ItemName) {
                whereCondition.ItemName = { [Op.like]: `%${ItemName}%` };
            }
            if (ItemGroup) {
                whereCondition.ItemGroup = { [Op.like]: `%${ItemGroup}%` };
            }
        }

        if(modelName == 'MasterBin')
        {
            const { BinID, BinStatus } = req.query
            if (BinID) {
                whereCondition.BinID = { [Op.like]: `%${BinID}%` };
            }
            if (BinStatus) {
                whereCondition.BinStatus = { [Op.like]: `%${BinStatus}%` };
            }
        }
        // ,where:{IsDelete:0}
        const entities = await model.findAll({where:whereCondition, attributes: fields, limit: 500, tableHint: TableHints.NOLOCK});
        const headers=await tableHeader(modelName);
        res.status(200).json({status:1,message:"Lists",headers,data:entities});
    } 
    catch (error) {
        res.status(202).json({status: 0, message: error.message});
    }
}

async function ExportMaster(req, res) {
    try {
        const modelName = req.params.model;
        let exportFormat = req.params.exportFormat;
        const model = require(`../models/master/${modelName}`);
        const fields = modelFieldsMap[modelName]; 
        const headers=await tableHeader(modelName);
        const results = await model.findAndCountAll({ attributes: fields, tableHint: TableHints.NOLOCK })
        if (results) 
        {
            if(exportFormat == '')
            {
                res.status(200).json({ status: 1, message: "Lists", totalCount: results.count, headers, data: results.rows });
            }
            else
            {
                const {exportData} = require('../models/Export');
                await exportData(res,exportFormat,`Master ${modelName} Report`, headers, results.rows);      
            }
        }
    } 
    catch (error) {
        res.status(202).json({status: 0, message: error.message});
    }
}

async function getById(req, res) {
    try {
        const modelName = req.params.model;
        const model = require(`../models/master/${modelName}`);
        const entityId = req.params.id;
        const entity = await model.findByPk({entityId, tableHint: TableHints.NOLOCK});
        if (!entity) {
            return res.status(404).json({ message: `${modelName} not found` });
        }
        res.json(entity);
    } catch (error) {
        res.status(202).json({status: 0, message: error.message});
    }
}

async function createEntity(req, res) {
    try {
        const modelName = req.params.model;
        const model = require(`../models/master/${modelName}`);
        // const primaryAttribute = model.primaryKeyAttribute;
        const existingEntity = await model.findOne({ where: { [primaryFields[modelName][1]]: req.body[primaryFields[modelName][1]] }, tableHint: TableHints.NOLOCK });

        if (existingEntity) 
        {
            return res.status(202).json({ status: 0, message: `${req.body[primaryFields[modelName]]} already exists` });
        }
        
        req.body.CreatedBy = req.user.UserName;

        const newEntity = await model.create(req.body);
        if(newEntity)
        {
            const fields = modelFieldsMap[modelName];
            const entities = await model.findAll({ attributes: fields, tableHint: TableHints.NOLOCK });
            const headers= await tableHeader(modelName);
            res.status(202).json({status:1,message:"Added Successfully",headers, data:entities});
        }
        else
        {
            res.status(202).json({status:0,message:"Error while adding"});
        }
    } 
    catch (error) {
        res.status(202).json({status: 0, message: error.message});
    }
}

async function updateEntity(req, res) {
    try {
        const modelName = req.params.model;
        const primaryKeys=primaryFields[modelName];
        const model = require(`../models/master/${modelName}`);
        const entityId = req.params.id;
        req.body.UpdatedDateTime=sequelize.literal('GETDATE()');
        
        const [rowsUpdated, updatedEntities] = await model.update(req.body, {
            where: { [primaryKeys[0]]: entityId },
            returning: true,
        })

        if (rowsUpdated === 0) 
        {
            return res.status(205).json({status:0, message: `Error on creating ${modelName}` });
        }

        const fields = modelFieldsMap[modelName]; // Get fields based on model
        // where:{IsDelete:0}
        const entities = await model.findAll({ attributes: fields, tableHint: TableHints.NOLOCK });
        const headers=await tableHeader(modelName);
        res.json({status:1,message:`Updated Successfully`,headers,data:entities});
    } catch (error) {
        res.status(202).json({status: 0, message: error.message});
    }
}

async function deleteEntity(req, res) {
    try {
        const modelName = req.params.model;
        const model = require(`../models/master/${modelName}`);
        const entityId = req.params.id;
        // const rowsDeleted = await model.destroy({
        //     where: { Id: entityId },
        // });

        // if (rowsDeleted === 0) {
        //     return res.status(404).json({ message: `${modelName} not found` });
        // }

        // res.json({ message: `${modelName} deleted successfully` });
        const [rowsUpdated, updatedEntities] = await model.update({IsDelete:1}, {
            where: { Id: entityId },
            returning: true,
        });
        // await model.update({ UpdatedDateTime: sequelize.literal('GETDATE()') }, { where: { id: entityId } });
        if (rowsUpdated === 0) {
            return res.status(404).json({status:0, message: `Error on deleting ${modelName}` });
        }
        const fields = modelFieldsMap[modelName]; // Get fields based on model
        const entities = await model.findAll({ attributes: fields,where:{IsDelete:0}, tableHint: TableHints.NOLOCK });
        const headers=await tableHeader(modelName);
        res.json({status:1,message:`Deleted Successfully`,headers,data:entities});
    } catch (error) {
        res.status(202).json({status: 0, message: error.message});
    }
}

async function executeStoredProcedure(req,res) {
    try 
    {
        const result = await sequelize.query('EXEC SP_AlarmHistory @type = :type, @FromDate= :FromDate,@ToDate= :ToDate,@CraneID= :CraneID,@EquipmentType= :EquipmentType,@Contype= :Contype,@AlarmType= :AlarmType, @errorcode = :errorcode', {
            replacements: { type: 'Search',FromDate:'2022-01-01',ToDate:'2024-01-01',CraneID:"All",EquipmentType:"All",Contype:"",AlarmType:"Active", errorcode: '' },
            type: sequelize.QueryTypes.SELECT
        });
        return res.status(404).json({status:0, data:result });
    } 
    catch (error) 
    {
      console.error('Error executing stored procedure:', error);
    }
}

module.exports = {
    getAll,
    getById,
    createEntity,
    updateEntity,
    deleteEntity,
    executeStoredProcedure,
    ExportMaster,
};

