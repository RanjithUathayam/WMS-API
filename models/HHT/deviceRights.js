const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const MasterHHTDevice = sequelize.define('Master_HHT_Device', {
    deviceRefID: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true
    },
    deviceId: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    deviceModel: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    deviceOS: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    deviceOSVersion: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    currentUser: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    isDelete: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0
    },
    CreatedDate: {
        type: DataTypes.DATE,
        allowNull: false
    },
    CreatedBy: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    UpdatedDate: {
        type: DataTypes.DATE,
        allowNull: true
    },
    UpdatedBy: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    Rights: {
        type: DataTypes.BOOLEAN,  // Assuming 'bit' in SQL is equivalent to BOOLEAN in Sequelize
        allowNull: true
    }
}, {
    tableName: 'Master_HHT_Device',
    timestamps: false
});

module.exports = MasterHHTDevice;
