const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const Project = sequelize.define('Inv_PalletDetails', {
    Id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        allowNull: false,
        autoIncrement: true,
    },
    BinID: {
        type: DataTypes.STRING(200),
        allowNull: false
    },
    ItemCode: {
        type: DataTypes.STRING(100),
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
    Description: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    Color: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    UOM: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    Size: {
        type: DataTypes.REAL,
        allowNull: true
    },
    Style: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    BinCapacity: {
        type: DataTypes.REAL,
        allowNull: true
    },
    Field1: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    Field2: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    Field3: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    Quantity:{
        type: DataTypes.REAL,
        allowNull: true
    },
    InQuantity:{
        type: DataTypes.REAL,
        allowNull: true
    },
    OutQuantity:{
        type: DataTypes.REAL,
        allowNull: true
    },
    PickType: {
        type: DataTypes.STRING(200),
        allowNull: false
    },
    FIFOType: {
        type: DataTypes.STRING(200),
        allowNull: true 
    },
    UserName: {
        type: DataTypes.STRING(200),
        allowNull: true 
    },
    UpdatedDate: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    BufferQty: {
        type: DataTypes.REAL,
        allowNull: true
    },
    PartWeight:{
        type: DataTypes.REAL,
        allowNull: true
    },
    GrossWeight:{
        type: DataTypes.REAL,
        allowNull: true
    },
    Remarks: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    AisleNo: {
        type: DataTypes.INTEGER,
        allowNull: true 
    },
    GRNNo: {
        type: DataTypes.STRING,
        allowNull: true 
    }
}, {
    // Other model options
    tableName: 'Inv_PalletDetails', // Specify the table name if it's different from the model name
    timestamps: false, // Set to true if your table has createdAt and updatedAt columns
    indexes: [
        {
            fields: ['BinID']
        },
        {
            fields: ['ItemCode']
        }  
    ]
});

module.exports = Project;