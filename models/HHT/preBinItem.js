const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const PreBinItem = sequelize.define('T_PREBIN_ITEM', {
    PreBinItemID: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true
    },
    PreBinBoxID: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    WarehouseCode: {
        type: DataTypes.STRING,
        allowNull: false
    },
    ItemCode: {
        type: DataTypes.STRING,
        allowNull: false
    },
    Type: {
        type: DataTypes.STRING,
        allowNull: true
    },
    GRNNo: {
        type: DataTypes.STRING,
        allowNull: false
    },
    ItemGroup: {
        type: DataTypes.STRING,
        allowNull: false
    },
    UniqueNumber: {
        type: DataTypes.STRING,
        allowNull: false
    },
    Qty: {
        type: DataTypes.DECIMAL(18, 3),
        allowNull: false
    },
    ScannedBy: {
        type: DataTypes.STRING,
        allowNull: false
    },
    ScannedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: sequelize.literal('GETDATE()')
    }
}, {
    tableName: 'T_PREBIN_ITEM',
    timestamps: false,
    indexes: [
        {
            fields: ['PreBinBoxID']
        },
        {
            unique: true,
            fields: ['ItemCode', 'GRNNo', 'UniqueNumber']
        },
        {
            fields: ['WarehouseCode', 'ItemCode']
        },
        {
            fields: ['ItemCode', 'ItemGroup']
        }
    ]
});

module.exports = PreBinItem;
