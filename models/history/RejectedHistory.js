// models/rejectedHistory.js

const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const RejectedHistory = sequelize.define('RejectedHistory', {
    id: {
        type: DataTypes.BIGINT,
        allowNull: true,
        primaryKey: true
    },
    SystemNumber: {
        type: DataTypes.TINYINT,
        allowNull: true
    },
    TransportNo: {
        type: DataTypes.STRING(50),
        allowNull: true
    },
    BinID: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    RejectedReason: {
        type: DataTypes.STRING,
        allowNull: true
    },
    StationNumber: {
        type: DataTypes.TINYINT,
        allowNull: true
    },
    ToteliftNumber: {
        type: DataTypes.TINYINT,
        allowNull: true
    },
    ConveyorNumber: {
        type: DataTypes.TINYINT,
        allowNull: true
    },
    DestStationNumber: {
        type: DataTypes.TINYINT,
        allowNull: true
    },
    Scanner:{
        type: DataTypes.STRING(200),
        allowNull: true
    },
    UpdatedDateTime: {
        type: DataTypes.DATE,
        defaultValue:sequelize.literal('GETDATE()'),
        allowNull: false
    }
}, {
  tableName: 'RejectedHistory',
  timestamps: false // Assuming the table doesn't have createdAt and updatedAt columns
});

module.exports = RejectedHistory;
