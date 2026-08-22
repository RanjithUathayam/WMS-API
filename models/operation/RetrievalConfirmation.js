const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const RetrievalConfirmation = sequelize.define('RetrievalConfirmation', {
        Id: {
            type: DataTypes.BIGINT,
            primaryKey: true,
            allowNull: false,
            autoIncrement: true,
        },
        ERPID: {
            type: DataTypes.STRING(900),
            allowNull: true,
        },
        ReqDateTime: {
            type: DataTypes.DATE,
            allowNull: true
        },
        BinID: {
            type: DataTypes.STRING(200),
            allowNull: false
        },
        ItemCode: {
            type: DataTypes.STRING(200),
            allowNull: true
        },
        ItemName: {
            type: DataTypes.STRING(200),
            allowNull: true
        },
        ItemGroup: {
            type: DataTypes.STRING(200),
            allowNull: true
        },
        Category: {
            type: DataTypes.STRING(200),
            allowNull: true
        },
        UOM: {
            type: DataTypes.STRING(50),
            allowNull: true
        },
        Size: {
            type: DataTypes.REAL,
            allowNull: true
        },
        AvlQuantity: {
            type: DataTypes.REAL,
            allowNull: true
        },
        ReqQuantity: {
            type: DataTypes.REAL,
            allowNull: true
        },
        BalanceQuantity:{
            type: DataTypes.REAL,
            allowNull: true
        },
        Confirm: {
            type: DataTypes.BOOLEAN,
            allowNull: true
        },
        Status : {
            type: DataTypes.STRING(10),
            allowNull: true
        },
        OrderNo: {
            type: DataTypes.STRING(200),
            allowNull: true
        },
        Floor : {
            type: DataTypes.INTEGER, 
            allowNull: true
        },
        GTPPickingStation : {
            type: DataTypes.INTEGER, 
            allowNull: true
        },
        CreatedDateTime :{
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue:sequelize.literal('GETDATE()')
        },
        UpdateDateTime :{
            type: DataTypes.DATE,
            allowNull: true
        },
        PickedQuantity : {
            type: DataTypes.REAL,
            allowNull: true
        },
        Rejection_Reason :{
            type: DataTypes.STRING(200),
            allowNull: true
        },
        Reject :{
            type: DataTypes.BOOLEAN,
            allowNull: true
        },
        GTPReached :{
            type: DataTypes.BOOLEAN,
            allowNull: true
        },
        PickCategory: {
            type: DataTypes.STRING(200),
            allowNull: true  
        },
        BinReachedTime :{
            type: DataTypes.DATE,
            allowNull: true
        },
        BinWaitTime :{
            type: DataTypes.REAL,
            allowNull: true
        },
        BinProcessingTime :{
            type: DataTypes.INTEGER,
            allowNull: true
        },
        MLSCmdinitiatedTime :{
            type: DataTypes.DATE,
            allowNull: true
        }
}, {
      // Other model options
      tableName: 'RetrievalConfirmation', // Specify the table name if it's different from the model name
      timestamps: false // Set to true if your table has createdAt and updatedAt columns
});

module.exports = RetrievalConfirmation;

