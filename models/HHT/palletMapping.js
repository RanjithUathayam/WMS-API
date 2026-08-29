const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const PalletMapping = sequelize.define('T_PALLET_MAPPING', {
    PalletMappingID: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    PalletID: {
        type: DataTypes.STRING,
        allowNull: false
    },
    TotalBoxCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    Status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'OPEN'
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
    CompletedBy: {
        type: DataTypes.STRING,
        allowNull: true
    },
    CompletedAt: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'T_PALLET_MAPPING',
    timestamps: false,
    indexes: [
        {
            fields: ['PalletID']
        }
    ]
});

module.exports = PalletMapping;
