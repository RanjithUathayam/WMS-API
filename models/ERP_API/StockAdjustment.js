const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const ERPStockAdjustment = sequelize.define('ERPStockAdjustment', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    BinID: {
        type: DataTypes.STRING,
        allowNull: false
    },
    ItemCode: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false
    },
    ItemName: {
        type: DataTypes.STRING,
        allowNull: true
    },
    ItemGroup: {
        type: DataTypes.STRING,
        allowNull: true
    },
    Category: {
        type: DataTypes.STRING,
        allowNull: true
    },
    SystemQuantity: {
        type: DataTypes.BIGINT,
        allowNull: true
    },
    isDelete: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    CreatedDate: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue:sequelize.literal('GETDATE()')
    },
    CreatedBy: {
        type: DataTypes.STRING,
        allowNull: false
    },
    UpdatedDate: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    UpdatedBy: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {
    tableName: 'ERP_Stock_Adjustment',
    timestamps: false,
    indexes: [
        {
            unique: true,
            fields: ['id']
        },
        {
            fields: ['BinID']
        },
        {
            fields: ['ItemCode']
        }
    ]
});

module.exports = ERPStockAdjustment;