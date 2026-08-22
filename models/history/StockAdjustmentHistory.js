const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const StockAdjustmentHistory = sequelize.define('StockAdjustmentHistory', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true
    },
    BinID: {
        type: DataTypes.STRING,
        allowNull: true
    },
    ItemCode: {
        type: DataTypes.STRING,
        allowNull: true
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
    Description: {
        type: DataTypes.STRING,
        allowNull: true
    },
    Color: {
        type: DataTypes.STRING,
        allowNull: true
    },
    Size: {
        type: DataTypes.REAL,
        allowNull: true
    },
    Style: {
        type: DataTypes.STRING,
        allowNull: true
    },
    BinCapacity: {
        type: DataTypes.REAL,
        allowNull: true
    },
    Field1: {
        type: DataTypes.STRING,
        allowNull: true
    },
    Field2: {
        type: DataTypes.STRING,
        allowNull: true
    },
    Field3: {
        type: DataTypes.STRING,
        allowNull: true
    },
    SystemStock: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    PhysicalStock: {
        type: DataTypes.INTEGER,
        allowNull: true
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
        allowNull: true
    },
    UpdatedBy: {
        type: DataTypes.STRING,
        allowNull: true
    },
    UserName: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {
    tableName: 'Stock_Adjustment_History',
    timestamps: false
});

module.exports = StockAdjustmentHistory;
