const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const PreBinBox = sequelize.define('T_PREBIN_BOX', {
    PreBinBoxID: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    BoxNumber: {
        type: DataTypes.STRING,
        allowNull: false
    },
    WarehouseCode: {
        type: DataTypes.STRING,
        allowNull: false
    },
    ItemGroup: {
        type: DataTypes.STRING,
        allowNull: true
    },
    TotalQty: {
        type: DataTypes.DECIMAL(18, 3),
        allowNull: false,
        defaultValue: 0
    },
    Status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'IN_PROGRESS'
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
    CompletedBy: {
        type: DataTypes.STRING,
        allowNull: true
    },
    CompletedAt: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'T_PREBIN_BOX',
    timestamps: false,
    indexes: [
        {
            fields: ['BoxNumber']
        }
    ]
});

module.exports = PreBinBox;
