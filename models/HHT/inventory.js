const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const Inventory = sequelize.define('T_INVENTORY', {
    InventoryID: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true
    },
    WarehouseCode: {
        type: DataTypes.STRING,
        allowNull: false
    },
    RowCode: {
        type: DataTypes.STRING,
        allowNull: false
    },
    LocationID: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    LocationCode: {
        type: DataTypes.STRING,
        allowNull: true
    },
    PalletMappingID: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    PalletID: {
        type: DataTypes.STRING,
        allowNull: true
    },
    BoxNumber: {
        type: DataTypes.STRING,
        allowNull: false
    },
    ItemCode: {
        type: DataTypes.STRING,
        allowNull: false
    },
    ItemGroup: {
        type: DataTypes.STRING,
        allowNull: true
    },
    Quantity: {
        type: DataTypes.DECIMAL(18, 3),
        allowNull: false,
        defaultValue: 0
    },
    AllocatedQty: {
        type: DataTypes.DECIMAL(18, 3),
        allowNull: false,
        defaultValue: 0
    },
    Status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'AVAILABLE'
    },
    CreatedBy: {
        type: DataTypes.STRING,
        allowNull: false
    },
    CreatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: sequelize.literal('GETDATE()')
    },
    UpdatedBy: {
        type: DataTypes.STRING,
        allowNull: true
    },
    UpdatedAt: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'T_INVENTORY',
    timestamps: false,
    indexes: [
        {
            unique: true,
            fields: ['LocationID', 'PalletMappingID', 'BoxNumber', 'ItemCode']
        },
        {
            fields: ['WarehouseCode', 'RowCode', 'Status']
        },
        {
            fields: ['ItemCode']
        },
        {
            fields: ['PalletMappingID']
        }
    ]
});

module.exports = Inventory;
