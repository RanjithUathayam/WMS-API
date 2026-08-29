const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const LocationMapping = sequelize.define('T_LOCATION_MAPPING', {
    LocationMappingID: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    LocationID: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    LocationCode: {
        type: DataTypes.STRING,
        allowNull: true
    },
    WarehouseCode: {
        type: DataTypes.STRING,
        allowNull: true
    },
    RowCode: {
        type: DataTypes.STRING,
        allowNull: true
    },
    PositionNo: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    PalletMappingID: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    PalletID: {
        type: DataTypes.STRING,
        allowNull: true
    },
    Action: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'MAPPED'
    },
    PreviousLocationID: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    Status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'ACTIVE'
    },
    MappedBy: {
        type: DataTypes.STRING,
        allowNull: false
    },
    MappedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: sequelize.literal('GETDATE()')
    }
}, {
    tableName: 'T_LOCATION_MAPPING',
    timestamps: false,
    indexes: [
        {
            fields: ['LocationID']
        },
        {
            fields: ['PalletMappingID']
        }
    ]
});

module.exports = LocationMapping;
