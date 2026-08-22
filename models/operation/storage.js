const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const PalletRequest = sequelize.define('PalletRequestDetails', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        allowNull: false,
        autoIncrement: true,
    },
    ShuttleID: {
        type: DataTypes.BIGINT,
        allowNull: true
    },
    BinID: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    Description: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    ReqUser: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    ReqType: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    Station: {
        type:  DataTypes.STRING(200),
        allowNull: true 
    },
    ReqTime:{
        type: DataTypes.DATE,
        allowNull: true
    },
    Status:{
        type: DataTypes.STRING(100),
        allowNull: true
    },
    Reason:{
        type: DataTypes.STRING,
        allowNull: true
    },
    CompletedTime: {
        type: DataTypes.DATE,
        allowNull: true
    },
    ItemCode: {
        type: DataTypes.STRING(500),
        allowNull: true 
    },
    ItemName: {
        type: DataTypes.STRING(500),
        allowNull: true,
    },
    ItemGroup: {
        type: DataTypes.STRING(500),
        allowNull: true,
    },
    Category: {
        type: DataTypes.STRING(200),
        allowNull: true 
    },
    Priority:{
        type: DataTypes.STRING(50),
        allowNull: true
    },
    ShuffleFor: {
        type: DataTypes.BIGINT,
        allowNull: true 
    },
    LevelReached: {
        type: DataTypes.BIGINT,
        allowNull: true 
    },
    Quantity:{
        type: DataTypes.REAL,
        allowNull: true 
    },
    PickCategory:{
        type: DataTypes.STRING(3),
        allowNull: true 
    },
    RemarksCode:{
        type: DataTypes.STRING(50),
        allowNull: true 
    },
    Remarks:{
        type: DataTypes.STRING(500),
        allowNull: true 
    },
    BinWeight:{
        type: DataTypes.REAL,
        allowNull: true
    },
    FromLocation: {
        type: DataTypes.STRING(10),
        allowNull: true
    },
    ToLocation: {
        type: DataTypes.STRING(10),
        allowNull: true
    },
    OrderID: {
        type: DataTypes.BIGINT,
        allowNull: true 
    },
    SequenceNo:{
        type: DataTypes.REAL,
        allowNull: true
    },
    AisleNo:{
        type: DataTypes.REAL,
        allowNull: true
    },
    Side:{
        type: DataTypes.REAL,
        allowNull: true
    },
    Level:{
        type: DataTypes.BIGINT,
        allowNull: true 
    },
    Bay:{
        type: DataTypes.BIGINT,
        allowNull: true 
    },
    Deep:{
        type: DataTypes.BIGINT,
        allowNull: true 
    },
    AliasBinID: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    QueueTime: {
        type: DataTypes.DATE,
        allowNull: true
    },
    Floor:{
        type: DataTypes.BIGINT,
        allowNull: true 
    },
    GTPStation:{
        type: DataTypes.BIGINT,
        allowNull: true 
    }
}, {
    // Other model options
    tableName: 'PalletRequestDetails', // Specify the table name if it's different from the model name
    timestamps: false // Set to true if your table has createdAt and updatedAt columns
});

module.exports = PalletRequest;