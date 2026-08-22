const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const MasterReason = sequelize.define('MasterReason', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        allowNull: false,
        autoIncrement: true,
    },
    ReasonID: {
        type: DataTypes.STRING(500),
        primaryKey: true,
        allowNull: false
    },
    ReasonDescription: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    CreatedDate: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue:sequelize.literal('GETDATE()')
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
    isDelete: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0
    }
}, {
    // Other model options
    tableName: 'Master_Reason',
    timestamps: false 
});

module.exports = MasterReason;