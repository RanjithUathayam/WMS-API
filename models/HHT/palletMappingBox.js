const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const PalletMappingBox = sequelize.define('T_PALLET_MAPPING_BOX', {
    PalletMappingBoxID: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true
    },
    PalletMappingID: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    PalletID: {
        type: DataTypes.STRING,
        allowNull: false
    },
    BoxNumber: {
        type: DataTypes.STRING,
        allowNull: false
    },
    WarehouseCode: {
        type: DataTypes.STRING,
        allowNull: true
    },
    ItemGroup: {
        type: DataTypes.STRING,
        allowNull: true
    },
    BoxTotalQty: {
        type: DataTypes.DECIMAL(18, 3),
        allowNull: true
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
    tableName: 'T_PALLET_MAPPING_BOX',
    timestamps: false,
    indexes: [
        {
            fields: ['PalletMappingID']
        },
        {
            unique: true,
            fields: ['BoxNumber']
        },
        {
            fields: ['PalletID']
        }
    ]
});

module.exports = PalletMappingBox;
