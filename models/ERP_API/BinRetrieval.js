const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const ERPRetrieval = sequelize.define('ERPRetrieval', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true
    },
    OrderNo: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false
    },
    DocEntry: {
        type: DataTypes.STRING,
        allowNull: false
    },
    Type: {
        type: DataTypes.STRING,
        allowNull: true
    },
    ItemCode: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false
    },
    ItemName:{
        type: DataTypes.STRING,
        allowNull: false
    },
    Quantity: {
        type: DataTypes.BIGINT,
        allowNull: true
    },
    OutQuantity: {
        type: DataTypes.BIGINT,
        allowNull: true
    },
    Station:{
        type: DataTypes.STRING,
        allowNull: true,
    },
    Floor:{
        type: DataTypes.STRING,
        allowNull: true,
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
    },
    Status:{
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue:'G' //"A"
    },
    ConfirmStatus:{
        type: DataTypes.STRING,
        allowNull: true,
    },
    ConfirmRemark:{
        type: DataTypes.STRING,
        allowNull: true,
    },
    ReqType:{
        type: DataTypes.STRING,
        allowNull: false
    },
    SequenceNo:{
        type: DataTypes.REAL,
        allowNull: true
    },
    BinID: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue:''
    },
    PickingQty: {
        type: DataTypes.BIGINT,
        allowNull: true
    },
    TrolleyNo:{
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: ''
    },
    isTrolleyConfirm:{
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: 'N'
    },
    isOrderConfirm:{
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: 'N'
    },
    AvlQuantity: {
        type: DataTypes.BIGINT,
        allowNull: true
    },
    Remark: {
        type: DataTypes.STRING,
        allowNull: true
    },
    UnAssignedQuantity: {
        type: DataTypes.BIGINT,
        allowNull: true
    }
}, {
    tableName: 'ERP_Retrieval',
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

module.exports = ERPRetrieval;