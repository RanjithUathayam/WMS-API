const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const KepLiftRequestDetails = sequelize.define('KepLiftRequestDetails', {
    Id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        allowNull: false,
        autoIncrement: true,
    },
    AisleNo: {
        type : DataTypes.INTEGER,
        allowNull: true
    },
    EquipmentName: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    EquipmentNo: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    BinID:{
        type: DataTypes.STRING(200),
        allowNull: true
    },
    ReqUser: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    ReqType:{
        type: DataTypes.STRING(200),
        allowNull: true
    },
    ReqTime:{
        type: DataTypes.DATE,
        allowNull: true
    },
    Status:{
        type: DataTypes.STRING(1),
        allowNull: true
    },
    SourceType:{
        type: DataTypes.STRING(10),
        allowNull: true
    },
    SourceSide:{
        type: DataTypes.INTEGER,
        allowNull: true
    },
    SourceLevel:{
        type: DataTypes.INTEGER,
        allowNull: true
    },
    DestinationType:{
        type: DataTypes.STRING(10),
        allowNull: true
    },
    DestinationSide:{
        type: DataTypes.INTEGER,
        allowNull: true
    },
    DestinationLevel:{
        type: DataTypes.INTEGER,
        allowNull: true
    },
    BinReached:{
        type: DataTypes.BOOLEAN,
        allowNull: true
    },
    ItemCode:{
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
    Category:{
        type: DataTypes.STRING(200),
        allowNull: true
    },
    TransactionNo:{
        type: DataTypes.STRING(200),
        allowNull: true
    },
    UpdateDateTime:{
        type: DataTypes.DATE,
        allowNull: true
    },
    Remarks:{
        type: DataTypes.STRING,
        allowNull: true
    },
    AliasBinID:{
        type: DataTypes.STRING(200),
        allowNull: true
    },
    MLSID:{
        type: DataTypes.INTEGER,
        allowNull: true
    }
}, {
    // Other model options
    tableName: 'Kep_LiftRequestDetails', // Specify the table name if it's different from the model name
    timestamps: false // Set to true if your table has createdAt and updatedAt columns
});

module.exports = KepLiftRequestDetails;