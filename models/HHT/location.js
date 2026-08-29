const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const Location = sequelize.define('T_LOCATION', {
    LocationID: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    WarehouseCode: {
        type: DataTypes.STRING,
        allowNull: false
    },
    RowCode: {
        type: DataTypes.STRING,
        allowNull: false
    },
    PositionNo: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    LocationCode: {
        type: DataTypes.STRING,
        allowNull: false
    },
    Status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'AVAILABLE'
    },
    CurrentPalletMappingID: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    CurrentPalletID: {
        type: DataTypes.STRING,
        allowNull: true
    },
    OccupiedBy: {
        type: DataTypes.STRING,
        allowNull: true
    },
    OccupiedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    CreatedBy: {
        type: DataTypes.STRING,
        allowNull: false
    },
    CreatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: sequelize.literal('GETDATE()')
    },
    UpdatedBy: {
        type: DataTypes.STRING,
        allowNull: true
    },
    UpdatedAt: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'T_LOCATION',
    timestamps: false,
    indexes: [
        {
            unique: true,
            fields: ['WarehouseCode', 'RowCode', 'PositionNo']
        },
        {
            unique: true,
            fields: ['LocationCode']
        },
        {
            fields: ['WarehouseCode', 'RowCode', 'Status']
        }
    ]
});

module.exports = Location;
