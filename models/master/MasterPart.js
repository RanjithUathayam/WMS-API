const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const MasterPart = sequelize.define('Master_Part', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        allowNull: false,
        autoIncrement: true,
    },
    ItemCode: {
        type: DataTypes.STRING(300),
        allowNull: false
    },
    ItemName: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    ItemGroup: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    Category: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    Description: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    Color: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    Size: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    Style: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    BinCapacity: {
        type: DataTypes.BIGINT,
        allowNull: true
    },
    Field1: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    Field2: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    Field3: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    isDelete: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    CreatedDate: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue:sequelize.literal('GETDATE()')
    },
    CreatedBy: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    UpdatedDate: {
        type: DataTypes.DATE,
        allowNull: true
    },
    UpdatedBy: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    DeletedDate: {
        type: DataTypes.DATE,
        allowNull: true
    },
    DeletedBy: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    ActivatedDate: {
        type: DataTypes.DATE,
        allowNull: true
    },
    ActivatedBy: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    isActive: {
        type: DataTypes.STRING(500),
        allowNull: true,
        defaultValue: 'N'
    }
}, {
    // Other model options
    tableName: 'Master_Part',
    timestamps: false ,
    indexes: [
        {
            fields: ['ItemCode']
        } 
    ]
});



// // Define a default page size
// const DEFAULT_PAGE_SIZE = 10;

// // Define a method for paginated and sorted queries
// Project.paginateAndSort = async (page = 1, pageSize = DEFAULT_PAGE_SIZE, sortBy = 'id', sortOrder = 'ASC') => {
//   const offset = (page - 1) * pageSize;

// //   offset,
// //   limit: pageSize,
//   const result = await Project.findAndCountAll({
//     //offset,
//     //limit: pageSize,
//     attributes:['id', 'PartNo', 'PartName', 'PartGroup', 'StorageArea', [sequelize.literal('FORMAT(PartWt, \'N2\')'), 'PartWt'], 'UOM','PartCategory','PackSize', [sequelize.literal('CONVERT(VARCHAR(10), UpdateDateTime, 103)'), 'UpdateDateTime'],[sequelize.literal('(case when isDelete=0 then 1 else 0 end)'), 'Status']],
//     order: [[sortBy, sortOrder]],
//   });
//   return {
//     totalItems: result.count,
//     totalPages: Math.ceil(result.count / pageSize),
//     currentPage: page,
//     pageSize,
//     items: result.rows,
//   };
// };

module.exports = MasterPart;