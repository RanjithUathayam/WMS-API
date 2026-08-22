const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const ERPPreBinning = sequelize.define('ERP_PreBinning', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    TransactionType: {
        type: DataTypes.STRING,
        allowNull: true
    },
    GRNNo: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false
    },
    DocNo: {
        type: DataTypes.STRING,
        allowNull: true
    },
    PartyName: {
        type: DataTypes.STRING,
        allowNull: true
    },
    ItemCode: {
        type: DataTypes.STRING,
        allowNull: false
    },
    ItemName: {
        type: DataTypes.STRING,
        allowNull: false
    },
    ItemGroup: {
        type: DataTypes.STRING,
        allowNull: false
    },
    Quantity: {
        type: DataTypes.BIGINT,
        allowNull: true
    },
    Type: {
        type: DataTypes.STRING,
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
    isDelete: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: 0
    },
    GRNStatus:{
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'Pending'
    },
    Binning_Qty: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    GRNRemarks:{
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: ''
    }
}, {
    tableName: 'ERP_Pre_Binning',
    timestamps: false,
    indexes: [
        {
            unique: true,
            fields: ['id']
        },
        {
            fields: ['GRNNo']
        },
        {
            fields: ['ItemCode']
        }
    ]
});

module.exports = ERPPreBinning;