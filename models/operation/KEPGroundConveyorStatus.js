const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const KEPGroundConveyorStatus = sequelize.define('KEPGroundConveyorStatus', {
    ID: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        allowNull: false,
        autoIncrement: true,
    },
    EquipmentNo: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    ConveyorName: {
        type: DataTypes.STRING(20),
        allowNull: true
    },
    BinID: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    AliasBinID: {
        type: DataTypes.BIGINT,
        allowNull: true
    },
    BinPresence: {
        type: DataTypes.BOOLEAN,
        allowNull: true
    },
    StationStatus: {
        type:  DataTypes.INTEGER,
        allowNull: true 
    },
    WMSStatus:{
        type: DataTypes.INTEGER,
        allowNull: true
    },
    stationHealtyStatus:{
        type: DataTypes.BOOLEAN,
        allowNull: true
    },
    UpdatedDT:{
        type: DataTypes.DATE,
        allowNull: true
    },
}, {
    // Other model options
    tableName: 'KEP_GroundConveyorStatus', // Specify the table name if it's different from the model name
    timestamps: false // Set to true if your table has createdAt and updatedAt columns
});

module.exports = KEPGroundConveyorStatus;