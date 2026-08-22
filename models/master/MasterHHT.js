const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const BinningComplete = sequelize.define('MasterHHTDevice', {
    deviceRefID: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    deviceId: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false
    },
    deviceModel: {
        type: DataTypes.STRING,
        allowNull: false
    },
    deviceOS:{
        type: DataTypes.STRING,
        allowNull: false
    },
    deviceOSVersion: {
        type: DataTypes.STRING,
        allowNull: false
    },
    Rights:{
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    currentUser: {
        type: DataTypes.STRING,
        allowNull: false
    },
    isDelete: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: 1
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
    }
}, {
    tableName: 'Master_HHT_Device',
    timestamps: false,
    indexes: [
        {
            unique: true,
            fields: ['deviceRefID']
        },
        {
            fields: ['BinID']
        }
    ]
});

module.exports = BinningComplete;