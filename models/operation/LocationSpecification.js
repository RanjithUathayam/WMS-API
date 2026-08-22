const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const LocationSpecification = sequelize.define('LocationSpecification', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        allowNull: false,
        autoIncrement: true,
    },
    EquipmentNo: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    Side: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    Level: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    Bay: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    Deep: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    Duration: {
        type:  DataTypes.FLOAT,
        allowNull: true 
    },
    Zone:{
        type: DataTypes.STRING(200),
        allowNull: true
    },
    SideName:{
        type: DataTypes.STRING(200),
        allowNull: true
    },
    BinID:{
        type: DataTypes.STRING(200),
        allowNull: true
    },
    ItemCode: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    ItemName:{
        type: DataTypes.STRING(200),
        allowNull: true
    },
    ItemGroup:{
        type: DataTypes.STRING(200),
        allowNull: true
    },
    Empty: {
        type: DataTypes.BOOLEAN,
        allowNull: true
    },
    Blocked: {
        type: DataTypes.BOOLEAN,
        allowNull: true 
    },
    Error: {
        type: DataTypes.BOOLEAN,
        allowNull: true 
    },
    PickDelPoint: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    Compress: {
        type: DataTypes.STRING(2),
        allowNull: true
    },
    SpecialLoc:{
        type: DataTypes.BOOLEAN,
        allowNull: true
    },
    BinWeight: {
        type: DataTypes.REAL,
        allowNull: true 
    },
    MaxWeight: {
        type: DataTypes.REAL,
        allowNull: true 
    },
    LocationID:{
        type: DataTypes.STRING(200),
        allowNull: true 
    },
    Category:{
        type: DataTypes.STRING(25),
        allowNull: true 
    },
    LocationCategory:{
        type: DataTypes.STRING(25),
        allowNull: true 
    },
    BinHeight:{
        type: DataTypes.STRING(25),
        allowNull: true 
    },
    RemarksCode:{
        type: DataTypes.STRING(25),
        allowNull: true 
    },
    Remarks:{
        type: DataTypes.STRING(500),
        allowNull: true 
    },
    CustomerName:{
        type: DataTypes.STRING(200),
        allowNull: true 
    },
    CustomerCode:{
        type: DataTypes.STRING(50),
        allowNull: true 
    },
    UpdatedDateTime:{
        type: DataTypes.DATE,
        allowNull: true 
    },
    AisleNo:{
        type: DataTypes.INTEGER,
        allowNull: true 
    },
    AliasBinID:{
        type: DataTypes.STRING(300),
        allowNull: true 
    }
}, {
    // Other model options
    tableName: 'LocationSpecification', // Specify the table name if it's different from the model name
    timestamps: false // Set to true if your table has createdAt and updatedAt columns
});

module.exports = LocationSpecification;