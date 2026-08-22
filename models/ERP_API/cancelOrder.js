const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const ERPCancelOrder = sequelize.define('ERPCancelOrder', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true
    },
    OrderNo: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: true
    },
    Type: {
        type: DataTypes.STRING,
        allowNull: true
    },
    ItemCode: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: true
    },
    Quantity: {
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
    tableName: 'ERP_Cancel_Order',
    timestamps: false,
    indexes: [
        {
            unique: true,
            fields: ['id']
        },
        {
            fields: ['OrderNo']
        }
    ]
});

module.exports = ERPCancelOrder;