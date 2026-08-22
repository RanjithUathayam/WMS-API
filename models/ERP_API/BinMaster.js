const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const ERPBinMaster = sequelize.define('ERPBinMaster', {
    AliasBinID: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    BinID: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: true
    },
    BinStatus: {
        type: DataTypes.STRING,
        allowNull: true
    },
    isDelete: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
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
        allowNull: true,
    },
    UpdatedBy: {
        type: DataTypes.STRING,
        allowNull: true
    },
    DeletedDate: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    DeletedBy: {
        type: DataTypes.STRING,
        allowNull: true
    },
    ActivatedDate: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    ActivatedBy: {
        type: DataTypes.STRING,
        allowNull: true
    },
    isActive: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: 'Y'
    }
}, {
    tableName: 'Master_Bin',
    timestamps: false,
    indexes: [
        {
            unique: true,
            fields: ['id']
        },
        {
            fields: ['BinID']
        }
    ]
});

module.exports = ERPBinMaster;
